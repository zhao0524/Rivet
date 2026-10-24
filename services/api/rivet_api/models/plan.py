"""Wire shape of BuildPlan (docs/implementation.md section 3.3).

B generates these; A only stores and exposes them. Nested objects allow extra keys
so that additive optional fields from B never break A; required keys and enums are
still enforced. A never computes `status` or `verification`.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PlanStatus = Literal["verified", "verified_with_warnings", "needs_review", "unbuildable"]
FindingResult = Literal["PASS", "WARN", "FAIL", "UNKNOWN"]
FindingSeverity = Literal["blocking", "advisory"]
CompileStatus = Literal["passed", "failed", "not_checked", "not_supported"]
BomTotalStatus = Literal["complete", "incomplete", "not_available"]
LinkStatus = Literal["verified_product", "manufacturer_reference_only", "not_available"]
GenerationMode = Literal["live", "fixture", "fallback", "manual_template"]
ConnectionKind = Literal["electrical", "mechanical"]


class _Open(BaseModel):
    model_config = ConfigDict(extra="allow")


class Pose(_Open):
    position_mm: list[float]
    rotation_deg: list[float]


class ComponentInstance(_Open):
    instance_id: str
    catalog_id: str
    role: str
    parent_instance_id: str | None
    attached_to_mount_id: str | None
    own_mount_id: str | None
    pose: Pose
    render_overrides: dict[str, Any] = {}


class Endpoint(_Open):
    instance_id: str
    port_id: str | None = None


class Connection(_Open):
    connection_id: str
    kind: ConnectionKind
    # `from` is a Python keyword, so the wire key is an alias
    from_: Endpoint = Field(alias="from")
    to: Endpoint

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Finding(_Open):
    rule_id: str
    result: FindingResult
    severity: FindingSeverity
    affected_instance_ids: list[str]
    message: str
    evidence_urls: list[str]


class Verification(_Open):
    overall: PlanStatus
    findings: list[Finding]


class AssemblyStep(_Open):
    step: int
    title: str
    instance_ids: list[str]
    instructions: str
    safety_notes: list[str]


class BomItem(_Open):
    catalog_id: str
    quantity: int
    instance_ids: list[str]
    unit_price_amount: str | None
    purchase_url: str | None
    link_status: LinkStatus


class Bom(_Open):
    currency: str
    known_subtotal_amount: str | None
    total_status: BomTotalStatus
    items: list[BomItem]


class Behavior(_Open):
    profile_id: str
    controller_catalog_id: str
    parameters: dict[str, float]


class Simulation(_Open):
    kind: Literal["differential_drive_2d", "none"]
    enabled: bool


class Firmware(_Open):
    target: str
    profile_id: str
    pin_map: dict[str, Any]
    compile_status: CompileStatus


class Provenance(_Open):
    input_mode: str
    catalog_version: str
    generation_mode: GenerationMode
    notes: list[str]


class BuildPlan(_Open):
    schema_version: Literal["1.0"]
    build_id: str
    revision: int
    project_family: str
    title: str
    source_intent_id: str
    created_at: str
    status: PlanStatus
    components: list[ComponentInstance]
    connections: list[Connection]
    verification: Verification
    assembly_steps: list[AssemblyStep]
    bom: Bom
    behavior: Behavior | None
    simulation: Simulation
    firmware: Firmware
    provenance: Provenance
