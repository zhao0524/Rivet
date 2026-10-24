"""SYNTHETIC TEST-ONLY catalog and plan.

Every record here is invented for engine tests. Identities say "SYNTHETIC TEST ONLY",
catalog IDs start with "synthetic.", and no value is a real product rating. Never load
these into the shipped catalog or show them as purchasable hardware.

The base data is one complete, internally consistent 2WD rover (full netlist, mounts,
BOM, steps). Adversarial variants (wrong logic voltage, high stall current, missing
current, too few pins, over-voltage battery, mixed currency) are separate catalog IDs.
"""

from __future__ import annotations

import copy
from typing import Any

SYNTHETIC_NOTE = "SYNTHETIC TEST ONLY: invented value, not a product rating"
CATALOG_VERSION = "synthetic-test-v1"


def _port(port_id: str, signal: str, vmin=None, vmax=None, current=None, logic=None, notes=SYNTHETIC_NOTE):
    return {
        "port_id": port_id,
        "signal": signal,
        "voltage_min_v": vmin,
        "voltage_max_v": vmax,
        "current_limit_a": current,
        "logic_level_v": logic,
        "notes": notes,
    }


def _mount(mount_id: str, kind: str, pos=(0, 0, 0), rot=(0, 0, 0), mates=()):
    return {
        "mount_id": mount_id,
        "kind": kind,
        "position_mm": list(pos),
        "rotation_deg": list(rot),
        "allowed_mates": list(mates),
    }


def _component(catalog_id, category, dims, mounts, ports, *, price=None, currency=None, material="pcb", mass=None):
    return {
        "schema_version": "1.0",
        "catalog_id": catalog_id,
        "identity": {
            "manufacturer": "SYNTHETIC TEST ONLY",
            "model": catalog_id.removeprefix("synthetic."),
            "sku": None,
            "category": category,
        },
        "physical": {
            "dimensions_mm": {"x": dims[0], "y": dims[1], "z": dims[2]},
            "mass_g": mass,
            "bounds_verified": False,
            "geometry_kind": "procedural",
            "asset_path": None,
            "material_preset": material,
        },
        "mounts": mounts,
        "ports": ports,
        "sourcing": {
            "manufacturer_reference_url": None,
            "datasheet_url": None,
            "purchase_url": None,
            "purchase_url_verified_at": None,
            "price_amount": price,
            "price_currency": currency if price is not None else None,
            "price_checked_at": None,
            "availability_status": "unknown",
        },
        "evidence": {
            "dimensions": "synthetic_approximation",
            "electrical": "synthetic_approximation",
            "price": "synthetic_approximation" if price is not None else "unknown",
            "notes": [SYNTHETIC_NOTE],
        },
    }


# GPIOs the synthetic controller exposes. 0/2/12/15 are flagged as boot-strapping in
# notes; 34-39 are input-only. These mimic common dev-board restrictions for tests.
_OUTPUT_GPIOS = [4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33]
_STRAPPING_GPIOS = [0, 2, 12, 15]
_INPUT_ONLY_GPIOS = [34, 35, 36, 39]


def _controller(catalog_id: str, gpios: list[int], *, restricted: bool = True, logic: float = 3.3):
    ports = [_port(f"gpio{n}", "digital_io", logic=logic) for n in gpios]
    if restricted:
        ports += [_port(f"gpio{n}", "digital_io", logic=logic, notes=SYNTHETIC_NOTE + "; boot strapping pin") for n in _STRAPPING_GPIOS]
        ports += [_port(f"gpio{n}", "digital_input", logic=logic, notes=SYNTHETIC_NOTE + "; input only") for n in _INPUT_ONLY_GPIOS]
    ports += [
        _port("v3v3_out", "power_output", 3.3, 3.3, 0.5),
        _port("vin_5v", "power_in", 4.75, 5.25),
        _port("gnd", "ground"),
    ]
    return _component(
        catalog_id, "controller", (52, 10, 28),
        [_mount("base", "deck_standoff", mates=["electronics_deck"])],
        sorted(ports, key=lambda p: p["port_id"]), price="9.00", currency="USD",
    )


