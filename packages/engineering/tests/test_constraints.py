import copy
import random

import pytest

from rivet_engine.catalog import catalog_from_records
from rivet_engine.models import BuildPlan, IntentRequirements, Pose
from rivet_engine.ports import AABB, VerificationContext, finding
from rivet_engine.validators import aggregate, verify_candidate
from tests import support


# --- helpers --------------------------------------------------------------------------


def box_bounds(instance, component):
    """Test-local axis-aligned bounds (ignores rotation); keeps P4 tests independent of mounts.py."""
    d = component.physical.dimensions_mm
    p = instance.pose.position_mm
    return AABB(tuple(p[i] - s / 2 for i, s in enumerate((d.x, d.y, d.z))), tuple(p[i] + s / 2 for i, s in enumerate((d.x, d.y, d.z))))


def real_records():
    """Synthetic records re-labelled as verified non-synthetic parts, to exercise PASS paths."""
    records = support.synthetic_catalog_records()
    for r in records:
        r["catalog_id"] = r["catalog_id"].replace("synthetic.", "testpart.")
        r["identity"]["manufacturer"] = "Test fixture"
        r["physical"]["bounds_verified"] = True
        r["evidence"].update(dimensions="verified", electrical="verified")
        r["sourcing"]["availability_status"] = "in_stock"
    return records


def real_plan_dict(raw=None):
    raw = raw if raw is not None else support.synthetic_plan_dict()
    text = repr(raw).replace("synthetic.", "testpart.")
    plan = eval(text)  # noqa: S307 - repr/eval of plain JSON data built in this test
    plan["behavior"]["controller_catalog_id"] = "testpart.controller"
    return plan


def run(plan_dict=None, records=None, **context):
    plan = BuildPlan.model_validate(plan_dict if plan_dict is not None else real_plan_dict())
    catalog = catalog_from_records(records if records is not None else real_records(), "t")
    context.setdefault("bounds", box_bounds)
    return verify_candidate(plan, catalog, VerificationContext(**context))


def non_pass(report, rule_id=None):
    return [f for f in report.findings if f.result != "PASS" and (rule_id is None or f.rule_id == rule_id)]


def swap(_plan, instance_ids, catalog_id):
    """Swap parts on the synthetic plan (so BOM prices follow), then relabel as test parts."""
    return real_plan_dict(support.substitute(support.synthetic_plan_dict(), instance_ids, catalog_id.replace("testpart.", "synthetic.")))


def requirements(**kw):
    base = dict(max_budget=None, currency="USD", max_length_mm=None, max_width_mm=None,
                preferred_controller_catalog_id=None, required_capabilities=[], preferred_color=None)
    return IntentRequirements(**{**base, **kw})


# --- aggregation ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "results,expected",
    [
        ([], "verified"),
        ([("PASS", "blocking")], "verified"),
        ([("PASS", "blocking"), ("WARN", "advisory")], "verified_with_warnings"),
        ([("UNKNOWN", "advisory")], "verified_with_warnings"),
        ([("FAIL", "advisory")], "verified_with_warnings"),
        ([("UNKNOWN", "blocking"), ("WARN", "advisory")], "needs_review"),
        ([("UNKNOWN", "blocking"), ("FAIL", "blocking")], "unbuildable"),
    ],
)
def test_aggregation(results, expected):
    assert aggregate([finding("r", r, s, "m") for r, s in results]) == expected


# --- valid combination -------------------------------------------------------------------


def test_valid_supported_combination_is_verified():
    report = run()
    assert non_pass(report) == [], [f"{f.rule_id}: {f.message}" for f in non_pass(report)]
    assert report.overall == "verified"
    assert all(f.result == "PASS" for f in report.findings)


def test_synthetic_parts_never_verify():
    report = verify_candidate(support.synthetic_plan(), support.synthetic_catalog(), VerificationContext(bounds=box_bounds))
    assert report.overall == "needs_review"
    [f] = non_pass(report, "completeness.real_parts")
    assert f.severity == "blocking" and f.result == "UNKNOWN"


def test_approximated_ratings_downgrade_pass_to_warning():
    records = real_records()
    for r in records:
        r["evidence"]["electrical"] = "approximated"
    report = run(records=records)
    assert report.overall == "verified_with_warnings"
    assert non_pass(report, "electrical.supply_voltage")


# --- required failure cases (B5 list) ---------------------------------------------------------


