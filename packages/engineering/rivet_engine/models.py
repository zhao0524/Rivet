"""Canonical wire models (docs/implementation.md section 3).

These mirror the JSON contract exactly: snake_case, schema_version "1.0", millimetres,
Y-up right-handed frames, XYZ Euler degrees, decimal-string money. Every model forbids
extra keys, so nothing the engine emits can carry an undocumented field. Unknown source
data is represented as None, never as a guessed value.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BeforeValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    model_validator,
)

SCHEMA_VERSION = "1.0"

# --- enumerations (section 3.1 / 3.4) ---------------------------------------------

ProjectFamily = Literal["rover", "rc_car", "drone", "robot_arm", "iot", "unknown"]
SupportStatus = Literal["supported", "limited", "planned", "unsupported"]
RequestedBehavior = Literal["manual_drive", "obstacle_avoidance", "line_following", "none", "unknown"]
Confidence = Literal["low", "medium", "high"]
InputKind = Literal["image", "text", "image_and_text"]

PlanStatus = Literal["verified", "verified_with_warnings", "needs_review", "unbuildable"]
FindingResult = Literal["PASS", "WARN", "FAIL", "UNKNOWN"]
FindingSeverity = Literal["blocking", "advisory"]
CompileStatus = Literal["passed", "failed", "not_checked", "not_supported"]
BomTotalStatus = Literal["complete", "incomplete", "not_available"]
LinkStatus = Literal["verified_product", "manufacturer_reference_only", "not_available"]
SimulationKind = Literal["differential_drive_2d", "none"]
GenerationMode = Literal["live", "fixture", "fallback", "manual_template"]
ConnectionKind = Literal["electrical", "mechanical"]

ComponentCategory = Literal[
    "chassis",
    "motor",
    "wheel",
    "caster",
    "controller",
    "motor_driver",
    "distance_sensor",
    "power_supply",
    "switch",
    "wiring",
    "fastener",
    "accessory",
]
GeometryKind = Literal["procedural", "glb"]
PortSignal = Literal[
    "power_in",
    "power_output",
    "ground",
    "digital_output",
    "digital_input",
    "digital_io",
    "pwm_input",
    "pwm_output",
    "i2c",
    "i2c_sda",
    "i2c_scl",
    "motor_output",
    "motor_power",
    "analog_input",
]
# How strongly a catalog fact is backed by a cited source.
EvidenceLevel = Literal["verified", "approximated", "synthetic_approximation", "unverified", "unknown"]
AvailabilityStatus = Literal["in_stock", "out_of_stock", "discontinued", "unknown"]


def _decimal_string(value: str) -> str:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"not a decimal string: {value!r}") from exc
    if not parsed.is_finite() or parsed < 0:
        raise ValueError(f"money must be a finite non-negative decimal: {value!r}")
    return value


def _number_to_decimal_string(value: Any) -> Any:
    # Budgets may arrive as JSON numbers from upstream; normalize without float noise.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(Decimal(str(value)))
    return value


DecimalString = Annotated[str, AfterValidator(_decimal_string)]
BudgetAmount = Annotated[str, BeforeValidator(_number_to_decimal_string), AfterValidator(_decimal_string)]
# Finite numbers only: NaN/inf would poison geometry and ratings silently.
Number = StrictInt | Annotated[StrictFloat, Field(allow_inf_nan=False)]
Positive = Annotated[Number, Field(gt=0)]
NonNegative = Annotated[Number, Field(ge=0)]


def _utc_timestamp(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z", value):
        raise ValueError(f"not an ISO-8601 UTC timestamp ending in Z: {value!r}")
    datetime.fromisoformat(value[:-1])  # rejects impossible dates such as 2026-13-45
    return value


UtcTimestamp = Annotated[str, AfterValidator(_utc_timestamp)]
Vec3 = Annotated[list[Number], Field(min_length=3, max_length=3)]


class WireModel(BaseModel):
    """Base for every canonical record: no extra keys, values validated on assignment."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)


# --- IntentSpec (3.1) -------------------------------------------------------------


class IntentInput(WireModel):
    kind: InputKind
    image_asset_id: str | None
    user_text: str | None
    image_interpretation_is_approximate: StrictBool


class IntentRequirements(WireModel):
    max_budget: BudgetAmount | None
    currency: str
    max_length_mm: Number | None
    max_width_mm: Number | None
    preferred_controller_catalog_id: str | None
    required_capabilities: list[str]
    preferred_color: str | None


