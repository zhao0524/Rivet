"""Composition of the engine stages into complete BuildPlans, edits and verification (B0/B7).

    IntentSpec -> part selection -> placement -> wiring -> BOM + steps -> verify
               -> bounded repair (re-verifying after every change) -> BuildPlan

Selections come from a fixed, catalog-backed default stack; the intent only steers
supported choices (preferred controller, sensor). Nothing here calls a model, the
network or the renderer.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from rivet_engine import assembly, bom, mounts, repair, wiring
from rivet_engine.models import (
    Behavior,
    BuildPlan,
    Firmware,
    IntentRequirements,
    IntentSpec,
    Provenance,
    Simulation,
    Verification,
)
from rivet_engine.ports import (
    Catalog,
    EngineError,
    InvalidInputError,
    OffsetCorrection,
    PlacementError,
    PlacementOptions,
    RepairAction,
    RoverSelection,
    Substitution,
    UnsupportedRequestError,
    VerificationContext,
    VerificationReport,
    finding,
)
from rivet_engine.validators import aggregate, sort_findings, verify_candidate

PROFILE_ID = "rover.obstacle_avoidance.v1"
FIRMWARE_TARGET = "esp32_arduino_platformio"
TITLE = "Indoor obstacle rover"
STATE_PREFIX = "engine_state: "

DEFAULT_SELECTION = RoverSelection(
    chassis="chassis.sparkfun_shadow_rob13301",
    motor="motor.adafruit_tt_gearbox_200rpm_3777",
    wheel="wheel.adafruit_tt_wheel_3766",
    caster="caster.sparkfun_shadow_nub",
    controller="board.esp32_devkitc_v4_wroom32e",
    motor_driver="driver.adafruit_tb6612_2448",
    distance_sensor="sensor.adafruit_vl53l0x_3317",
    motor_power="power.sparkfun_shadow_4xaa_holder",
    controller_power="power.adafruit_usb_power_bank_5000_4288",
    accessories=(
        "accessory.adafruit_half_breadboard_64",
        "wiring.adafruit_jumper_mm_40x150_758",
        "wiring.adafruit_stemma_qt_to_male_4209",
        "wiring.adafruit_usb_a_microb_3ft_592",
        "accessory.adafruit_dc_jack_terminal_368",
    ),
)

DEFAULT_PARAMETERS = {"obstacle_stop_distance_m": 0.25, "turn_duration_ms": 600, "forward_speed_fraction": 0.45}
# name -> (exclusive low, inclusive high); same bounds the firmware generator accepts
PARAMETER_BOUNDS = {
    "obstacle_stop_distance_m": (0.0, 2.0),
    "turn_duration_ms": (0.0, 5000.0),
    "forward_speed_fraction": (0.0, 1.0),
}

# Simulation sensor model per sourced sensor: (range_m, fov_deg, source)
SENSOR_SIMULATION = {
    "sensor.adafruit_vl53l0x_3317": (1.2, 35, "Adafruit 3317: ~30-1200 mm default mode, ~35 degree cone"),
    "sensor.adafruit_vl53l1x_3967": (4.0, 27, "Adafruit 3967: up to 400 cm, typical 27 degree FoV"),
}
HEURISTIC_SENSOR = (1.0, 25, "heuristic default; sensor range not modeled for this part")
# Bounded nominal speed for the 2D simulation. TT motors at 6 V reach ~200-250 RPM no-load
# (~0.65 m/s on 63 mm wheels); the simulation deliberately stays well below that.
NOMINAL_MAX_WHEEL_SPEED_MPS = 0.25


@dataclass(frozen=True)
class EngineState:
    """Edit state carried between revisions in one provenance note (not a wire field)."""

    max_budget: str | None = None
    currency: str = "USD"
    requested_behavior: str | None = None
    mount_offsets: Mapping[str, tuple[float, float, float]] = field(default_factory=dict)

    def note(self) -> str:
        data = {
            "max_budget": self.max_budget,
            "currency": self.currency,
            "requested_behavior": self.requested_behavior,
            "mount_offsets": {k: list(v) for k, v in sorted(self.mount_offsets.items())},
        }
        return STATE_PREFIX + json.dumps(data, sort_keys=True)

    @classmethod
    def from_plan(cls, plan: BuildPlan) -> EngineState:
        for note in plan.provenance.notes:
            if note.startswith(STATE_PREFIX):
                try:
                    data = json.loads(note[len(STATE_PREFIX):])
                    return cls(
                        max_budget=data.get("max_budget"),
                        currency=data.get("currency") or "USD",
                        requested_behavior=data.get("requested_behavior"),
                        mount_offsets={k: tuple(v) for k, v in (data.get("mount_offsets") or {}).items()},
                    )
                except (ValueError, TypeError, AttributeError):
                    break
        return cls()

    def requirements(self) -> IntentRequirements | None:
        if self.max_budget is None:
            return None
        return IntentRequirements(
            max_budget=self.max_budget,
            currency=self.currency,
            max_length_mm=None,
            max_width_mm=None,
            preferred_controller_catalog_id=None,
            required_capabilities=["differential_drive", "distance_sensing"],
            preferred_color=None,
        )


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- intent handling ---------------------------------------------------------------


def parse_intent(intent: Any) -> IntentSpec:
    try:
        return IntentSpec.model_validate(intent)
    except ValidationError as exc:
        errors = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        raise InvalidInputError("Not a valid IntentSpec", {"errors": errors}) from exc


def check_supported(intent: IntentSpec) -> None:
    if intent.project_family != "rover" or intent.support_status in ("planned", "unsupported"):
        raise UnsupportedRequestError(
            f"{intent.project_family} generation is not supported in this version",
            {"supported_families": ["rover"], "project_family": intent.project_family, "support_status": intent.support_status},
        )
    if intent.requested_behavior in ("line_following", "manual_drive"):
        raise UnsupportedRequestError(
            f"Behavior {intent.requested_behavior!r} has no supported firmware and simulation profile",
            {"supported_behaviors": ["obstacle_avoidance"], "requested_behavior": intent.requested_behavior},
        )
    unknown_caps = sorted(set(intent.requirements.required_capabilities) - {"differential_drive", "distance_sensing"})
    if unknown_caps:
        raise UnsupportedRequestError(
            "Requested capabilities are not supported",
            {"unsupported_capabilities": unknown_caps, "supported_capabilities": ["differential_drive", "distance_sensing"]},
        )


def select_parts(intent: IntentSpec, catalog: Catalog, base: RoverSelection = DEFAULT_SELECTION) -> tuple[RoverSelection, list[str]]:
    """Choose catalog parts; returns the selection and notes explaining any intent-driven choice."""
    notes: list[str] = []
    selection = base
    preferred = intent.requirements.preferred_controller_catalog_id
    if preferred and preferred != base.controller:
        comp = catalog.get(preferred)
        if comp is not None and comp.identity.category == "controller" and wiring.find_profile(preferred, base.motor_driver, wiring.load_profiles()):
            selection = replace(selection, controller=preferred)
            notes.append(f"Controller {preferred} chosen from the request")
        else:
            notes.append(f"Requested controller {preferred} has no catalog entry with a wiring profile; used {base.controller}")
    missing = [cid for cid in (*[getattr(selection, f) for f in _SLOTS], *selection.accessories) if cid not in catalog]
    if missing:
        raise EngineError("Default part selection references missing catalog items", {"missing": missing})
    return selection, notes


_SLOTS = ("chassis", "motor", "wheel", "caster", "controller", "motor_driver", "distance_sensor", "motor_power", "controller_power")
_ROLE_TO_SLOT = {
    "chassis": "chassis",
    "motor": "motor",
    "wheel": "wheel",
    "caster": "caster",
    "controller": "controller",
    "motor_driver": "motor_driver",
    "distance_sensor": "distance_sensor",
    "motor_power": "motor_power",
    "controller_power": "controller_power",
}


def selection_from_plan(plan: BuildPlan) -> RoverSelection:
    values: dict[str, Any] = {}
    for c in plan.components:
        slot = _ROLE_TO_SLOT.get(c.role)
        if slot:
            values.setdefault(slot, c.catalog_id)
    missing = [s for s in _SLOTS if s not in values]
    if missing:
        raise UnsupportedRequestError("Plan is not a rover_2wd template build", {"missing_roles": missing})
    accessories = tuple(c.catalog_id for c in sorted(plan.components, key=lambda c: c.instance_id) if c.role == "accessory")
    return RoverSelection(**values, accessories=accessories)


# --- plan assembly ---------------------------------------------------------------


def _simulation(components, catalog: Catalog, sensor_id: str) -> Simulation:
    by_id = {c.instance_id: c for c in components}
    limitations = ["Kinematic 2D differential-drive approximation", "No motor torque, wheel slip, battery sag or real sensor noise"]
    wheel = catalog.require(by_id["wheel-left-1"].catalog_id).physical.dimensions_mm
    radius_m = max(wheel.y, wheel.z) / 2 / 1000
    left, right = by_id["wheel-left-1"].pose.position_mm, by_id["wheel-right-1"].pose.position_mm
    base_m = math.dist(left, right) / 1000
    if catalog.require(by_id["wheel-left-1"].catalog_id).evidence.dimensions != "verified":
        limitations.append("Wheel radius and wheel base come from approximated geometry")
    range_m, fov, source = SENSOR_SIMULATION.get(sensor_id, HEURISTIC_SENSOR)
    limitations.append(f"Sensor model: {source}")
    limitations.append(f"Max wheel speed {NOMINAL_MAX_WHEEL_SPEED_MPS} m/s is a bounded nominal value, not measured")
    return Simulation(
        kind="differential_drive_2d",
        enabled=True,
        wheel_radius_m=round(radius_m, 4),
        wheel_base_m=round(base_m, 4),
        max_wheel_speed_mps=NOMINAL_MAX_WHEEL_SPEED_MPS,
        sensor_range_m=range_m,
        sensor_fov_deg=fov,
        limitations=limitations,
    )


@dataclass
class Builder:
    """Builds and rebuilds plans for one catalog/profile set."""

    catalog: Catalog
    profiles: Sequence[dict[str, Any]] | None = None
    generation_mode: str = "live"

    def assemble(
        self,
        *,
        selection: RoverSelection,
        state: EngineState,
        build_id: str,
        revision: int,
        source_intent_id: str,
        input_mode: str,
        created_at: str,
        parameters: Mapping[str, float],
        render_overrides: Mapping[str, Mapping[str, Any]],
        extra_notes: Sequence[str] = (),
    ) -> BuildPlan:
        """Derive every section of a plan from a selection; verification is left for `finalize`."""
        placed = mounts.place_rover(selection, self.catalog, PlacementOptions(dict(state.mount_offsets), dict(render_overrides)))
        wired = wiring.wire_rover(placed.components, self.catalog, self.profiles)
        components = list(placed.components)
        controller = next(c for c in components if c.role == "controller")
        supported = (PROFILE_ID, FIRMWARE_TARGET) in VerificationContext().supported_firmware_profiles and not wired.findings
        notes = [
            f"Placed from template {placed.template_id}; poses are computed, not model-generated",
            "Verification covers the engine's implemented rules only; it is not a physical safety certification",
            *extra_notes,
            state.note(),
        ]
        if any(self.catalog.require(c.catalog_id).is_synthetic for c in components):
            notes.insert(0, "Contains SYNTHETIC test parts; not a buildable design")
        return BuildPlan(
            schema_version="1.0",
            build_id=build_id,
            revision=revision,
            project_family="rover",
            title=TITLE,
            source_intent_id=source_intent_id,
            created_at=created_at,
            status="needs_review",
            components=components,
            connections=list(wired.connections),
            verification=Verification(overall="needs_review", findings=[]),
            assembly_steps=assembly.build_assembly_steps(components, wired.connections, self.catalog),
            bom=bom.build_bom(components, self.catalog, state.currency),
            behavior=Behavior(profile_id=PROFILE_ID, controller_catalog_id=controller.catalog_id, parameters=dict(parameters)),
            simulation=_simulation(components, self.catalog, selection.distance_sensor),
            firmware=Firmware(
                target=FIRMWARE_TARGET,
                profile_id=PROFILE_ID,
                pin_map=dict(wired.pin_map),
                compile_status="not_checked" if supported else "not_supported",
            ),
            provenance=Provenance(
                input_mode=input_mode,
                catalog_version=self.catalog.version,
                generation_mode=self.generation_mode,
                notes=notes,
            ),
        )

    def verify(self, plan: BuildPlan) -> VerificationReport:
        """All validators plus the wiring stage's own findings (recomputed from the components)."""
        state = EngineState.from_plan(plan)
        context = VerificationContext(
            requirements=state.requirements(),
            requested_behavior=state.requested_behavior,
            bounds=mounts.world_aabb,
        )
        report = verify_candidate(plan, self.catalog, context)
        if any(c.catalog_id not in self.catalog for c in plan.components):
            return report
        wiring_findings = wiring.wire_rover(plan.components, self.catalog, self.profiles).findings
        merged = sort_findings(list(report.findings) + list(wiring_findings))
        return VerificationReport(aggregate(merged), merged)

    def rebuild_from(self, plan: BuildPlan, *, selection: RoverSelection | None = None, state: EngineState | None = None,
                     parameters: Mapping[str, float] | None = None, revision: int | None = None, created_at: str | None = None,
                     extra_notes: Sequence[str] | None = None) -> BuildPlan:
        state = state or EngineState.from_plan(plan)
        kept_notes = [n for n in plan.provenance.notes if n.startswith(("Repair round", "Controller", "Requested controller", "Assumed"))]
        return self.assemble(
            selection=selection or selection_from_plan(plan),
            state=state,
            build_id=plan.build_id,
            revision=revision if revision is not None else plan.revision,
            source_intent_id=plan.source_intent_id,
            input_mode=plan.provenance.input_mode,
            created_at=created_at or plan.created_at,
            parameters=parameters if parameters is not None else plan.behavior.parameters,
            render_overrides={c.instance_id: c.render_overrides for c in plan.components if c.render_overrides},
            extra_notes=kept_notes if extra_notes is None else extra_notes,
        )

    def finalize(self, plan: BuildPlan) -> BuildPlan:
        """Verify, run bounded repair, and return the plan with its final verification."""

        def verify_fn(candidate: BuildPlan, _catalog: Catalog) -> VerificationReport:
            return self.verify(candidate)

        def rebuild_fn(candidate: BuildPlan, action: RepairAction, _catalog: Catalog) -> BuildPlan:
            state = EngineState.from_plan(candidate)
            selection = selection_from_plan(candidate)
            if isinstance(action, Substitution):
                roles = {c.role for c in candidate.components if c.instance_id in action.instance_ids}
                if len(roles) != 1 or next(iter(roles)) not in _ROLE_TO_SLOT:
                    raise PlacementError("Substitution must target one template role", {"instance_ids": list(action.instance_ids)})
                selection = replace(selection, **{_ROLE_TO_SLOT[next(iter(roles))]: action.catalog_id})
            elif isinstance(action, OffsetCorrection):
                state = replace(state, mount_offsets={**state.mount_offsets, action.instance_id: tuple(action.offset_mm)})
            return self.rebuild_from(candidate, selection=selection, state=state)

        result = repair.repair_candidate(plan, self.catalog, rebuild=rebuild_fn, verify=verify_fn)
        final = result.plan
        if result.attempts:
            final = final.model_copy(deep=True)
            final.provenance.notes = [n for n in final.provenance.notes if not n.startswith(STATE_PREFIX)] + [
                *repair.summarize(result)
            ] + [EngineState.from_plan(result.plan).note()]
        return final