def test_wrong_logic_voltage():
    report = run(swap(real_plan_dict(), ["driver-1"], "testpart.driver_5v_logic"))
    [f] = [f for f in non_pass(report, "electrical.supply_voltage") if "driver-1.vcc" in f.message]
    assert f.result == "FAIL" and f.severity == "blocking"
    assert report.overall == "unbuildable"


def test_not_enough_pins():
    report = run(swap(real_plan_dict(), ["controller-1"], "testpart.controller_few_pins"))
    assert any("gpio25" in f.message for f in non_pass(report, "integrity.connections"))
    assert report.overall == "unbuildable"


def test_shared_gpio_conflict():
    plan = real_plan_dict()
    plan["connections"][1]["from"]["port_id"] = "gpio25"  # AIN1 on the PWMA pin
    report = run(plan)
    assert any("shared by nets" in f.message for f in non_pass(report, "electrical.gpio_usage"))


def test_input_only_and_reserved_pins():
    plan = real_plan_dict()
    plan["connections"][0]["from"]["port_id"] = "gpio34"
    plan["firmware"]["pin_map"]["motor_left_pwm"] = 34
    report = run(plan)
    assert any("input-only" in f.message for f in non_pass(report, "electrical.gpio_usage"))
    plan["connections"][0]["from"]["port_id"] = "gpio0"
    plan["firmware"]["pin_map"]["motor_left_pwm"] = 0
    [f] = non_pass(run(plan), "electrical.gpio_usage")
    assert f.result == "WARN" and "strapping" in f.message


def test_impossible_mount():
    plan = real_plan_dict()
    records = real_records()
    caster = next(r for r in records if r["catalog_id"] == "testpart.caster")
    caster["mounts"][0]["kind"] = "magnet"
    report = run(plan, records)
    assert non_pass(report, "mechanical.mount_mates")[0].result == "FAIL"
    assert report.overall == "unbuildable"


def test_invalid_mount_reference():
    plan = real_plan_dict()
    plan["components"][6]["attached_to_mount_id"] = "roof_rack"
    report = run(plan)
    assert any("roof_rack" in f.message for f in non_pass(report, "integrity.mounts"))


def test_connection_to_missing_driver_is_invalid():
    plan = real_plan_dict()
    plan["components"] = [c for c in plan["components"] if c["instance_id"] != "driver-1"]
    plan["bom"]["items"] = [i for i in plan["bom"]["items"] if "driver-1" not in i["instance_ids"]]
    report = run(plan)
    assert any("'driver-1' is not in the plan" in f.message for f in non_pass(report, "integrity.connections"))
    assert non_pass(report, "completeness.required_motor_driver")
    assert report.overall == "unbuildable"


def test_missing_price_makes_budget_unknown_not_pass():
    plan = swap(real_plan_dict(), ["motor-left-1", "motor-right-1"], "testpart.motor_unrated")
    report = run(plan, requirements=requirements(max_budget="1000"))
    [f] = non_pass(report, "budget.max_budget")
    assert f.result == "UNKNOWN" and f.severity == "blocking"


def test_impossible_budget_fails_even_with_missing_prices():
    plan = swap(real_plan_dict(), ["motor-left-1", "motor-right-1"], "testpart.motor_unrated")
    [f] = non_pass(run(plan, requirements=requirements(max_budget="10")), "budget.max_budget")
    assert f.result == "FAIL"


def test_budget_pass_and_exact_decimal():
    plan = real_plan_dict()
    for item in plan["bom"]["items"]:
        if item["unit_price_amount"] is None:
            item["unit_price_amount"] = "0.10"
    report = run(plan, requirements=requirements(max_budget="50.60"))
    [f] = [f for f in report.findings if f.rule_id == "budget.max_budget"]
    assert f.result == "PASS", f.message
    [f] = non_pass(run(plan, requirements=requirements(max_budget="50.59")), "budget.max_budget")
    assert f.result == "FAIL"


def test_mixed_currency_is_not_summed():
    plan = swap(real_plan_dict(), ["motor-left-1", "motor-right-1"], "testpart.motor_eur")
    [f] = non_pass(run(plan, requirements=requirements(max_budget="1000")), "budget.max_budget")
    assert f.result == "UNKNOWN"
    [f] = non_pass(run(real_plan_dict(), requirements=requirements(max_budget="1000", currency="EUR")), "budget.max_budget")
    assert f.result == "UNKNOWN" and "no conversion" in f.message