def _driver(catalog_id: str, logic_min: float = 2.7, logic_max: float = 5.5, channel_current: float = 1.2):
    ports = [
        _port("vcc", "power_in", logic_min, logic_max),
        _port("vm", "power_in", 4.5, 13.5),
        _port("gnd", "ground"),
        _port("stby", "digital_input", logic=logic_min),
    ]
    for ch in ("a", "b"):
        ports += [
            _port(f"pwm{ch}", "pwm_input", logic=logic_min),
            _port(f"{ch}in1", "digital_input", logic=logic_min),
            _port(f"{ch}in2", "digital_input", logic=logic_min),
            _port(f"{ch}o1", "motor_output", current=channel_current),
            _port(f"{ch}o2", "motor_output", current=channel_current),
        ]
    return _component(
        catalog_id, "motor_driver", (26, 6, 20),
        [_mount("base", "deck_standoff", mates=["electronics_deck"])],
        sorted(ports, key=lambda p: p["port_id"]), price="5.50", currency="USD",
    )


def _motor(catalog_id: str, stall_current: float | None, price: str | None = "3.00", currency: str = "USD"):
    return _component(
        catalog_id, "motor", (70, 22, 19),
        [
            _mount("base", "motor_bracket", mates=["motor_bracket"]),
            _mount("shaft", "d_shaft", pos=(0, 0, 0), mates=["wheel_hub"]),
        ],
        [_port("m_pos", "motor_power", 3.0, 6.0, stall_current), _port("m_neg", "motor_power", 3.0, 6.0, stall_current)],
        price=price, currency=currency, material="polymer",
    )


def _battery(catalog_id: str, volts: float):
    return _component(
        catalog_id, "power_supply", (58, 16, 62),
        [_mount("base", "battery_bay", mates=["battery_bay"])],
        [_port("v_out", "power_output", volts, volts, 2.0), _port("gnd", "ground")],
        price="4.00", currency="USD", material="polymer",
    )


