"""Interpretations the user sees before anything is built, and the explicit choices they make.

`POST /api/intents/interpret` stores the sanitized IntentSpec here; a generate request that
carries its `intent_id` builds from exactly that interpretation instead of calling vision again.
Building from an unsupported interpretation happens only through the user's explicit
`closest_supported_rover` choice, which is recorded in provenance and in a job event.
"""

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

from rivet_api.errors import ApiError
from rivet_api.models.intent import IntentSpec
from rivet_api.models.requests import GenerateRequest

CLOSEST_ROVER_NOTE = "User chose to build the closest supported rover"
# The only rover behavior with a firmware and simulation profile (rover.obstacle_avoidance.v1).
CLOSEST_ROVER_BEHAVIOR = "obstacle_avoidance"


@dataclass(frozen=True)
class StoredIntent:
    intent: IntentSpec
    vision_mode: str
    expires_at: float


class IntentStore:
    """In-memory, per-process, bounded (oldest dropped first) and expiring.

    Hackathon-grade like the job manager: a restart forgets every interpretation, and clients
    then get 404 INTENT_NOT_FOUND and interpret again.
    """

    def __init__(self, ttl_s: float = 3600.0, max_items: int = 256, clock: Callable[[], float] = time.monotonic):
        self.ttl_s = ttl_s
        self.max_items = max_items
        self._clock = clock
        self._items: OrderedDict[str, StoredIntent] = OrderedDict()
        self._lock = threading.Lock()

    def _purge(self, now: float) -> None:
        for key in [k for k, v in self._items.items() if v.expires_at <= now]:
            del self._items[key]

    def put(self, intent: IntentSpec, vision_mode: str) -> StoredIntent:
        with self._lock:
            now = self._clock()
            self._purge(now)
            entry = StoredIntent(intent.model_copy(deep=True), vision_mode, now + self.ttl_s)
            self._items.pop(intent.intent_id, None)
            self._items[intent.intent_id] = entry
            while len(self._items) > self.max_items:
                self._items.popitem(last=False)
            return entry

    def get(self, intent_id: str) -> StoredIntent:
        with self._lock:
            self._purge(self._clock())
            entry = self._items.get(intent_id)
        if entry is None:
            raise ApiError(
                "INTENT_NOT_FOUND",
                "No such interpretation (unknown or expired); interpret the input again",
                404,
                {"intent_id": intent_id},
            )
        return entry


def check_same_input(intent: IntentSpec, req: GenerateRequest) -> None:
    """A stored interpretation may only build the input it was made from."""
    stored = (intent.input.kind, intent.input.image_asset_id, intent.input.user_text)
    sent = (req.input.kind, req.input.image_asset_id, req.input.user_text)
    if stored != sent:
        raise ApiError(
            "INTENT_INPUT_MISMATCH",
            "This interpretation was made from a different input; interpret the current input first",
            409,
            {"intent_id": intent.intent_id},
        )


def closest_supported_rover(intent: IntentSpec, vision_mode: str) -> tuple[IntentSpec, str | None]:
    """Apply the user's explicit choice to build the closest supported rover.

    Returns the intent to build and the note that records the choice, or the intent unchanged
    and None when it already is a supported obstacle-avoiding rover. Visible features, unknowns
    and the interpreted confidence are kept; the change is added as the first assumption.
    """
    family, behavior = intent.project_family, intent.requested_behavior
    if family == "rover" and behavior == CLOSEST_ROVER_BEHAVIOR and intent.support_status == "supported":
        return intent, None
    source = "image" if intent.input.image_asset_id and vision_mode == "live" else "request"
    note = (
        f"{CLOSEST_ROVER_NOTE}; the {source} was interpreted as {family} "
        f"({intent.confidence} confidence, {vision_mode} vision)"
    )
    if behavior != CLOSEST_ROVER_BEHAVIOR:
        note += f"; requested behavior {behavior} replaced by {CLOSEST_ROVER_BEHAVIOR}"
    assumption = (
        "Built the closest supported rover (two-wheel differential drive, obstacle avoidance) "
        f"at the user's request instead of the interpreted {family} ({behavior})"
    )
    built = intent.model_copy(
        update={
            "project_family": "rover",
            "requested_behavior": CLOSEST_ROVER_BEHAVIOR,
            "support_status": "supported",
            "assumptions": [assumption, *intent.assumptions],
        }
    )
    return built, note