# Visible traits read from the reference image (optional, issue #67).
RangeSensorPosition = Literal["front_low", "front_mid", "front_high", "none"]
RangeSensorKind = Literal["time_of_flight", "ultrasonic", "infrared", "unknown"]
WheelSize = Literal["small", "medium", "large"]
ChassisSize = Literal["compact", "medium", "large"]
IMAGE_TEXT_MAX_CHARS = 60
ImageText = Annotated[str, Field(min_length=1, max_length=IMAGE_TEXT_MAX_CHARS)]


class ImageFeatures(WireModel):
    """What the image visibly shows. Every key is optional; None means "not seen with
    confidence". These are requests, not facts: image_features.py maps each one onto the
    catalog and template, or reports why it cannot."""

    drive_wheel_count: Annotated[StrictInt, Field(ge=1, le=8)] | None = None
    has_caster: StrictBool | None = None
    range_sensor_position: RangeSensorPosition | None = None
    range_sensor_kind: RangeSensorKind | None = None
    wheel_size: WheelSize | None = None
    chassis_size: ChassisSize | None = None
    body_color: ImageText | None = None
    visible_controller: ImageText | None = None


class IntentSpec(WireModel):
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
    # Absent and null both mean "not extracted" (additive field; older intents omit it).
    image_features: ImageFeatures | None = None

    def to_wire(self) -> dict[str, Any]:
        data = super().to_wire()
        if data["image_features"] is None:
            del data["image_features"]
        return data


# --- CatalogComponent (3.2) -------------------------------------------------------


class Identity(WireModel):
    manufacturer: str
    model: str
    sku: str | None
    category: ComponentCategory


class Dimensions(WireModel):
    x: Positive
    y: Positive
    z: Positive


class Physical(WireModel):
    dimensions_mm: Dimensions
    mass_g: NonNegative | None
    bounds_verified: StrictBool
    geometry_kind: GeometryKind
    asset_path: str | None
    material_preset: str


class Mount(WireModel):
    mount_id: str
    kind: str
    position_mm: Vec3
    rotation_deg: Vec3
    allowed_mates: list[str]


class Port(WireModel):
    port_id: str
    signal: PortSignal
    voltage_min_v: NonNegative | None
    voltage_max_v: NonNegative | None
    current_limit_a: NonNegative | None
    logic_level_v: NonNegative | None
    notes: str


_HTTPS_URL = re.compile(r"https://[A-Za-z0-9.-]+(:\d+)?([/?#]\S*)?")
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z)?")


def _https_url(value: str) -> str:
    if not _HTTPS_URL.fullmatch(value):
        raise ValueError(f"must be an https URL with a host: {value!r}")
    return value


def _iso_date(value: str) -> str:
    # The two forms contracts/component.schema.json allows (date, or UTC timestamp ending in Z).
    if not _ISO_DATE.fullmatch(value):
        raise ValueError(f"not an ISO-8601 date (YYYY-MM-DD) or UTC timestamp ending in Z: {value!r}")
    datetime.fromisoformat(value.removesuffix("Z"))  # rejects impossible dates such as 2026-02-30
    return value


HttpsUrl = Annotated[str, AfterValidator(_https_url)]
IsoDate = Annotated[str, AfterValidator(_iso_date)]


class Sourcing(WireModel):
    """Where a part is documented and sold. Purchase and manufacturer links are https only, and a
    purchase link always carries the date it was verified (a date never stands without a link)."""

    manufacturer_reference_url: HttpsUrl | None
    datasheet_url: str | None
    purchase_url: HttpsUrl | None
    purchase_url_verified_at: IsoDate | None
    price_amount: DecimalString | None
    price_currency: str | None
    price_checked_at: IsoDate | None
    availability_status: AvailabilityStatus

    @model_validator(mode="after")
    def _purchase_link_is_dated(self) -> Sourcing:
        if self.purchase_url is not None and self.purchase_url_verified_at is None:
            raise ValueError("purchase_url needs purchase_url_verified_at (the date the link was checked)")
        if self.purchase_url is None and self.purchase_url_verified_at is not None:
            raise ValueError("purchase_url_verified_at is set but there is no purchase_url")
        return self


class Evidence(WireModel):
    dimensions: EvidenceLevel
    electrical: EvidenceLevel
    price: EvidenceLevel
    notes: list[str]