def build_id_for(intent_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", intent_id.lower()).strip("-") or "build"
    return f"rivet-{slug}"[:64]


def solve_intent(intent: IntentSpec, builder: Builder, created_at: str | None = None) -> BuildPlan:
    check_supported(intent)
    selection, notes = select_parts(intent, builder.catalog)
    if intent.requested_behavior in ("none", "unknown"):
        notes.append(f"Assumed obstacle avoidance; request said {intent.requested_behavior!r}")
    state = EngineState(
        max_budget=intent.requirements.max_budget,
        currency=intent.requirements.currency,
        requested_behavior=intent.requested_behavior if intent.requested_behavior == "obstacle_avoidance" else None,
    )
    plan = builder.assemble(
        selection=selection,
        state=state,
        build_id=build_id_for(intent.intent_id),
        revision=1,
        source_intent_id=intent.intent_id,
        input_mode=intent.input.kind,
        created_at=created_at or now_utc(),
        parameters=DEFAULT_PARAMETERS,
        render_overrides={},
        extra_notes=notes,
    )
    return builder.finalize(plan)


# --- edits -------------------------------------------------------------------------

_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _reject(rule_id: str, message: str, instance_ids: Sequence[str] = ()) -> dict[str, Any]:
    return {"accepted": False, "finding": finding(rule_id, "FAIL", "blocking", message, instance_ids).to_wire()}


def edit_plan(plan: BuildPlan, operation: Mapping[str, Any], builder: Builder, created_at: str | None = None) -> dict[str, Any]:
    op = operation.get("op") if isinstance(operation, Mapping) else None
    state = EngineState.from_plan(plan)
    selection = selection_from_plan(plan)
    parameters = dict(plan.behavior.parameters)
    overrides = {c.instance_id: dict(c.render_overrides) for c in plan.components}

    if op == "set_budget":
        amount, currency = operation.get("amount"), operation.get("currency", "USD")
        try:
            IntentRequirements(max_budget=amount, currency=currency, max_length_mm=None, max_width_mm=None,
                               preferred_controller_catalog_id=None, required_capabilities=[], preferred_color=None)
        except ValidationError:
            return _reject("edit.set_budget", f"Budget {amount!r} is not a non-negative decimal amount")
        state = replace(state, max_budget=str(amount), currency=currency)
    elif op == "set_behavior_parameter":
        name, value = operation.get("name"), operation.get("value")
        if name not in PARAMETER_BOUNDS:
            return _reject("edit.behavior_parameter", f"Unknown behavior parameter {name!r}; allowed: {sorted(PARAMETER_BOUNDS)}")
        lo, hi = PARAMETER_BOUNDS[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo < value <= hi:
            return _reject("edit.behavior_parameter", f"{name} must be in ({lo}, {hi}]")
        parameters[name] = value
    elif op == "replace_optional_sensor":
        catalog_id = operation.get("catalog_id")
        comp = builder.catalog.get(catalog_id) if isinstance(catalog_id, str) else None
        if comp is None or comp.identity.category != "distance_sensor":
            return _reject("edit.replace_sensor", f"{catalog_id!r} is not a distance sensor in the catalog", ["sensor-1"])
        selection = replace(selection, distance_sensor=catalog_id)
    elif op == "set_mount_offset_within_template":
        instance_id, offset = operation.get("instance_id"), operation.get("offset_mm")
        if not isinstance(offset, (list, tuple)) or len(offset) != 3:
            return _reject("edit.mount_offset", "offset_mm must be three numbers")
        state = replace(state, mount_offsets={**state.mount_offsets, instance_id: tuple(float(v) for v in offset)})
    elif op == "change_appearance_color":
        instance_id, color = operation.get("instance_id"), operation.get("color")
        if instance_id not in overrides:
            return _reject("edit.color", f"No component {instance_id!r} in this plan")
        if not isinstance(color, str) or not _COLOR.match(color):
            return _reject("edit.color", "color must be #RRGGBB", [instance_id])
        overrides[instance_id] = {**overrides[instance_id], "color": color.upper()}
    else:
        return _reject("edit.operation", f"Unsupported edit operation {op!r}")

    try:
        new_plan = builder.assemble(
            selection=selection,
            state=state,
            build_id=plan.build_id,
            revision=plan.revision + 1,
            source_intent_id=plan.source_intent_id,
            input_mode=plan.provenance.input_mode,
            created_at=created_at or now_utc(),
            parameters=parameters,
            render_overrides={k: v for k, v in overrides.items() if v},
            extra_notes=[n for n in plan.provenance.notes if n.startswith(("Controller", "Requested controller", "Assumed"))],
        )
    except PlacementError as err:
        return _reject("edit.placement", err.message, [operation.get("instance_id")] if operation.get("instance_id") else [])
    return {"accepted": True, "plan": builder.finalize(new_plan).to_wire()}
