"""Requirements, supported family/behavior and BOM completeness (B4 categories 2 and 6)."""

from __future__ import annotations

from rivet_engine.models import Finding
from rivet_engine.validators.common import PlanView, Rule

SUPPORTED_BEHAVIORS = {"obstacle_avoidance"}
SUPPORTED_PROFILES = {"rover.obstacle_avoidance.v1"}
KNOWN_CAPABILITIES = {"differential_drive", "distance_sensing"}

# role -> (minimum, maximum) count for the supported 2WD rover
REQUIRED_ROLES = {
    "chassis": (1, 1),
    "motor": (2, 2),
    "wheel": (2, 2),
    "caster": (1, 2),
    "controller": (1, 1),
    "motor_driver": (1, 1),
    "distance_sensor": (1, 1),
    "motor_power": (1, 1),
    "controller_power": (1, 1),
}


def check(view: PlanView) -> list[Finding]:
    plan, ctx = view.plan, view.context
    out: list[Finding] = []

    family = Rule("requirements.project_family", pass_message="Rover is the supported project family")
    if plan.project_family != "rover":
        family.fail(f"Project family {plan.project_family!r} is not supported; only 'rover' is")
    out += family.result()

    behavior = Rule("requirements.behavior", pass_message="Requested behavior has a supported profile")
    if ctx.requested_behavior is not None and ctx.requested_behavior not in SUPPORTED_BEHAVIORS | {"none"}:
        behavior.fail(f"Requested behavior {ctx.requested_behavior!r} is not supported; supported: {sorted(SUPPORTED_BEHAVIORS)}")
    if plan.behavior.profile_id not in SUPPORTED_PROFILES:
        behavior.fail(f"Behavior profile {plan.behavior.profile_id!r} is not supported")
    out += behavior.result()

    caps = Rule("requirements.capabilities", pass_message="Required capabilities are provided by placed parts")
    caps.applicable = ctx.requirements is not None
    if ctx.requirements is not None:
        for cap in sorted(ctx.requirements.required_capabilities):
            if cap == "differential_drive":
                if len(view.role("motor")) < 2 or not view.role("motor_driver"):
                    caps.fail("differential_drive needs two motors and a motor driver")
            elif cap == "distance_sensing":
                if not view.role("distance_sensor"):
                    caps.fail("distance_sensing needs a distance sensor")
            else:
                caps.unknown(f"Capability {cap!r} has no implemented check")
    out += caps.result()

    for role, (lo, hi) in REQUIRED_ROLES.items():
        rule = Rule(f"completeness.required_{role}", pass_message=f"{role} present")
        found = view.role(role)
        if not lo <= len(found) <= hi:
            want = str(lo) if lo == hi else f"{lo}-{hi}"
            rule.fail(f"Expected {want} {role} component(s), found {len(found)}", [c.instance_id for c in found])
        else:
            rule.ok([c.instance_id for c in found])
        out += rule.result()

    drive = Rule("completeness.wheels_on_motors", pass_message="Each drive wheel is mounted on its own motor")
    motors = {m.instance_id for m in view.role("motor")}
    wheels = view.role("wheel")
    involved = sorted(motors) + [w.instance_id for w in wheels]
    parents = [w.parent_instance_id for w in wheels]
    if len(wheels) != len(motors):
        drive.fail(f"{len(wheels)} drive wheels for {len(motors)} motors", involved)
    elif sorted(p for p in parents if p in motors) != sorted(motors) or len(set(parents)) != len(parents):
        drive.warn("Wheels are not mounted one-per-motor-shaft; drive coupling is not modeled", involved)
    out += drive.result()

    wires = Rule("completeness.wiring_supplies", "advisory", "Wiring supplies are listed in the BOM")
    if not any((c := view.component(i.instance_id)) is not None and c.identity.category == "wiring" for i in plan.components):
        wires.unknown("No wires or cables are listed; wiring supplies are unaccounted for", severity="advisory")
    out += wires.result()

    real = Rule("completeness.real_parts", pass_message="All parts are identifiable products")
    synthetic = sorted(c.instance_id for c in plan.components if (comp := view.component(c.instance_id)) and comp.is_synthetic)
    if synthetic:
        real.unknown("Synthetic placeholder parts are not real products and cannot be bought or built", synthetic)
    out += real.result()

    stock = Rule("completeness.availability", "advisory", "All parts were listed in stock when checked")
    for c in plan.components:
        comp = view.component(c.instance_id)
        if comp is None or comp.is_synthetic:
            continue
        status = comp.sourcing.availability_status
        if status in ("out_of_stock", "discontinued"):
            stock.warn(f"{comp.identity.model} was {status.replace('_', ' ')} when checked", [c.instance_id], view.urls([c.instance_id]))
    out += _dedupe_by_message(stock.result())
    return out


def _dedupe_by_message(findings: list[Finding]) -> list[Finding]:
    merged: dict[str, Finding] = {}
    for f in findings:
        if f.message in merged:
            old = merged[f.message]
            merged[f.message] = old.model_copy(update={"affected_instance_ids": sorted(set(old.affected_instance_ids + f.affected_instance_ids))})
        else:
            merged[f.message] = f
    return list(merged.values())
