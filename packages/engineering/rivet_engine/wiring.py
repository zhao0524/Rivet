"""Structured netlist and GPIO allocation for the 2WD rover (B3).

Everything board-specific comes from a wiring profile (data/wiring_profiles/*.json) that
names the exact controller and driver catalog IDs, the reserved pins with reasons, and
the allocation order. With no matching profile, nothing is wired and a finding says why.
No GPIO is ever chosen outside the profile, and every endpoint is a real catalog port.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from functools import cache
from pathlib import Path
from typing import Any

from rivet_engine.models import CatalogComponent, ComponentInstance, Connection, Endpoint, Finding
from rivet_engine.ports import Catalog, WiringResult, finding

PROFILE_DIR = Path(__file__).resolve().parent / "data" / "wiring_profiles"

# Order of firmware signals; also the GPIO allocation order.
MOTOR_SIGNALS = (
    "motor_left_pwm",
    "motor_left_in1",
    "motor_left_in2",
    "motor_right_pwm",
    "motor_right_in1",
    "motor_right_in2",
    "motor_standby",
)
I2C_SIGNALS = ("i2c_sda", "i2c_scl")


@cache
def _packaged_profiles() -> tuple[str, ...]:
    return tuple(p.read_text() for p in sorted(PROFILE_DIR.glob("*.json")))


def load_profiles() -> list[dict[str, Any]]:
    return [json.loads(text) for text in _packaged_profiles()]


def find_profile(controller_id: str, driver_id: str, profiles: Sequence[dict[str, Any]]) -> dict[str, Any] | None:
    return next(
        (p for p in profiles if p["controller_catalog_id"] == controller_id and driver_id in p["driver_catalog_ids"]),
        None,
    )


class _Netlist:
    def __init__(self, components: dict[str, ComponentInstance], catalog: Catalog, evidence: list[str]):
        self.components = components
        self.catalog = catalog
        self.evidence = evidence
        self.connections: list[Connection] = []
        self.findings: list[Finding] = []

    def _port_ok(self, instance_id: str, port_id: str) -> bool:
        component = self.catalog.require(self.components[instance_id].catalog_id)
        if component.port(port_id) is not None:
            return True
        self.findings.append(
            finding(
                "wiring.port_missing",
                "FAIL",
                "blocking",
                f"{component.catalog_id} has no port {port_id!r} required by the wiring profile",
                [instance_id],
                self.evidence,
            )
        )
        return False

    def connect(self, net: str, a: tuple[str, str], b: tuple[str, str], notes: str | None = None) -> bool:
        if not (self._port_ok(*a) and self._port_ok(*b)):
            return False
        count = sum(1 for c in self.connections if c.net_name == net)
        suffix = f"-{count + 1}" if count or net in {"GND", "V_LOGIC"} else ""
        self.connections.append(
            Connection(
                connection_id=f"wire-{net.lower().replace('_', '-')}{suffix}",
                kind="electrical",
                **{"from": Endpoint(instance_id=a[0], port_id=a[1])},
                to=Endpoint(instance_id=b[0], port_id=b[1]),
                net_name=net,
                notes=notes,
            )
        )
        return True


def _ports_with(component: CatalogComponent, *signals: str) -> list[str]:
    return sorted(p.port_id for p in component.ports if p.signal in signals)


def wire_rover(
    components: Sequence[ComponentInstance],
    catalog: Catalog,
    profiles: Sequence[dict[str, Any]] | None = None,
) -> WiringResult:
    by_role: dict[str, list[ComponentInstance]] = {}
    for c in components:
        by_role.setdefault(c.role, []).append(c)
    by_id = {c.instance_id: c for c in components}

    def one(role: str) -> ComponentInstance | None:
        found = by_role.get(role, [])
        return found[0] if len(found) == 1 else None

    controller, driver, sensor = one("controller"), one("motor_driver"), one("distance_sensor")
    motor_power, controller_power = one("motor_power"), one("controller_power")
    motors = {m.instance_id: m for m in by_role.get("motor", [])}

    missing = [r for r, c in (("controller", controller), ("motor_driver", driver)) if c is None]
    if missing:
        return WiringResult(
            (),
            {},
            (finding("wiring.required_parts", "FAIL", "blocking", f"Cannot wire: need exactly one {', '.join(missing)}", []),),
        )

    profile = find_profile(controller.catalog_id, driver.catalog_id, profiles if profiles is not None else load_profiles())
    if profile is None:
        return WiringResult(
            (),
            {},
            (
                finding(
                    "wiring.profile_supported",
                    "UNKNOWN",
                    "blocking",
                    f"No documented wiring profile for controller {controller.catalog_id} with driver {driver.catalog_id}; "
                    "no pins were allocated",
                    [controller.instance_id, driver.instance_id],
                ),
            ),
        )

    evidence = list(profile.get("evidence_urls", []))
    net = _Netlist(by_id, catalog, evidence)
    cport, dport = profile["controller_ports"], profile["driver_ports"]
    cid, did = controller.instance_id, driver.instance_id
    controller_component = catalog.require(controller.catalog_id)
    reserved = {g for group in profile["reserved_gpio"] for g in group["gpio"]}
    available = {int(p.port_id[4:]) for p in controller_component.ports if p.port_id.startswith("gpio") and p.port_id[4:].isdigit()}

    pin_map: dict[str, int] = {}
    pool = [g for g in profile["output_gpio_order"] if g not in reserved and g in available]
    i2c = profile.get("i2c", {})
    bus_pins = {i2c.get("sda_gpio"), i2c.get("scl_gpio")}
    pool = [g for g in pool if g not in bus_pins]

    # 1. Driver control signals, allocated in a fixed order.
    for signal in MOTOR_SIGNALS:
        driver_port = profile["driver_signals"].get(signal)
        if driver_port is None:
            continue
        if not pool:
            net.findings.append(
                finding(
                    "wiring.gpio_available",
                    "FAIL",
                    "blocking",
                    f"No unreserved output GPIO left on {controller.catalog_id} for {signal}",
                    [cid, did],
                    evidence,
                )
            )
            continue
        gpio = pool.pop(0)
        if net.connect(signal.upper(), (cid, f"gpio{gpio}"), (did, driver_port)):
            pin_map[signal] = gpio

    # 2. Range sensor on the I2C bus.
    if sensor is not None:
        sensor_component = catalog.require(sensor.catalog_id)
        sda, scl = _ports_with(sensor_component, "i2c_sda"), _ports_with(sensor_component, "i2c_scl")
        if len(sda) != 1 or len(scl) != 1:
            net.findings.append(
                finding(
                    "wiring.sensor_bus_supported",
                    "FAIL",
                    "blocking",
                    f"{sensor.catalog_id} does not expose exactly one I2C SDA and SCL port; only I2C range sensors are supported",
                    [sensor.instance_id],
                )
            )
        elif not bus_pins <= available or None in bus_pins:
            net.findings.append(
                finding("wiring.i2c_pins", "FAIL", "blocking", "Profile I2C pins are not exposed by the controller", [cid], evidence)
            )
        else:
            for signal, gpio, port in (("i2c_sda", i2c["sda_gpio"], sda[0]), ("i2c_scl", i2c["scl_gpio"], scl[0])):
                if net.connect(signal.upper(), (cid, f"gpio{gpio}"), (sensor.instance_id, port), i2c.get("notes")):
                    pin_map[signal] = gpio
    else:
        net.findings.append(finding("wiring.sensor_present", "FAIL", "blocking", "No distance sensor to wire", []))

    # 3. Logic supply from the controller regulator; it must suit every logic input.
    logic_v = profile["controller_logic_v"]

    def check_logic_range(instance_id: str, port_id: str) -> None:
        port = catalog.require(by_id[instance_id].catalog_id).port(port_id)
        if port is None:
            return
        lo, hi = port.voltage_min_v, port.voltage_max_v
        if lo is None or hi is None:
            net.findings.append(
                finding(
                    "wiring.logic_supply_range",
                    "UNKNOWN",
                    "blocking",
                    f"{by_id[instance_id].catalog_id} {port_id} has no documented voltage range for the {logic_v} V logic supply",
                    [instance_id, cid],
                )
            )
        elif not lo <= logic_v <= hi:
            net.findings.append(
                finding(
                    "wiring.logic_supply_range",
                    "FAIL",
                    "blocking",
                    f"{by_id[instance_id].catalog_id} {port_id} needs {lo}-{hi} V but the controller logic is {logic_v} V",
                    [instance_id, cid],
                    evidence,
                )
            )

    if net.connect("V_LOGIC", (cid, cport["logic_out"]), (did, dport["logic_in"])):
        check_logic_range(did, dport["logic_in"])
    if sensor is not None:
        vin = _ports_with(catalog.require(sensor.catalog_id), "power_in")
        if len(vin) == 1:
            if net.connect("V_LOGIC", (cid, cport["logic_out"]), (sensor.instance_id, vin[0])):
                check_logic_range(sensor.instance_id, vin[0])
        else:
            net.findings.append(
                finding("wiring.sensor_supply", "FAIL", "blocking", f"{sensor.catalog_id} has no single power input", [sensor.instance_id])
            )

    # 4. Motor outputs.
    for motor_id, outputs in sorted(profile["motor_outputs"].items()):
        motor = motors.get(motor_id)
        if motor is None:
            net.findings.append(finding("wiring.motor_present", "FAIL", "blocking", f"Profile expects {motor_id}", [did]))
            continue
        terminals = _ports_with(catalog.require(motor.catalog_id), "motor_power")
        if len(terminals) != 2:
            net.findings.append(
                finding("wiring.motor_terminals", "FAIL", "blocking", f"{motor.catalog_id} does not have two motor terminals", [motor_id])
            )
            continue
        side = "LEFT" if "left" in motor_id else "RIGHT"
        for n, (out, terminal) in enumerate(zip(outputs, terminals), start=1):
            net.connect(f"MOTOR_{side}_{'AB'[n - 1]}", (did, out), (motor_id, terminal))

    # 5. Supplies.
    if motor_power is not None:
        mp = catalog.require(motor_power.catalog_id)
        outs = _ports_with(mp, "power_output")
        if len(outs) == 1:
            net.connect("V_MOTOR", (motor_power.instance_id, outs[0]), (did, dport["motor_in"]))
        else:
            net.findings.append(finding("wiring.motor_supply", "FAIL", "blocking", f"{mp.catalog_id} has no single output", [motor_power.instance_id]))
    else:
        net.findings.append(finding("wiring.motor_supply", "FAIL", "blocking", "No motor power supply to wire", [did]))

    if controller_power is not None:
        cp = catalog.require(controller_power.catalog_id)
        outs = _ports_with(cp, "power_output")
        if len(outs) == 1:
            net.connect("V_CONTROLLER", (controller_power.instance_id, outs[0]), (cid, cport["power_in"]))
        else:
            net.findings.append(finding("wiring.controller_supply", "FAIL", "blocking", f"{cp.catalog_id} has no single output", [controller_power.instance_id]))
    else:
        net.findings.append(finding("wiring.controller_supply", "FAIL", "blocking", "No controller power supply to wire", [cid]))

    # 6. Common ground: every part with a ground port joins the driver ground.
    ground_hub = (did, dport["ground"])
    for part in (controller, sensor, motor_power, controller_power):
        if part is None:
            continue
        grounds = _ports_with(catalog.require(part.catalog_id), "ground")
        if grounds:
            net.connect("GND", (part.instance_id, grounds[0]), ground_hub)

    return WiringResult(tuple(net.connections), dict(pin_map), tuple(net.findings))
