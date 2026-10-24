"""Internal Python-only types and callable boundaries shared by the engine modules.

Nothing here is a wire format. These types carry canonical models (rivet_engine.models)
between stages; they never add fields to a BuildPlan. Signatures are frozen for the
P1-P6 work orders; see INTERNAL_API.md for the full contract of each stage.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Any, Literal, Protocol

from rivet_engine.models import (
    AssemblyStep,
    Bom,
    BuildPlan,
    CatalogComponent,
    ComponentInstance,
    Connection,
    Finding,
    FindingResult,
    FindingSeverity,
    IntentRequirements,
    Mount,
    PlanStatus,
    RequestedBehavior,
    Verification,
)

if TYPE_CHECKING:  # link_checks imports models only; a runtime import here is not needed
    from rivet_engine.link_checks import LinkChecks

Vec3 = tuple[float, float, float]

# --- errors -----------------------------------------------------------------------


class EngineError(Exception):
    """Structured engine failure. Fields mirror the API error envelope (section 3.5)."""

    code = "ENGINE_ERROR"
    http_status = 500

    def __init__(self, message: str, details: Mapping[str, Any] | None = None, *, retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.details = dict(details or {})
        self.retryable = retryable

    def to_envelope(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
                "retryable": self.retryable,
            }
        }


class InvalidInputError(EngineError):
    """Input failed schema validation (malformed intent, plan, operation or catalog record)."""

    code = "INVALID_INPUT"
    http_status = 400


class UnsupportedRequestError(EngineError):
    """Well-formed but outside what the engine supports (family, behavior, edit)."""

    code = "UNSUPPORTED_REQUEST"
    http_status = 422


class CatalogError(EngineError):
    """Catalog data is missing, duplicated or malformed."""

    code = "CATALOG_ERROR"
    http_status = 500


class PlacementError(EngineError):
    """A template could not be placed (missing anchor, illegal mate, out-of-range offset)."""

    code = "PLACEMENT_ERROR"
    http_status = 422


class EngineNotImplementedError(EngineError):
    """A stage has not been implemented yet. Never replaced by a fake success."""

    code = "ENGINE_NOT_IMPLEMENTED"
    http_status = 503


# --- catalog ----------------------------------------------------------------------


@dataclass(frozen=True)
class Catalog:
    """Immutable, ordered set of catalog components. Always passed explicitly."""

    version: str
    components: tuple[CatalogComponent, ...]

    def __post_init__(self) -> None:
        ids = [c.catalog_id for c in self.components]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise CatalogError("Duplicate catalog_id in catalog", {"duplicates": dupes})
        object.__setattr__(self, "components", tuple(sorted(self.components, key=lambda c: c.catalog_id)))

    def get(self, catalog_id: str) -> CatalogComponent | None:
        return next((c for c in self.components if c.catalog_id == catalog_id), None)

    def require(self, catalog_id: str) -> CatalogComponent:
        component = self.get(catalog_id)
        if component is None:
            raise CatalogError(f"Unknown catalog_id {catalog_id!r}", {"catalog_id": catalog_id})
        return component

    def __contains__(self, catalog_id: object) -> bool:
        return any(c.catalog_id == catalog_id for c in self.components)

    def by_category(self, category: str) -> tuple[CatalogComponent, ...]:
        return tuple(c for c in self.components if c.identity.category == category)

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(c.catalog_id for c in self.components)

    def to_wire(self) -> list[dict[str, Any]]:
        return [c.to_wire() for c in self.components]


# --- placement (mounts.py) ----------------------------------------------------------


@dataclass(frozen=True)
class RoverSelection:
    """Catalog choice for each slot of the 2WD rover template (made by the configurator)."""

    chassis: str
    motor: str
    wheel: str
    caster: str
    controller: str
    motor_driver: str
    distance_sensor: str
    motor_power: str
    controller_power: str
    # Unmounted kit items (wires, fasteners, switch): one instance each, parented to the chassis.
    accessories: tuple[str, ...] = ()


@dataclass(frozen=True)
class PlacementOptions:
    # Extra translation (mm, in the parent mount frame) per instance_id; bounded by the template.
    mount_offsets: Mapping[str, Vec3] = field(default_factory=dict)
    # instance_id -> render_overrides (colors only; never geometry).
    render_overrides: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class PlacementResult:
    template_id: str
    components: tuple[ComponentInstance, ...]
    findings: tuple[Finding, ...] = ()


@dataclass(frozen=True)
class AABB:
    """Axis-aligned world bounds in mm."""

    min_mm: Vec3
    max_mm: Vec3

    def overlaps(self, other: AABB, tolerance_mm: float = 0.0) -> bool:
        return all(
            self.min_mm[i] < other.max_mm[i] - tolerance_mm and other.min_mm[i] < self.max_mm[i] - tolerance_mm
            for i in range(3)
        )


# --- wiring (wiring.py) -------------------------------------------------------------


@dataclass(frozen=True)
class WiringResult:
    connections: tuple[Connection, ...]
    # firmware signal -> controller GPIO number; only for connections that exist above
    pin_map: Mapping[str, int]
    findings: tuple[Finding, ...] = ()


# --- verification (validators/) ---------------------------------------------------


BoundsFn = Callable[[ComponentInstance, CatalogComponent], AABB | None]


@dataclass(frozen=True)
class VerificationContext:
    """Inputs a BuildPlan does not carry itself. Every field is optional; missing data
    makes the dependent checks UNKNOWN rather than PASS."""

    requirements: IntentRequirements | None = None
    requested_behavior: RequestedBehavior | None = None
    # Injected world-bounds helper (mounts.world_aabb); None => overlap checks UNKNOWN.
    bounds: BoundsFn | None = None
    # (behavior profile_id, firmware target) pairs that have a tested template.
    supported_firmware_profiles: frozenset[tuple[str, str]] = frozenset(
        {("rover.obstacle_avoidance.v1", "esp32_arduino_platformio")}
    )
    # Physical-fit evidence per mounted pair ('<parent>#<mount>|<child>' -> entry), from
    # catalog.load_fit_evidence(). None => the fit rule is not run.
    fit_evidence: Mapping[str, Mapping[str, Any]] | None = None
    # Injected mount transform (parent instance, parent mount, child mount) -> expected child
    # world position in mm. None => pose consistency is reported as not checked.
    expected_position: Callable[[ComponentInstance, Mount, Mount], Sequence[float]] | None = None
    # Latest purchase-link check report (link_checks.load_link_checks()). None => no report:
    # link freshness uses catalog verification dates only and no link counts as broken.
    link_checks: LinkChecks | None = None
    # Date link freshness is judged against; None => the plan's created_at date.
    as_of: date | None = None


@dataclass(frozen=True)
class VerificationReport:
    overall: PlanStatus
    findings: tuple[Finding, ...]

    def to_verification(self) -> Verification:
        return Verification(overall=self.overall, findings=list(self.findings))

    def count(self, result: FindingResult, severity: FindingSeverity | None = None) -> int:
        return sum(1 for f in self.findings if f.result == result and (severity is None or f.severity == severity))


# --- repair (repair.py) -----------------------------------------------------------


@dataclass(frozen=True)
class Substitution:
    """Replace the catalog item of these instances with another catalog item."""

    instance_ids: tuple[str, ...]
    catalog_id: str
    reason: str


@dataclass(frozen=True)
class OffsetCorrection:
    """Move one instance within its template-allowed offset range."""

    instance_id: str
    offset_mm: Vec3
    reason: str


RepairAction = Substitution | OffsetCorrection

# Rebuild everything derived from components after one action (placement, wiring, BOM,
# steps). Must not set verification. Raises EngineError if the action is illegal.
RebuildFn = Callable[[BuildPlan, RepairAction, Catalog], BuildPlan]
VerifyFn = Callable[[BuildPlan, Catalog], VerificationReport]
# Optional: layout corrections worth trying for a finding (e.g. raise a blocked sensor).
LayoutOptionsFn = Callable[[Finding, BuildPlan], Sequence[OffsetCorrection]]

RepairOutcome = Literal["unchanged", "repaired", "improved", "rejected"]


@dataclass(frozen=True)
class RepairAttempt:
    round: int
    action: RepairAction
    accepted: bool
    overall: PlanStatus | None
    note: str


@dataclass(frozen=True)
class RepairResult:
    plan: BuildPlan
    report: VerificationReport
    outcome: RepairOutcome
    attempts: tuple[RepairAttempt, ...] = ()


# --- stage protocols (implemented by P1-P6, composed by P7) ---------------------------


class LoadCatalog(Protocol):
    def __call__(self, path: str | None = None) -> Catalog: ...


class PlaceRover(Protocol):
    def __call__(
        self, selection: RoverSelection, catalog: Catalog, options: PlacementOptions = ...
    ) -> PlacementResult: ...


class WireRover(Protocol):
    def __call__(self, components: Sequence[ComponentInstance], catalog: Catalog) -> WiringResult: ...


class VerifyCandidate(Protocol):
    def __call__(
        self, plan: BuildPlan, catalog: Catalog, context: VerificationContext = ...
    ) -> VerificationReport: ...


class BuildBom(Protocol):
    def __call__(self, components: Sequence[ComponentInstance], catalog: Catalog, currency: str = ...) -> Bom: ...


class BuildAssemblySteps(Protocol):
    def __call__(
        self, components: Sequence[ComponentInstance], connections: Sequence[Connection], catalog: Catalog
    ) -> list[AssemblyStep]: ...


class RepairCandidate(Protocol):
    def __call__(
        self,
        plan: BuildPlan,
        catalog: Catalog,
        *,
        rebuild: RebuildFn,
        verify: VerifyFn,
        layout_options: LayoutOptionsFn | None = None,
        max_rounds: int = 3,
    ) -> RepairResult: ...


def finding(
    rule_id: str,
    result: FindingResult,
    severity: FindingSeverity,
    message: str,
    affected_instance_ids: Iterable[str] = (),
    evidence_urls: Iterable[str] = (),
) -> Finding:
    """Build a canonical finding with sorted, de-duplicated references."""
    return Finding(
        rule_id=rule_id,
        result=result,
        severity=severity,
        affected_instance_ids=sorted(set(affected_instance_ids)),
        message=message,
        evidence_urls=sorted(set(u for u in evidence_urls if u)),
    )
