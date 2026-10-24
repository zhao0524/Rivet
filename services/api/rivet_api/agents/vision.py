"""Vision port. Only the offline mock provider and the support gate live here for now;
live providers and the sanitizer arrive with the vision task."""

import copy
import json
import uuid
from pathlib import Path
from typing import Literal, Protocol

from rivet_api.config import Settings
from rivet_api.errors import ApiError
from rivet_api.models.intent import IntentSpec
from rivet_api.models.requests import GenerateRequest

_INTENT_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "intent" / "rover_obstacle_v1.json"
_UNSUPPORTED_KEYWORDS = {"drone": "drone", "quadcopter": "drone", "robotic arm": "robot_arm", "robot arm": "robot_arm"}


class VisionPort(Protocol):
    mode: Literal["live", "fixture", "fallback"]

    def interpret(self, request: GenerateRequest, image: tuple[bytes, str] | None) -> IntentSpec: ...


class MockVisionProvider:
    """Offline stand-in: returns the saved rover intent. It does not look at the image."""

    mode: Literal["live", "fixture", "fallback"] = "fixture"

    def interpret(self, request: GenerateRequest, image: tuple[bytes, str] | None) -> IntentSpec:
        raw = json.loads(_INTENT_FIXTURE.read_text())
        raw = copy.deepcopy(raw)
        raw["intent_id"] = f"intent-{uuid.uuid4().hex[:12]}"
        raw["input"] = {
            "kind": request.input.kind,
            "image_asset_id": request.input.image_asset_id,
            "user_text": request.input.user_text,
            "image_interpretation_is_approximate": True,
        }
        text = (request.input.user_text or "").lower()
        for keyword, family in _UNSUPPORTED_KEYWORDS.items():
            if keyword in text:
                raw["project_family"] = family
                raw["requested_behavior"] = "unknown"
                raw["support_status"] = "unsupported"
                break
        return IntentSpec.model_validate(raw)


def build_vision_port(settings: Settings) -> VisionPort:
    if settings.vision_provider == "mock":
        return MockVisionProvider()
    raise ValueError(f"Vision provider {settings.vision_provider!r} is not implemented yet")


def ensure_supported(intent: IntentSpec) -> None:
    if intent.project_family == "rover" and intent.support_status == "supported":
        return
    raise ApiError(
        "UNSUPPORTED_PROJECT_FAMILY",
        f"Projects of family {intent.project_family!r} are not supported in this version",
        422,
        {"supported_families": ["rover"], "detected_family": intent.project_family},
    )
