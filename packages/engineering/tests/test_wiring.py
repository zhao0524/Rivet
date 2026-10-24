import copy
from collections import Counter

import pytest

from rivet_engine import mounts, wiring
from rivet_engine.catalog import load_catalog
from rivet_engine.ports import PlacementOptions, RoverSelection
from tests import support

# SYNTHETIC TEST-ONLY profile for the synthetic controller/driver. GPIO restrictions mirror
# the synthetic catalog notes; nothing here describes a real board.
SYNTHETIC_PROFILE = {
    "schema_version": "1.0",
    "profile_id": "synthetic.test.v1",
    "controller_catalog_id": "synthetic.controller",
    "driver_catalog_ids": ["synthetic.driver", "synthetic.driver_5v_logic", "synthetic.driver_high_current"],
    "controller_logic_v": 3.3,
    "evidence_urls": [],
    "reserved_gpio": [{"gpio": [0, 2, 12, 15], "reason": "synthetic strapping"}, {"gpio": [34, 35, 36, 39], "reason": "input only"}],
    "i2c": {"sda_gpio": 21, "scl_gpio": 22},
    "output_gpio_order": [25, 26, 27, 32, 33, 16, 17, 18, 19, 23, 4, 13, 0, 34],
    "controller_ports": {"logic_out": "v3v3_out", "power_in": "vin_5v", "ground": "gnd"},
    "driver_ports": {"logic_in": "vcc", "motor_in": "vm", "ground": "gnd"},
    "driver_signals": {
        "motor_left_pwm": "pwma",
        "motor_left_in1": "ain1",
        "motor_left_in2": "ain2",
        "motor_right_pwm": "pwmb",
        "motor_right_in1": "bin1",
        "motor_right_in2": "bin2",
        "motor_standby": "stby",
    },
    "motor_outputs": {"motor-left-1": ["ao1", "ao2"], "motor-right-1": ["bo1", "bo2"]},
}

SYNTHETIC_SELECTION = RoverSelection(
    chassis="synthetic.chassis",
    motor="synthetic.motor",
    wheel="synthetic.wheel",
    caster="synthetic.caster",
    controller="synthetic.controller",
    motor_driver="synthetic.driver",
    distance_sensor="synthetic.range_sensor",
    motor_power="synthetic.battery_6v",
    controller_power="synthetic.usb_power",
)

SOURCED_SELECTION = RoverSelection(
    chassis="chassis.sparkfun_shadow_rob13301",
    motor="motor.adafruit_tt_gearbox_200rpm_3777",
    wheel="wheel.adafruit_tt_wheel_3766",
    caster="caster.sparkfun_shadow_nub",
    controller="board.esp32_devkitc_v4_wroom32e",
    motor_driver="driver.adafruit_tb6612_2448",
    distance_sensor="sensor.adafruit_vl53l0x_3317",
    motor_power="power.sparkfun_shadow_4xaa_holder",
    controller_power="power.adafruit_usb_power_bank_5000_4288",
)


def _wire(selection=SYNTHETIC_SELECTION, catalog=None, profile=SYNTHETIC_PROFILE):
    catalog = catalog or support.synthetic_catalog()
    placed = mounts.place_rover(selection, catalog, PlacementOptions())
    return placed.components, wiring.wire_rover(placed.components, catalog, [profile])


def _sourced():
    catalog = load_catalog()
    placed = mounts.place_rover(SOURCED_SELECTION, catalog)
    return catalog, placed.components, wiring.wire_rover(placed.components, catalog)


def _endpoints(result):
    for c in result.connections:
        yield c.from_
        yield c.to


def test_every_endpoint_resolves_to_a_real_port():
    for catalog, components, result in [(support.synthetic_catalog(), *_wire()), _sourced()]:
        by_id = {c.instance_id: c for c in components}
        for end in _endpoints(result):
            assert catalog.require(by_id[end.instance_id].catalog_id).port(end.port_id), (end.instance_id, end.port_id)


def test_sourced_rover_wires_completely_with_no_findings():
    catalog, components, result = _sourced()
    assert result.findings == ()
    assert set(result.pin_map) == set(wiring.MOTOR_SIGNALS + wiring.I2C_SIGNALS)
    assert result.pin_map["i2c_sda"] == 21 and result.pin_map["i2c_scl"] == 22


def test_sourced_pins_avoid_reserved_and_never_repeat():
    _, _, result = _sourced()
    profile = wiring.load_profiles()[0]
    reserved = {g for group in profile["reserved_gpio"] for g in group["gpio"]}
    pins = list(result.pin_map.values())
    assert len(pins) == len(set(pins))
    assert not set(pins) & reserved
    assert not set(pins) & set(range(6, 12))


def test_pin_map_matches_connections():
    _, _, result = _sourced()
    by_net = {c.net_name: c for c in result.connections}
    for signal, gpio in result.pin_map.items():
        conn = by_net[signal.upper()]
        assert conn.from_.instance_id == "controller-1" and conn.from_.port_id == f"gpio{gpio}"


