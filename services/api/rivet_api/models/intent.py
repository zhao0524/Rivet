from typing import Literal

from pydantic import BaseModel, ConfigDict

ProjectFamily = Literal["rover", "rc_car", "drone", "robot_arm", "iot", "unknown"]
SupportStatus = Literal["supported", "limited", "planned", "unsupported"]
RequestedBehavior = Literal[
    "manual_drive", "obstacle_avoidance", "line_following", "none", "unknown"
]
Confidence = Literal["low", "medium", "high"]
InputKind = Literal["image", "text", "image_and_text"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IntentInput(_Strict):
    kind: InputKind
    image_asset_id: str | None = None
    user_text: str | None = None
    image_interpretation_is_approximate: bool = True


class IntentRequirements(_Strict):
    max_budget: str | float | None = None
    currency: str = "USD"
    max_length_mm: float | None = None
    max_width_mm: float | None = None
    preferred_controller_catalog_id: str | None = None
    required_capabilities: list[str] = []
    preferred_color: str | None = None


class IntentSpec(_Strict):
    schema_version: Literal["1.0"]
    intent_id: str
    input: IntentInput
    project_family: ProjectFamily
    requested_behavior: RequestedBehavior
    visual_features: list[str]
    requirements: IntentRequirements
    assumptions: list[str]
    unknowns: list[str]
    confidence: Confidence
    support_status: SupportStatus