def synthetic_catalog_records() -> list[dict[str, Any]]:
    chassis_mounts = [
        # Motors sit under the plate, shafts pointing outward along +/-x.
        _mount("motor_left", "motor_bracket", pos=(-40, -12, 30), rot=(0, 180, 0), mates=["motor_bracket"]),
        _mount("motor_right", "motor_bracket", pos=(40, -12, 30), mates=["motor_bracket"]),
        _mount("caster_rear", "caster_pad", pos=(0, -3, -70), mates=["caster_pad"]),
        _mount("controller_deck", "electronics_deck", pos=(-22, 3, -20), mates=["deck_standoff"]),
        _mount("driver_deck", "electronics_deck", pos=(26, 3, -20), mates=["deck_standoff"]),
        _mount("front_sensor", "sensor_bracket", pos=(0, 12, 85), mates=["sensor_face"]),
        _mount("power_deck", "battery_bay", pos=(0, 3, 30), mates=["battery_bay"]),
        _mount("power_usb", "battery_bay", pos=(0, 3, -60), mates=["battery_bay"]),
    ]
    records = [
        _component("synthetic.chassis", "chassis", (130, 3, 180), chassis_mounts, [], price="12.00", currency="USD", material="polymer"),
        _motor("synthetic.motor", stall_current=0.8),
        _motor("synthetic.motor_high_stall", stall_current=2.8),
        _motor("synthetic.motor_unrated", stall_current=None, price=None),
        _motor("synthetic.motor_eur", stall_current=0.8, price="2.80", currency="EUR"),
        _component(
            "synthetic.wheel", "wheel", (65, 26, 65),
            [_mount("hub", "wheel_hub", rot=(0, 0, 90), mates=["d_shaft"])], [],
            price="2.00", currency="USD", material="rubber",
        ),
        _component(
            "synthetic.caster", "caster", (24, 18, 24),
            [_mount("base", "caster_pad", mates=["caster_pad"])], [], price="1.50", currency="USD", material="metal",
        ),
        _controller("synthetic.controller", _OUTPUT_GPIOS),
        _controller("synthetic.controller_few_pins", [4, 5, 13, 14], restricted=False),
        _driver("synthetic.driver"),
        _driver("synthetic.driver_5v_logic", logic_min=4.5, logic_max=5.5),
        _driver("synthetic.driver_high_current", channel_current=3.2),
        _component(
            "synthetic.range_sensor", "distance_sensor", (20, 3, 18),
            [_mount("base", "sensor_face", mates=["sensor_bracket"])],
            [
                _port("vin", "power_in", 2.6, 5.5),
                _port("gnd", "ground"),
                _port("sda", "i2c_sda", logic=3.3, notes=SYNTHETIC_NOTE + "; i2c address 0x29"),
                _port("scl", "i2c_scl", logic=3.3, notes=SYNTHETIC_NOTE + "; i2c address 0x29"),
            ],
            price=None,
        ),
        _battery("synthetic.battery_6v", 6.0),
        _battery("synthetic.battery_18v", 18.0),
        _component(
            "synthetic.usb_power", "power_supply", (45, 14, 40),
            [_mount("base", "battery_bay", mates=["battery_bay"])],
            [_port("v_5", "power_output", 5.0, 5.0, 1.0), _port("gnd", "ground")],
            price="6.00", currency="USD", material="polymer",
        ),
        _component("synthetic.wire_kit", "wiring", (80, 5, 40), [], [], price="2.50", currency="USD", material="polymer"),
    ]
    return sorted(records, key=lambda r: r["catalog_id"])


# --- one complete synthetic plan ---------------------------------------------------

_COMPONENTS = [
    ("chassis-1", "synthetic.chassis", "chassis", None, None, None, (0, 40, 0), (0, 0, 0)),
    ("motor-left-1", "synthetic.motor", "motor", "chassis-1", "motor_left", "base", (-40, 28, 30), (0, 180, 0)),
    ("motor-right-1", "synthetic.motor", "motor", "chassis-1", "motor_right", "base", (40, 28, 30), (0, 0, 0)),
    ("wheel-left-1", "synthetic.wheel", "wheel", "motor-left-1", "shaft", "hub", (-40, 28, 30), (0, 180, -90)),
    ("wheel-right-1", "synthetic.wheel", "wheel", "motor-right-1", "shaft", "hub", (40, 28, 30), (0, 0, -90)),
    ("caster-1", "synthetic.caster", "caster", "chassis-1", "caster_rear", "base", (0, 37, -70), (0, 0, 0)),
    ("controller-1", "synthetic.controller", "controller", "chassis-1", "controller_deck", "base", (-22, 43, -20), (0, 0, 0)),
    ("driver-1", "synthetic.driver", "motor_driver", "chassis-1", "driver_deck", "base", (26, 43, -20), (0, 0, 0)),
    ("sensor-1", "synthetic.range_sensor", "distance_sensor", "chassis-1", "front_sensor", "base", (0, 52, 85), (0, 0, 0)),
    ("power-motor-1", "synthetic.battery_6v", "motor_power", "chassis-1", "power_deck", "base", (0, 43, 30), (0, 0, 0)),
    ("power-control-1", "synthetic.usb_power", "controller_power", "chassis-1", "power_usb", "base", (0, 43, -60), (0, 0, 0)),
    ("wires-1", "synthetic.wire_kit", "accessory", "chassis-1", None, None, (0, 40, 0), (0, 0, 0)),
]