class CatalogComponent(WireModel):
    schema_version: Literal["1.0"]
    catalog_id: str
    identity: Identity
    physical: Physical
    mounts: list[Mount]
    ports: list[Port]
    sourcing: Sourcing
    evidence: Evidence

    def mount(self, mount_id: str) -> Mount | None:
        return next((m for m in self.mounts if m.mount_id == mount_id), None)

    def port(self, port_id: str) -> Port | None:
        return next((p for p in self.ports if p.port_id == port_id), None)

    @property
    def is_synthetic(self) -> bool:
        return self.catalog_id.startswith(("demo.", "synthetic."))


# --- BuildPlan (3.3) --------------------------------------------------------------


class Pose(WireModel):
    position_mm: Vec3
    rotation_deg: Vec3


class ComponentInstance(WireModel):
    instance_id: str
    catalog_id: str
    role: str
    parent_instance_id: str | None
    attached_to_mount_id: str | None
    own_mount_id: str | None
    pose: Pose
    render_overrides: dict[str, Any]


class Endpoint(WireModel):
    instance_id: str
    port_id: str | None = None


class Connection(WireModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True, populate_by_name=True)

    connection_id: str
    kind: ConnectionKind
    from_: Endpoint = Field(alias="from")
    to: Endpoint
    net_name: str | None = None
    notes: str | None = None


class Finding(WireModel):
    rule_id: str
    result: FindingResult
    severity: FindingSeverity
    affected_instance_ids: list[str]
    message: str
    evidence_urls: list[str]


class Verification(WireModel):
    overall: PlanStatus
    findings: list[Finding]


class AssemblyStep(WireModel):
    step: StrictInt = Field(ge=1)
    title: str
    instance_ids: list[str]
    instructions: str
    safety_notes: list[str]


class BomItem(WireModel):
    catalog_id: str
    quantity: StrictInt = Field(ge=1)
    instance_ids: list[str]
    unit_price_amount: DecimalString | None
    purchase_url: str | None
    link_status: LinkStatus


class Bom(WireModel):
    currency: str
    known_subtotal_amount: DecimalString | None
    total_status: BomTotalStatus
    items: list[BomItem]


class Behavior(WireModel):
    profile_id: str
    controller_catalog_id: str
    parameters: dict[str, Number]


class Simulation(WireModel):
    kind: SimulationKind
    enabled: StrictBool
    wheel_radius_m: Number | None = None
    wheel_base_m: Number | None = None
    max_wheel_speed_mps: Number | None = None
    sensor_range_m: Number | None = None
    sensor_fov_deg: Number | None = None
    limitations: list[str] = []


class Firmware(WireModel):
    target: str
    profile_id: str
    # firmware signal name -> controller GPIO number (consumed by services/api firmware)
    pin_map: dict[str, StrictInt]
    compile_status: CompileStatus


class Provenance(WireModel):
    input_mode: InputKind  # contracts/build-plan.schema.json: the intent's input.kind values
    catalog_version: str
    generation_mode: GenerationMode
    notes: list[str]


class BuildPlan(WireModel):
    schema_version: Literal["1.0"]
    build_id: str
    revision: StrictInt = Field(ge=1)
    project_family: ProjectFamily
    title: str
    source_intent_id: str
    created_at: UtcTimestamp
    status: PlanStatus
    components: list[ComponentInstance]
    connections: list[Connection]
    verification: Verification
    assembly_steps: list[AssemblyStep]
    bom: Bom
    behavior: Behavior
    simulation: Simulation
    firmware: Firmware
    provenance: Provenance

    def instance(self, instance_id: str) -> ComponentInstance | None:
        return next((c for c in self.components if c.instance_id == instance_id), None)


__all__ = [
    "SCHEMA_VERSION",
    "AssemblyStep",
    "Behavior",
    "Bom",
    "BomItem",
    "BuildPlan",
    "CatalogComponent",
    "ComponentInstance",
    "Connection",
    "Dimensions",
    "Endpoint",
    "Evidence",
    "Finding",
    "Firmware",
    "Identity",
    "ImageFeatures",
    "IntentInput",
    "IntentRequirements",
    "IntentSpec",
    "Mount",
    "Physical",
    "Port",
    "Pose",
    "Provenance",
    "Simulation",
    "Sourcing",
    "Verification",
    "WireModel",
]
