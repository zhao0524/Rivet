import copy

import pytest

import rivet_engine
from tests import support


@pytest.fixture(scope="module")
def plan():
    return rivet_engine.solve(support.appendix_intent_dict())


def _sensor_y(p):
    return next(c for c in p["components"] if c["instance_id"] == "sensor-1")["pose"]["position_mm"][1]


def _accept(plan, op):
    before = copy.deepcopy(plan)
    result = rivet_engine.apply_edit(plan, op)
    assert plan == before, "apply_edit mutated its input"
    assert result["accepted"], result
    new = result["plan"]
    assert new["build_id"] == plan["build_id"] and new["revision"] == plan["revision"] + 1
    assert new["status"] == new["verification"]["overall"]
    return new


def _reject(plan, op):
    result = rivet_engine.apply_edit(plan, op)
    assert result["accepted"] is False
    f = result["finding"]
    assert set(f) == {"rule_id", "result", "severity", "affected_instance_ids", "message", "evidence_urls"}
    return f


def test_raise_sensor_within_template(plan):
    new = _accept(plan, {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 15, 0]})
    assert _sensor_y(new) == pytest.approx(_sensor_y(plan) + 15)
    others = lambda p: [c for c in p["components"] if c["instance_id"] != "sensor-1"]
    assert others(new) == others(plan)


def test_sensor_offset_persists_across_later_edits(plan):
    raised = _accept(plan, {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 15, 0]})
    recolored = _accept(raised, {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "#2d3542"})
    assert _sensor_y(recolored) == pytest.approx(_sensor_y(raised))
    chassis = next(c for c in recolored["components"] if c["instance_id"] == "chassis-1")
    assert chassis["render_overrides"] == {"color": "#2D3542"}


@pytest.mark.parametrize("offset", [[0, 40, 0], [0, -20, 0], [10, 0, 0]])
def test_sensor_offset_outside_template_rejected(plan, offset):
    f = _reject(plan, {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": offset})
    assert f["rule_id"] == "edit.placement"


def test_offset_on_fixed_part_rejected(plan):
    _reject(plan, {"op": "set_mount_offset_within_template", "instance_id": "controller-1", "offset_mm": [0, 1, 0]})


def test_cheaper_budget_reverifies_and_is_honest(plan):
    tight = _accept(plan, {"op": "set_budget", "amount": "60", "currency": "USD"})
    assert tight["status"] == "unbuildable"
    roomy = _accept(tight, {"op": "set_budget", "amount": "120", "currency": "USD"})
    [f] = [f for f in roomy["verification"]["findings"] if f["rule_id"] == "budget.max_budget"]
    assert f["result"] == "PASS"
    # The budget carries into later edits.
    later = _accept(roomy, {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 800})
    assert any(f["rule_id"] == "budget.max_budget" for f in later["verification"]["findings"])


def test_invalid_budget_rejected(plan):
    _reject(plan, {"op": "set_budget", "amount": "cheap", "currency": "USD"})


def test_behavior_parameter_edit(plan):
    new = _accept(plan, {"op": "set_behavior_parameter", "name": "obstacle_stop_distance_m", "value": 0.4})
    assert new["behavior"]["parameters"]["obstacle_stop_distance_m"] == 0.4
    assert new["components"] == plan["components"]


@pytest.mark.parametrize(
    "op",
    [
        {"op": "set_behavior_parameter", "name": "max_speed", "value": 3},
        {"op": "set_behavior_parameter", "name": "forward_speed_fraction", "value": 1.5},
        {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": True},
    ],
)
def test_bad_behavior_parameters_rejected(plan, op):
    _reject(plan, op)


def test_replace_sensor_with_catalog_alternative(plan):
    new = _accept(plan, {"op": "replace_optional_sensor", "catalog_id": "sensor.adafruit_vl53l1x_3967"})
    sensor = next(c for c in new["components"] if c["instance_id"] == "sensor-1")
    assert sensor["catalog_id"] == "sensor.adafruit_vl53l1x_3967"
    assert new["simulation"]["sensor_range_m"] == 4.0
    assert any(i["catalog_id"] == "sensor.adafruit_vl53l1x_3967" for i in new["bom"]["items"])
    assert not any(i["catalog_id"] == "sensor.adafruit_vl53l0x_3317" for i in new["bom"]["items"])


@pytest.mark.parametrize("catalog_id", ["driver.adafruit_tb6612_2448", "sensor.made_up", 5])
def test_replace_sensor_with_non_sensor_rejected(plan, catalog_id):
    _reject(plan, {"op": "replace_optional_sensor", "catalog_id": catalog_id})


@pytest.mark.parametrize(
    "op",
    [
        {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "red"},
        {"op": "change_appearance_color", "instance_id": "ghost-1", "color": "#FFFFFF"},
        {"op": "teleport"},
        {},
    ],
)
def test_unsupported_or_bad_edits_rejected(plan, op):
    _reject(plan, op)


def test_edit_on_non_template_plan_rejected():
    f = _reject(support.appendix_plan_dict(), {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 700})
    assert f["rule_id"] == "edit.unsupported_plan"


def test_edits_are_deterministic_ignoring_timestamp(plan):
    op = {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 10, 0]}
    a, b = rivet_engine.apply_edit(plan, op)["plan"], rivet_engine.apply_edit(plan, op)["plan"]
    a.pop("created_at"), b.pop("created_at")
    assert a == b


@pytest.mark.parametrize("offset", [[0, "bad", 0], [0, None, 0], [0, True, 0], [0, float("nan"), 0], [0, float("inf"), 0]])
def test_malformed_sensor_offsets_are_structured_rejections(plan, offset):
    _reject(plan, {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": offset})


def test_unhashable_offset_instance_id_is_rejected(plan):
    _reject(plan, {"op": "set_mount_offset_within_template", "instance_id": [], "offset_mm": [0, 1, 0]})


def test_clearing_budget_preserves_null_without_traceback(plan):
    tight = _accept(plan, {"op": "set_budget", "amount": "60", "currency": "USD"})
    cleared = _accept(tight, {"op": "set_budget", "amount": None, "currency": "USD"})
    assert not any(f["rule_id"] == "budget.max_budget" for f in cleared["verification"]["findings"])


def test_size_requirements_survive_generation_and_edits():
    intent = support.appendix_intent_dict()
    intent["requirements"]["max_length_mm"] = 10
    intent["requirements"]["max_width_mm"] = 10
    constrained = rivet_engine.solve(intent)
    changed = _accept(constrained, {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "#123456"})
    for candidate in (constrained, changed):
        size = [f for f in candidate["verification"]["findings"] if f["rule_id"] == "requirements.dimensions"]
        assert size and all(f["result"] == "FAIL" for f in size)
