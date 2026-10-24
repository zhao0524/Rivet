from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

Stage = Literal[
    "upload",
    "understand",
    "identify",
    "verify",
    "decompose",
    "catalog_selection",
    "assembly",
    "validate",
    "repair",
    "render_ready",
    "firmware",
    "complete",
    "failed",
]
Actor = Literal["vision", "planner", "engineer", "validator", "repair", "firmware", "resolver", "system"]
EventStatus = Literal["running", "ok", "warning", "failed"]


class JobEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: int
    job_id: str
    stage: Stage
    actor: Actor
    status: EventStatus
    message: str
    timestamp: str
    references: list[Any] = []
