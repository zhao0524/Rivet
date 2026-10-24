"""Response bodies that are API additions on top of the frozen domain schemas."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from rivet_api.models.intent import IntentSpec

VisionMode = Literal["live", "fixture", "fallback"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Limitation(_Strict):
    """Why an interpretation cannot be built as is; the same code, message and details the
    support gate would return as a 422 from a generate job."""

    code: str
    message: str
    details: dict[str, Any]


class InterpretResponse(_Strict):
    """`POST /api/intents/interpret`. An unsupported interpretation is a 200 with a limitation."""

    intent_id: str
    intent: IntentSpec
    supported: bool
    limitation: Limitation | None
    vision_mode: VisionMode
