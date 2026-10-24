from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt

ProjectFamily = Literal["rover", "rc_car", "drone", "robot_arm", "iot", "unknown"]
SupportStatus = Literal["supported", "limited", "planned", "unsupported"]
RequestedBehavior = Literal[
    "manual_drive", "obstacle_avoidance", "line_following", "none", "unknown"
]
Confidence = Literal["low", "medium", "high"]
InputKind = Literal["image", "text", "image_and_text"]

# Visible image traits (contracts/intent.schema.json `image_features`, issue #67).
RangeSensorPosition = Literal["front_low", "front_mid", "front_high", "none"]
RangeSensorKind = Literal["time_of_flight", "ultrasonic", "infrared", "unknown"]
WheelSize = Literal["small", "medium", "large"]
ChassisSize = Literal["compact", "medium", "large"]
IMAGE_TEXT_MAX_CHARS = 60  # contract maxLength for body_color and visible_controller


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


class ImageFeatures(_Strict):
    """Visible traits only; None means "not seen with confidence". Keys, types and enums
    follow the contract. Text length is capped by the sanitizer, not rejected here."""

    drive_wheel_count: Annotated[StrictInt, Field(ge=1, le=8)] | None = None
    has_caster: StrictBool | None = None
    range_sensor_position: RangeSensorPosition | None = None
    range_sensor_kind: RangeSensorKind | None = None
    wheel_size: WheelSize | None = None
    chassis_size: ChassisSize | None = None
    body_color: str | None = None
    visible_controller: str | None = None


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
    # Optional and additive: absent or null means no traits were extracted.
    image_features: ImageFeatures | None = None