def test_unsupported_behavior():
    report = run(requested_behavior="line_following")
    [f] = non_pass(report, "requirements.behavior")
    assert f.result == "FAIL"
    plan = real_plan_dict()
    plan["behavior"]["profile_id"] = "rover.dance.v1"
    assert non_pass(run(plan), "requirements.behavior")


def test_unsupported_family():
    plan = real_plan_dict()
    plan["project_family"] = "drone"
    assert run(plan).overall == "unbuildable"


def test_motor_current_exceeds_driver():
    report = run(swap(real_plan_dict(), ["motor-left-1", "motor-right-1"], "testpart.motor_high_stall"))
    fails = non_pass(report, "electrical.motor_driver_current")
    assert len(fails) == 2 and all(f.result == "FAIL" for f in fails)


def test_motor_current_unknown_when_unrated():
    report = run(swap(real_plan_dict(), ["motor-left-1"], "testpart.motor_unrated"))
    [f] = non_pass(report, "electrical.motor_driver_current")
    assert f.result == "UNKNOWN" and f.severity == "blocking"
    assert f.affected_instance_ids == ["driver-1", "motor-left-1"]


def test_moderate_stall_overshoot_blocks_without_protection():
    records = real_records()
    motor = next(r for r in records if r["catalog_id"] == "testpart.motor")
    for p in motor["ports"]:
        p["current_limit_a"] = 1.5  # 1.25 x the 1.2 A continuous rating
    found = non_pass(run(records=records), "electrical.motor_driver_current")
    assert len(found) == 2 and all(f.result == "FAIL" and f.severity == "blocking" for f in found)


def test_higher_rated_driver_passes():
    report = run(swap(real_plan_dict(), ["driver-1"], "testpart.driver_high_current"))
    assert non_pass(report, "electrical.motor_driver_current") == []


def test_over_voltage_motor_supply():
    report = run(swap(real_plan_dict(), ["power-motor-1"], "testpart.battery_18v"))
    assert non_pass(report, "electrical.motor_voltage")[0].result == "FAIL"
    assert any("driver-1.vm" in f.message for f in non_pass(report, "electrical.supply_voltage"))


def test_missing_ground_and_unwired_ports():
    plan = real_plan_dict()
    plan["connections"] = [c for c in plan["connections"] if c["connection_id"] not in ("w-gnd-sensor", "w-ao1")]
    report = run(plan)
    assert any("sensor-1" in f.message for f in non_pass(report, "electrical.common_ground"))
    assert any("motor-left-1.m_pos" in f.message for f in non_pass(report, "electrical.required_connections"))


def test_incompatible_port_types():
    plan = real_plan_dict()
    plan["connections"][0]["to"]["port_id"] = "vm"
    assert non_pass(run(plan), "electrical.signal_types")


def test_i2c_address_collision():
    plan = real_plan_dict()
    second = copy.deepcopy(next(c for c in plan["components"] if c["instance_id"] == "sensor-1"))
    second["instance_id"] = "sensor-2"
    second["attached_to_mount_id"] = second["own_mount_id"] = None
    plan["components"].append(second)
    next(i for i in plan["bom"]["items"] if "sensor-1" in i["instance_ids"]).update(quantity=2, instance_ids=["sensor-1", "sensor-2"])
    plan["connections"].append({"connection_id": "w-sda-2", "kind": "electrical", "from": {"instance_id": "controller-1", "port_id": "gpio21"},
                                "to": {"instance_id": "sensor-2", "port_id": "sda"}, "net_name": "I2C_SDA", "notes": None})
    [f] = non_pass(run(plan), "electrical.i2c_addresses")
    assert f.result == "FAIL" and "0x29" in f.message


def test_duplicate_instance_ids():
    plan = real_plan_dict()
    plan["components"].append(copy.deepcopy(plan["components"][1]))
    assert non_pass(run(plan), "integrity.instance_ids_unique")


def test_parent_cycle_detected():
    plan = real_plan_dict()
    plan["components"][0]["parent_instance_id"] = "motor-left-1"
    assert any("cycle" in f.message.lower() for f in non_pass(run(plan), "integrity.parents"))