# (connection_id, from instance, from port, to instance, to port, net)
_NETS = [
    ("w-pwma", "controller-1", "gpio25", "driver-1", "pwma", "MOTOR_LEFT_PWM"),
    ("w-ain1", "controller-1", "gpio26", "driver-1", "ain1", "MOTOR_LEFT_IN1"),
    ("w-ain2", "controller-1", "gpio27", "driver-1", "ain2", "MOTOR_LEFT_IN2"),
    ("w-pwmb", "controller-1", "gpio14", "driver-1", "pwmb", "MOTOR_RIGHT_PWM"),
    ("w-bin1", "controller-1", "gpio32", "driver-1", "bin1", "MOTOR_RIGHT_IN1"),
    ("w-bin2", "controller-1", "gpio33", "driver-1", "bin2", "MOTOR_RIGHT_IN2"),
    ("w-stby", "controller-1", "gpio4", "driver-1", "stby", "MOTOR_STANDBY"),
    ("w-sda", "controller-1", "gpio21", "sensor-1", "sda", "I2C_SDA"),
    ("w-scl", "controller-1", "gpio22", "sensor-1", "scl", "I2C_SCL"),
    ("w-logic-driver", "controller-1", "v3v3_out", "driver-1", "vcc", "V3V3"),
    ("w-logic-sensor", "controller-1", "v3v3_out", "sensor-1", "vin", "V3V3"),
    ("w-ao1", "driver-1", "ao1", "motor-left-1", "m_pos", "MOTOR_LEFT_A"),
    ("w-ao2", "driver-1", "ao2", "motor-left-1", "m_neg", "MOTOR_LEFT_B"),
    ("w-bo1", "driver-1", "bo1", "motor-right-1", "m_pos", "MOTOR_RIGHT_A"),
    ("w-bo2", "driver-1", "bo2", "motor-right-1", "m_neg", "MOTOR_RIGHT_B"),
    ("w-vm", "power-motor-1", "v_out", "driver-1", "vm", "VMOTOR"),
    ("w-vin", "power-control-1", "v_5", "controller-1", "vin_5v", "V5"),
    ("w-gnd-motor", "power-motor-1", "gnd", "driver-1", "gnd", "GND"),
    ("w-gnd-driver", "controller-1", "gnd", "driver-1", "gnd", "GND"),
    ("w-gnd-sensor", "controller-1", "gnd", "sensor-1", "gnd", "GND"),
    ("w-gnd-usb", "power-control-1", "gnd", "controller-1", "gnd", "GND"),
]

SYNTHETIC_PIN_MAP = {
    "motor_left_pwm": 25,
    "motor_left_in1": 26,
    "motor_left_in2": 27,
    "motor_right_pwm": 14,
    "motor_right_in1": 32,
    "motor_right_in2": 33,
    "motor_standby": 4,
    "i2c_sda": 21,
    "i2c_scl": 22,
}


