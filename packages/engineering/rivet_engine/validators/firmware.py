"""Firmware support (B4 category 8). Never claims compilation; that belongs to services/api."""

from __future__ import annotations

from rivet_engine.models import Finding
from rivet_engine.validators.common import PlanView, Rule

PROFILE_SIGNALS = {
    "rover.obstacle_avoidance.v1": (
        "motor_left_pwm",
        "motor_left_in1",
        "motor_left_in2",
        "motor_right_pwm",
        "motor_right_in1",
        "motor_right_in2",
        "motor_standby",
        "i2c_sda",
        "i2c_scl",
    )
}


def check(view: PlanView) -> list[Finding]:
    plan, ctx = view.plan, view.context
    fw, behavior = plan.firmware, plan.behavior
    out: list[Finding] = []

    backed = Rule("firmware.pin_map_backed", pass_message="Every pin-map entry is backed by a controller wire")
    controllers = {c.instance_id for c in view.role("controller")}
    wires = {
        (c.net_name or "").lower(): end.port_id
        for c in view.electrical
        for end in (c.from_, c.to)
        if end.instance_id in controllers and end.port_id and end.port_id.startswith("gpio")
    }
    for signal, gpio in sorted(fw.pin_map.items()):
        if wires.get(signal) != f"gpio{gpio}":
            backed.fail(f"pin_map {signal} = GPIO{gpio} has no matching wire from the controller", sorted(controllers))
    backed.applicable = bool(fw.pin_map)
    out += backed.result()

    support = Rule("firmware.profile_supported", "advisory", "Board, driver, sensor and behavior map to the tested firmware template")
    controller = view.role("controller")
    if (behavior.profile_id, fw.target) not in ctx.supported_firmware_profiles or fw.profile_id != behavior.profile_id:
        support.fail(f"No tested firmware template for {behavior.profile_id} on {fw.target}", severity="advisory")
    elif len(controller) != 1 or controller[0].catalog_id != behavior.controller_catalog_id:
        support.fail("behavior.controller_catalog_id does not match the placed controller", [c.instance_id for c in controller], severity="advisory")
    else:
        missing = [s for s in PROFILE_SIGNALS.get(behavior.profile_id, ()) if s not in fw.pin_map]
        if missing:
            support.fail(f"Firmware not ready: pin map lacks {', '.join(missing)}", severity="advisory")
    out += support.result()
    return out