def test_bom_quantity_and_phantom_rows():
    plan = real_plan_dict()
    plan["bom"]["items"][0]["quantity"] = 3
    plan["bom"]["items"].append({"catalog_id": "testpart.caster", "quantity": 1, "instance_ids": ["ghost-1"],
                                 "unit_price_amount": None, "purchase_url": None, "link_status": "not_available"})
    messages = [f.message for f in non_pass(run(plan), "integrity.bom")]
    assert any("quantity 3" in m for m in messages) and any("phantom" in m for m in messages)


def test_bad_step_reference():
    plan = real_plan_dict()
    plan["assembly_steps"][0]["instance_ids"].append("ghost-1")
    assert non_pass(run(plan), "integrity.assembly_steps")


def test_pin_map_must_be_backed_by_wiring():
    plan = real_plan_dict()
    plan["firmware"]["pin_map"]["motor_standby"] = 5
    assert non_pass(run(plan), "firmware.pin_map_backed")[0].result == "FAIL"


def test_unsupported_firmware_target_is_advisory():
    plan = real_plan_dict()
    plan["firmware"]["target"] = "rp2040_micropython"
    [f] = non_pass(run(plan), "firmware.profile_supported")
    assert f.severity == "advisory"


def test_overlap_and_ground_contact_heuristics():
    plan = real_plan_dict()
    plan["components"][9]["pose"]["position_mm"] = [-22, 43, -20]  # battery onto the controller
    plan["components"][5]["pose"]["position_mm"][1] = 60  # caster floating
    report = run(plan)
    assert any("controller-1" in f.affected_instance_ids for f in non_pass(report, "mechanical.overlap"))
    assert non_pass(report, "mechanical.ground_contact")[0].result == "WARN"


def test_missing_bounds_helper_is_unknown():
    report = run(bounds=None)
    assert non_pass(report, "mechanical.overlap")[0].result == "UNKNOWN"
    assert report.overall == "verified_with_warnings"


def test_size_limits():
    [f] = non_pass(run(requirements=requirements(max_width_mm=50)), "requirements.dimensions")
    assert f.result == "FAIL"
    assert non_pass(run(requirements=requirements(max_width_mm=500, max_length_mm=500)), "requirements.dimensions") == []


def test_every_finding_has_canonical_fields():
    for report in (run(), verify_candidate(support.appendix_plan(), support.appendix_catalog())):
        for f in report.findings:
            assert f.rule_id and f.message and isinstance(f.evidence_urls, list) and isinstance(f.affected_instance_ids, list)


def test_deterministic_order_independent_of_input_order():
    plan = real_plan_dict()
    shuffled = copy.deepcopy(plan)
    random.Random(4).shuffle(shuffled["connections"])
    first = [f.to_wire() for f in run(plan).findings]
    assert [f.to_wire() for f in run(plan).findings] == first
    assert [f.to_wire() for f in run(shuffled).findings] == first


def test_appendix_starter_fixture_is_not_verified():
    report = verify_candidate(support.appendix_plan(), support.appendix_catalog())
    assert report.overall in ("needs_review", "unbuildable")
    assert non_pass(report, "completeness.real_parts")


def test_shared_failing_fixture_when_present():
    path = support.shared_fixture("plans/rover_failing_driver_v1.json")
    if path is None:
        pytest.skip("shared failing-driver fixture not landed; covered by synthetic current tests")
    import json

    plan = BuildPlan.model_validate(json.loads(path.read_text()))
    report = verify_candidate(plan, support.appendix_catalog())
    assert report.overall in ("needs_review", "unbuildable")


def test_inputs_not_mutated_and_existing_verification_ignored():
    plan = BuildPlan.model_validate(real_plan_dict())
    plan.verification.findings = [finding("fake.pass", "FAIL", "blocking", "stale")]
    before = plan.to_wire()
    report = verify_candidate(plan, catalog_from_records(real_records(), "t"), VerificationContext(bounds=box_bounds))
    assert plan.to_wire() == before
    assert all(f.rule_id != "fake.pass" for f in report.findings)


def test_current_numbers_without_verified_evidence_cannot_pass():
    records = real_records()
    motor = next(r for r in records if r["catalog_id"] == "testpart.motor")
    motor["evidence"]["electrical"] = "unverified"
    found = non_pass(run(records=records), "electrical.motor_driver_current")
    assert len(found) == 2
    assert all(f.result == "UNKNOWN" and f.severity == "blocking" for f in found)