def synthetic_plan_dict() -> dict[str, Any]:
    prices = {r["catalog_id"]: r["sourcing"]["price_amount"] for r in synthetic_catalog_records()}
    components = [
        {
            "instance_id": iid,
            "catalog_id": cid,
            "role": role,
            "parent_instance_id": parent,
            "attached_to_mount_id": parent_mount,
            "own_mount_id": own_mount,
            "pose": {"position_mm": list(pos), "rotation_deg": list(rot)},
            "render_overrides": {},
        }
        for iid, cid, role, parent, parent_mount, own_mount, pos, rot in _COMPONENTS
    ]
    groups: dict[str, list[str]] = {}
    for c in components:
        groups.setdefault(c["catalog_id"], []).append(c["instance_id"])
    bom_items = [
        {
            "catalog_id": cid,
            "quantity": len(ids),
            "instance_ids": ids,
            "unit_price_amount": prices[cid],
            "purchase_url": None,
            "link_status": "not_available",
        }
        for cid, ids in sorted(groups.items())
    ]
    steps = [
        ("Prepare the chassis", ["chassis-1"]),
        ("Mount both motors", ["motor-left-1", "motor-right-1"]),
        ("Fit the wheels and caster", ["wheel-left-1", "wheel-right-1", "caster-1"]),
        ("Mount controller, driver and sensor", ["controller-1", "driver-1", "sensor-1"]),
        ("Place power supplies (disconnected)", ["power-motor-1", "power-control-1"]),
        ("Wire signals, motor outputs and grounds", ["controller-1", "driver-1", "sensor-1", "motor-left-1", "motor-right-1", "wires-1"]),
        ("Check wiring before connecting power", ["controller-1", "driver-1", "power-motor-1", "power-control-1"]),
    ]
    return {
        "schema_version": "1.0",
        "build_id": "synthetic-test-rover",
        "revision": 1,
        "project_family": "rover",
        "title": "SYNTHETIC TEST rover",
        "source_intent_id": "intent-rover-001",
        "created_at": "2026-10-24T00:00:00Z",
        "status": "needs_review",
        "components": components,
        "connections": [
            {
                "connection_id": conn_id,
                "kind": "electrical",
                "from": {"instance_id": a, "port_id": ap},
                "to": {"instance_id": b, "port_id": bp},
                "net_name": net,
                "notes": None,
            }
            for conn_id, a, ap, b, bp, net in _NETS
        ],
        "verification": {"overall": "needs_review", "findings": []},
        "assembly_steps": [
            {
                "step": n,
                "title": title,
                "instance_ids": ids,
                "instructions": f"{title}. SYNTHETIC TEST step.",
                "safety_notes": ["Do not connect batteries until the wiring check passes."] if n >= 5 else [],
            }
            for n, (title, ids) in enumerate(steps, start=1)
        ],
        "bom": {
            "currency": "USD",
            "known_subtotal_amount": None,
            "total_status": "incomplete",
            "items": bom_items,
        },
        "behavior": {
            "profile_id": "rover.obstacle_avoidance.v1",
            "controller_catalog_id": "synthetic.controller",
            "parameters": {"obstacle_stop_distance_m": 0.25, "turn_duration_ms": 600, "forward_speed_fraction": 0.45},
        },
        "simulation": {
            "kind": "differential_drive_2d",
            "enabled": True,
            "wheel_radius_m": 0.0325,
            "wheel_base_m": 0.106,
            "max_wheel_speed_mps": 0.2,
            "sensor_range_m": 1.0,
            "sensor_fov_deg": 25,
            "limitations": ["Synthetic test values"],
        },
        "firmware": {
            "target": "esp32_arduino_platformio",
            "profile_id": "rover.obstacle_avoidance.v1",
            "pin_map": dict(SYNTHETIC_PIN_MAP),
            "compile_status": "not_checked",
        },
        "provenance": {
            "input_mode": "image_and_text",
            "catalog_version": CATALOG_VERSION,
            "generation_mode": "manual_template",
            "notes": ["SYNTHETIC TEST plan; not a buildable design"],
        },
    }


def substitute(plan: dict[str, Any], instance_ids: list[str], catalog_id: str) -> dict[str, Any]:
    """Return a copy of a plan dict with some instances (and BOM rows) moved to another catalog item."""
    out = copy.deepcopy(plan)
    for c in out["components"]:
        if c["instance_id"] in instance_ids:
            c["catalog_id"] = catalog_id
    groups: dict[str, list[str]] = {}
    for c in out["components"]:
        groups.setdefault(c["catalog_id"], []).append(c["instance_id"])
    prices = {r["catalog_id"]: r["sourcing"]["price_amount"] for r in synthetic_catalog_records()}
    out["bom"]["items"] = [
        {
            "catalog_id": cid,
            "quantity": len(ids),
            "instance_ids": ids,
            "unit_price_amount": prices.get(cid),
            "purchase_url": None,
            "link_status": "not_available",
        }
        for cid, ids in sorted(groups.items())
    ]
    return out