def test_netlist_has_both_motor_channels_supplies_and_common_ground():
    _, _, result = _sourced()
    nets = Counter(c.net_name for c in result.connections)
    for name in ("MOTOR_LEFT_A", "MOTOR_LEFT_B", "MOTOR_RIGHT_A", "MOTOR_RIGHT_B", "V_MOTOR", "V_CONTROLLER"):
        assert nets[name] == 1, name
    assert nets["V_LOGIC"] == 2
    grounded = {e.instance_id for c in result.connections if c.net_name == "GND" for e in (c.from_, c.to)}
    # The USB power bank has no separate ground port; its ground travels in the USB cable.
    assert grounded == {"controller-1", "driver-1", "sensor-1", "power-motor-1"}


def test_wiring_is_reproducible():
    a = [c.to_wire() for c in _sourced()[2].connections]
    b = [c.to_wire() for c in _sourced()[2].connections]
    assert a == b
    ids = [c["connection_id"] for c in a]
    assert len(ids) == len(set(ids))


def test_no_profile_means_no_invented_pins():
    components, result = _wire(profile={**SYNTHETIC_PROFILE, "controller_catalog_id": "synthetic.other"})
    assert result.connections == () and result.pin_map == {}
    [f] = result.findings
    assert f.rule_id == "wiring.profile_supported" and f.result == "UNKNOWN" and f.severity == "blocking"


def test_exhausted_pins_fail_and_skip_signals():
    selection = RoverSelection(**{**SYNTHETIC_SELECTION.__dict__, "controller": "synthetic.controller_few_pins"})
    profile = {**SYNTHETIC_PROFILE, "controller_catalog_id": "synthetic.controller_few_pins", "output_gpio_order": [4, 5, 13, 14]}
    _, result = _wire(selection, profile=profile)
    fails = [f for f in result.findings if f.rule_id == "wiring.gpio_available"]
    assert len(fails) == 3
    assert set(result.pin_map) >= {"motor_left_pwm", "motor_left_in1", "motor_left_in2", "motor_right_pwm"}
    assert "motor_standby" not in result.pin_map
    assert all(f.result == "FAIL" for f in fails)


def test_reserved_and_input_only_pins_never_allocated():
    _, result = _wire()
    assert 0 not in result.pin_map.values() and 34 not in result.pin_map.values()


def test_incompatible_logic_supply_is_reported():
    selection = RoverSelection(**{**SYNTHETIC_SELECTION.__dict__, "motor_driver": "synthetic.driver_5v_logic"})
    _, result = _wire(selection)
    [f] = [f for f in result.findings if f.rule_id == "wiring.logic_supply_range"]
    assert f.result == "FAIL" and "driver-1" in f.affected_instance_ids


def test_unrated_logic_input_is_unknown_not_pass():
    catalog_records = support.synthetic_catalog_records()
    sensor = next(r for r in catalog_records if r["catalog_id"] == "synthetic.range_sensor")
    vin = next(p for p in sensor["ports"] if p["port_id"] == "vin")
    vin["voltage_min_v"] = vin["voltage_max_v"] = None
    from rivet_engine.catalog import catalog_from_records

    _, result = _wire(catalog=catalog_from_records(catalog_records, "t"))
    [f] = [f for f in result.findings if f.rule_id == "wiring.logic_supply_range"]
    assert f.result == "UNKNOWN"


def test_sensor_without_i2c_is_unsupported():
    records = support.synthetic_catalog_records()
    sensor = next(r for r in records if r["catalog_id"] == "synthetic.range_sensor")
    sensor["ports"] = [p for p in sensor["ports"] if p["signal"] not in ("i2c_sda", "i2c_scl")]
    from rivet_engine.catalog import catalog_from_records

    _, result = _wire(catalog=catalog_from_records(records, "t"))
    assert any(f.rule_id == "wiring.sensor_bus_supported" for f in result.findings)
    assert "i2c_sda" not in result.pin_map


def test_missing_profile_port_fails_instead_of_inventing():
    profile = copy.deepcopy(SYNTHETIC_PROFILE)
    profile["driver_signals"]["motor_standby"] = "enable"
    _, result = _wire(profile=profile)
    assert any(f.rule_id == "wiring.port_missing" for f in result.findings)
    assert "motor_standby" not in result.pin_map


def test_missing_driver_reported():
    components, _ = _wire()
    without = [c for c in components if c.role != "motor_driver"]
    result = wiring.wire_rover(without, support.synthetic_catalog(), [SYNTHETIC_PROFILE])
    assert result.connections == ()
    assert result.findings[0].rule_id == "wiring.required_parts"


def test_wiring_never_claims_current_or_compile_results():
    _, _, result = _sourced()
    assert not any(f.result == "PASS" for f in result.findings)
    assert not any("current" in f.rule_id for f in result.findings)


def test_wiring_does_not_mutate_inputs():
    catalog = load_catalog()
    placed = mounts.place_rover(SOURCED_SELECTION, catalog)
    before = [c.to_wire() for c in placed.components]
    wiring.wire_rover(placed.components, catalog)
    assert [c.to_wire() for c in placed.components] == before


def test_packaged_profiles_reference_real_catalog_ids():
    catalog = load_catalog()
    for profile in wiring.load_profiles():
        assert profile["controller_catalog_id"] in catalog
        assert all(d in catalog for d in profile["driver_catalog_ids"])
        assert profile["evidence_urls"]
