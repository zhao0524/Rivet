"""Regression tests for the Developer B defect review (PR #21 review and B1-B6 audit)."""

import copy
import json
import re
from dataclasses import replace
from pathlib import Path

import pytest

import rivet_engine
from rivet_engine import configurator
from rivet_engine.catalog import catalog_from_records, load_catalog, load_fit_evidence
from rivet_engine.configurator import Builder, edit_plan, parse_intent, select_parts
from rivet_engine.models import BuildPlan
from rivet_engine.ports import CatalogError, InvalidInputError, VerificationContext
from rivet_engine.validators import verify_candidate
from rivet_engine.wiring import load_profiles
from tests import support
from tests.test_wiring import SYNTHETIC_PROFILE

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def plan():
    return rivet_engine.solve(support.appendix_intent_dict())


def _findings(p, rule_id):
    return [f for f in p["verification"]["findings"] if f["rule_id"] == rule_id]


def _with_state(p, note):
    out = copy.deepcopy(p)
    out["provenance"]["notes"] = [n for n in out["provenance"]["notes"] if not n.startswith("engine_state: ")] + [note]
    return out


# --- review 1: edits that add a blocking failure are rejected ------------------------


def test_edit_adding_a_blocking_failure_is_rejected_and_names_it(plan):
    result = rivet_engine.apply_edit(plan, {"op": "set_budget", "amount": "50", "currency": "USD"})
    assert result["accepted"] is False
    assert result["finding"]["rule_id"] == "budget.max_budget"
    assert "plan" not in result


def test_edit_on_already_failing_plan_is_accepted_when_it_adds_nothing(plan):
    assert plan["status"] == "unbuildable"  # motor current FAILs exist before the edit
    result = rivet_engine.apply_edit(plan, {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "#101010"})
    assert result["accepted"] is True and result["plan"]["revision"] == plan["revision"] + 1


# --- review 2: unhashable / non-string ids are rejected, not crashed -----------------


@pytest.mark.parametrize("instance_id", [["x"], {"a": 1}, 5, None])
def test_color_edit_with_bad_instance_id_is_rejected(plan, instance_id):
    result = rivet_engine.apply_edit(plan, {"op": "change_appearance_color", "instance_id": instance_id, "color": "#FFFFFF"})
    assert result["accepted"] is False and result["finding"]["rule_id"] == "edit.color"


@pytest.mark.parametrize("instance_id", [["x"], 7])
def test_offset_edit_with_bad_instance_id_is_rejected(plan, instance_id):
    result = rivet_engine.apply_edit(plan, {"op": "set_mount_offset_within_template", "instance_id": instance_id, "offset_mm": [0, 1, 0]})
    assert result["accepted"] is False


# --- review 3 and 7: malformed engine_state is an input error ------------------------------


@pytest.mark.parametrize(
    "note",
    [
        'engine_state: {"max_length_mm": "abc"}',
        'engine_state: {"mount_offsets": {"sensor-1": [1, 2]}}',
        'engine_state: {"mount_offsets": {"sensor-1": [0, "up", 0]}}',
        'engine_state: {"max_budget": "lots"}',
        'engine_state: {"currency": "dollars"}',
        'engine_state: {"surprise": 1}',
        "engine_state: {not json",
    ],
)
def test_malformed_state_is_invalid_input_everywhere(plan, note):
    bad = _with_state(plan, note)
    with pytest.raises(InvalidInputError):
        rivet_engine.verify(bad)
    with pytest.raises(InvalidInputError):
        rivet_engine.apply_edit(bad, {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "#FFFFFF"})


def test_duplicate_state_notes_rejected(plan):
    bad = copy.deepcopy(plan)
    bad["provenance"]["notes"].append(next(n for n in plan["provenance"]["notes"] if n.startswith("engine_state: ")))
    with pytest.raises(InvalidInputError):
        rivet_engine.verify(bad)


def test_state_round_trips(plan):
    raised = rivet_engine.apply_edit(plan, {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 12, 0]})["plan"]
    state = configurator.EngineState.from_plan(BuildPlan.model_validate(raised))
    assert state.mount_offsets == {"sensor-1": (0.0, 12.0, 0.0)}
    assert configurator.EngineState.from_plan(BuildPlan.model_validate(raised)).note() in raised["provenance"]["notes"]


# --- review 4: currency -------------------------------------------------------------


def test_non_usd_budget_edit_rejected_and_pricing_untouched(plan):
    result = rivet_engine.apply_edit(plan, {"op": "set_budget", "amount": "500", "currency": "EUR"})
    assert result["accepted"] is False and "no conversion" in result["finding"]["message"]


def test_non_usd_intent_keeps_usd_bom_and_reports_budget_unknown():
    intent = support.appendix_intent_dict()
    intent["requirements"].update(max_budget="500", currency="EUR")
    p = rivet_engine.solve(intent)
    assert p["bom"]["currency"] == "USD" and p["bom"]["total_status"] == "complete"
    assert all(i["unit_price_amount"] is not None for i in p["bom"]["items"])
    [f] = _findings(p, "budget.max_budget")
    assert f["result"] == "UNKNOWN" and "no conversion" in f["message"]


# --- review 5: preferred controller uses the builder's profiles -------------------------


def test_preferred_controller_checked_against_builder_profiles():
    catalog = support.synthetic_catalog()
    base = replace(
        configurator.DEFAULT_SELECTION,
        chassis="synthetic.chassis", motor="synthetic.motor", wheel="synthetic.wheel", caster="synthetic.caster",
        controller="synthetic.controller_few_pins", motor_driver="synthetic.driver", distance_sensor="synthetic.range_sensor",
        motor_power="synthetic.battery_6v", controller_power="synthetic.usb_power", accessories=(),
    )
    intent = parse_intent(support.synthetic_intent_dict())  # prefers synthetic.controller
    chosen, notes = select_parts(intent, catalog, base, profiles=[SYNTHETIC_PROFILE])
    assert chosen.controller == "synthetic.controller" and notes[0].startswith("Controller synthetic.controller")
    refused, notes = select_parts(intent, catalog, base, profiles=[])
    assert refused.controller == "synthetic.controller_few_pins" and "no catalog entry with a wiring profile" in notes[0]


def test_solve_passes_builder_profiles(monkeypatch):
    seen = {}
    real = configurator.select_parts

    def spy(intent, catalog, base=configurator.DEFAULT_SELECTION, profiles=None):
        seen["profiles"] = profiles
        return real(intent, catalog, base, profiles)

    monkeypatch.setattr(configurator, "select_parts", spy)
    profiles = load_profiles()
    configurator.solve_intent(parse_intent(support.appendix_intent_dict()), Builder(load_catalog(), profiles=profiles))
    assert seen["profiles"] is profiles


# --- review 6: repair may not silently undo a requested sensor -----------------------------


def test_sensor_swap_that_repair_would_undo_is_rejected():
    records = support.synthetic_catalog_records()
    broken = copy.deepcopy(next(r for r in records if r["catalog_id"] == "synthetic.range_sensor"))
    broken["catalog_id"] = "synthetic.range_sensor_no_bus"
    broken["ports"] = [p for p in broken["ports"] if p["signal"] not in ("i2c_sda", "i2c_scl")]
    builder = Builder(catalog_from_records(records + [broken], "t"), profiles=[SYNTHETIC_PROFILE])
    selection = replace(
        configurator.DEFAULT_SELECTION,
        chassis="synthetic.chassis", motor="synthetic.motor", wheel="synthetic.wheel", caster="synthetic.caster",
        controller="synthetic.controller", motor_driver="synthetic.driver", distance_sensor="synthetic.range_sensor",
        motor_power="synthetic.battery_6v", controller_power="synthetic.usb_power", accessories=(),
    )
    base = builder.finalize(builder.assemble(
        selection=selection, state=configurator.EngineState(), build_id="b", revision=1, source_intent_id="i",
        input_mode="text", created_at="2026-10-24T00:00:00Z", parameters=configurator.DEFAULT_PARAMETERS, render_overrides={},
    ))
    result = edit_plan(base, {"op": "replace_optional_sensor", "catalog_id": "synthetic.range_sensor_no_bus"}, builder)
    assert result["accepted"] is False
    assert result["finding"]["rule_id"] == "edit.replace_sensor"


# --- review 9: behavior bounds stay inside the firmware generator's -------------------------


def test_parameter_bounds_within_firmware_generator_bounds():
    source = REPO / "services" / "api" / "rivet_api" / "firmware" / "generate.py"
    if not source.exists():
        pytest.skip("services/api not present")
    text = source.read_text()
    for name, (lo, hi) in configurator.PARAMETER_BOUNDS.items():
        match = re.search(rf'_number\(params, "{name}", ([\d_.]+), ([\d_.]+)\)', text)
        assert match, name
        fw_lo, fw_hi = (float(v.replace("_", "")) for v in match.groups())
        assert fw_lo <= lo and hi <= fw_hi, name


# --- audit 1: physical fit evidence ------------------------------------------------------


def test_undocumented_motor_fit_is_blocking_unknown_not_pass(plan):
    fits = _findings(plan, "mechanical.fit_evidence")
    motor = [f for f in fits if "motor-left-1" in f["affected_instance_ids"] and "chassis-1" in f["affected_instance_ids"]]
    assert motor and motor[0]["result"] == "UNKNOWN" and motor[0]["severity"] == "blocking"
    assert "ROB-13302" in motor[0]["message"] and motor[0]["evidence_urls"]
    passed = {tuple(f["affected_instance_ids"]): f for f in fits if f["result"] == "PASS"}
    assert passed[("motor-left-1", "wheel-left-1")]["evidence_urls"] == ["https://www.adafruit.com/product/3766"]
    assert ("caster-1", "chassis-1") in passed and ("chassis-1", "power-motor-1") in passed


def test_unlisted_pair_is_advisory_unknown():
    fits = {k: v for k, v in load_fit_evidence().items() if "front_sensor" not in k}
    p = BuildPlan.model_validate(rivet_engine.solve(support.appendix_intent_dict()))
    report = verify_candidate(p, load_catalog(), VerificationContext(fit_evidence=fits))
    [f] = [f for f in report.findings if f.rule_id == "mechanical.fit_evidence" and "sensor-1" in f.affected_instance_ids]
    assert f.result == "UNKNOWN" and f.severity == "advisory" and f.message.startswith("No fit evidence")


def _fit(report_findings):
    return sorted((f["result"], f["severity"], tuple(f["affected_instance_ids"])) for f in report_findings if f["rule_id"] == "mechanical.fit_evidence")


def test_explicit_identical_catalog_keeps_fit_checks(plan):
    default = rivet_engine.verify(plan)
    explicit = rivet_engine.verify(plan, rivet_engine.get_catalog())
    assert _fit(explicit["findings"]) == _fit(default["findings"]) and len(_fit(default["findings"])) == 10
    assert explicit["overall"] == default["overall"]


def test_modified_record_turns_fit_evidence_into_blocking_unknown(plan):
    catalog = rivet_engine.get_catalog()
    wheel = next(c for c in catalog if c["catalog_id"] == "wheel.adafruit_tt_wheel_3766")
    wheel["physical"]["dimensions_mm"]["y"] = 80.0
    fits = [f for f in rivet_engine.verify(plan, catalog)["findings"] if f["rule_id"] == "mechanical.fit_evidence"
            and "wheel-left-1" in f["affected_instance_ids"]]
    assert fits and fits[0]["result"] == "UNKNOWN" and fits[0]["severity"] == "blocking"
    assert "differs" in fits[0]["message"]


def test_foreign_catalog_reports_unknown_fit_instead_of_skipping():
    report = rivet_engine.verify(support.appendix_plan_dict(), support.appendix_catalog_records())
    fits = [f for f in report["findings"] if f["rule_id"] == "mechanical.fit_evidence"]
    assert fits and all(f["result"] == "UNKNOWN" for f in fits)


def test_internal_builder_without_fit_data_skips_rule():
    synthetic = verify_candidate(support.synthetic_plan(), support.synthetic_catalog())
    assert not [f for f in synthetic.findings if f.rule_id == "mechanical.fit_evidence"]


def test_rule_tolerates_entries_built_in_code():
    p = BuildPlan.model_validate(rivet_engine.solve(support.appendix_intent_dict()))
    fits = {k: {"status": v["status"], "source": v.get("source"), "severity": v.get("severity")} for k, v in load_fit_evidence().items()}
    report = verify_candidate(p, load_catalog(), VerificationContext(fit_evidence=fits))
    assert [f for f in report.findings if f.rule_id == "mechanical.fit_evidence"]


@pytest.mark.parametrize(
    "fits",
    [
        {"no-separators": {"status": "documented", "source": "https://x"}},
        {"a#m|b": {"status": "documented"}},
        {"a#m|b": {"status": "assumed"}},
        {"a#m|b": {"status": "maybe"}},
        {"a#m|b": {"status": "documented", "source": "https://example.com"}},
        {"a#m|b": {"status": "assumed", "severity": "blocking"}},
        {"a#m|b": {"status": "documented", "source": "https://x", "note": 5}},
        {"a#m|b": {"status": "documented", "source": "http://x", "note": "n"}},
        {"a#m|b": {"status": "documented", "source": "https://x", "note": "n", "extra": 1}},
        {"a#m|b": ["not", "an", "object"]},
        {"a|b#m": {"status": "documented", "source": "https://x", "note": "n"}},
        {"a#m|b": {"status": "assumed", "severity": "maybe", "note": "n"}},
    ],
)
def test_malformed_fit_file_rejected(tmp_path, fits):
    path = tmp_path / "fit.json"
    path.write_text(json.dumps({"schema_version": "1.0", "fits": fits}))
    with pytest.raises(CatalogError):
        load_fit_evidence(str(path))


def test_fit_file_only_names_real_catalog_parts_and_mounts():
    catalog = load_catalog()
    for key in load_fit_evidence():
        parent_mount, child = key.split("|")
        parent, mount = parent_mount.split("#")
        assert catalog.require(parent).mount(mount), key
        assert child in catalog, key


# --- audit 2: ESP32 pin sourcing ------------------------------------------------------------


def test_esp32_restrictions_cite_a_source_that_was_read():
    board = load_catalog().require("board.esp32_devkitc_v4_wroom32e")
    assert any("ESP-IDF GPIO reference" in n and "was not read" in n for n in board.evidence.notes)
    assert "ESP-IDF" in board.port("gpio5").notes and "ESP-IDF" in board.port("gpio34").notes
    profile = load_profiles()[0]
    assert "https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html" in profile["evidence_urls"]
    assert all("ESP-IDF" in r["reason"] or "DevKitC" in r["reason"] for r in profile["reserved_gpio"])


def test_default_pin_map_avoids_psram_pins(plan):
    assert not {16, 17} & set(plan["firmware"]["pin_map"].values())
    assert profile_order_last_is_psram()


def profile_order_last_is_psram():
    order = load_profiles()[0]["output_gpio_order"]
    return order[-2:] == [16, 17]


# --- audit 3: batteries are in the BOM ---------------------------------------------------------


def test_aa_cells_are_listed_and_priced(plan):
    cells = next(i for i in plan["bom"]["items"] if i["catalog_id"] == "accessory.adafruit_aa_alkaline_4pack_3349")
    assert cells["quantity"] == 1 and cells["unit_price_amount"] == "2.95" and cells["link_status"] == "verified_product"
    assert plan["bom"]["known_subtotal_amount"] == "105.45" and plan["bom"]["total_status"] == "complete"


def test_holder_voltage_follows_the_listed_cells(plan):
    holder = load_catalog().require("power.sparkfun_shadow_4xaa_holder")
    v = holder.port("v_out")
    assert (v.voltage_min_v, v.voltage_max_v) == (3.2, 6.4) and "3349" in v.notes
    # 6.4 V fresh alkaline is above the motor's 6 V rated maximum: a blocking failure, not hidden.
    found = _findings(plan, "electrical.motor_voltage")
    assert len(found) == 2 and all(f["result"] == "FAIL" and "6.4" in f["message"] for f in found)
    # Dipping below the driver's 4.5 V VM minimum is a brown-out warning.
    [vm] = [f for f in _findings(plan, "electrical.supply_voltage") if "driver-1.vm" in f["message"]]
    assert vm["result"] == "WARN" and "brown-out" in vm["message"]


# --- audit 4: mixed currency is explicit ----------------------------------------------------


def test_mixed_currency_price_is_an_explicit_finding():
    raw = support.substitute(support.synthetic_plan_dict(), ["motor-left-1", "motor-right-1"], "synthetic.motor_eur")
    report = verify_candidate(BuildPlan.model_validate(raw), support.synthetic_catalog())
    [f] = [f for f in report.findings if f.rule_id == "budget.price_currency" and f.result != "PASS"]
    assert f.result == "UNKNOWN" and f.severity == "advisory" and "EUR" in f.message
    assert f.affected_instance_ids == ["motor-left-1", "motor-right-1"]


def test_single_currency_bom_passes_currency_rule(plan):
    [f] = _findings(plan, "budget.price_currency")
    assert f["result"] == "PASS"


# --- audit 5: loose kit items are not drawn at the chassis centre --------------------------------


def test_kit_items_hidden_but_still_in_bom(plan):
    kit = [c for c in plan["components"] if c["role"] == "accessory"]
    assert len(kit) == 6 and all(c["render_overrides"].get("visible") is False for c in kit)
    bom_ids = {i for item in plan["bom"]["items"] for i in item["instance_ids"]}
    assert {c["instance_id"] for c in kit} <= bom_ids
    assert all(c["render_overrides"].get("visible", True) for c in plan["components"] if c["role"] != "accessory")


def test_color_on_kit_item_keeps_it_hidden(plan):
    new = rivet_engine.apply_edit(plan, {"op": "change_appearance_color", "instance_id": "accessory-1", "color": "#ABCDEF"})["plan"]
    item = next(c for c in new["components"] if c["instance_id"] == "accessory-1")
    assert item["render_overrides"] == {"color": "#ABCDEF", "visible": False}


def test_kit_order_survives_ten_or_more_accessories():
    p = BuildPlan.model_validate(rivet_engine.solve(support.appendix_intent_dict()))
    extra = [c.model_copy(update={"instance_id": f"accessory-{n}"}) for n, c in enumerate([p.components[-1]] * 6, start=7)]
    p = p.model_copy(update={"components": p.components + extra})
    sel = configurator.selection_from_plan(p)
    assert sel.accessories[:6] == configurator.DEFAULT_SELECTION.accessories


# === Second review (commit c5b54e4) ==========================================================

from tests.test_constraints import non_pass, real_plan_dict, real_records, requirements, run  # noqa: E402


# --- 3: stop distance must stay inside the selected sensor's range ----------------------------


def test_stop_distance_beyond_sensor_range_rejected(plan):
    result = rivet_engine.apply_edit(plan, {"op": "set_behavior_parameter", "name": "obstacle_stop_distance_m", "value": 2})
    assert result["accepted"] is False and "1.2" in result["finding"]["message"]
    ok = rivet_engine.apply_edit(plan, {"op": "set_behavior_parameter", "name": "obstacle_stop_distance_m", "value": 1.0})
    assert ok["accepted"] is True


def test_sensor_swap_to_shorter_range_rejected_when_stop_distance_too_far(plan):
    longer = rivet_engine.apply_edit(plan, {"op": "replace_optional_sensor", "catalog_id": "sensor.adafruit_vl53l1x_3967"})["plan"]
    far = rivet_engine.apply_edit(longer, {"op": "set_behavior_parameter", "name": "obstacle_stop_distance_m", "value": 1.5})
    assert far["accepted"] is True
    back = rivet_engine.apply_edit(far["plan"], {"op": "replace_optional_sensor", "catalog_id": "sensor.adafruit_vl53l0x_3317"})
    assert back["accepted"] is False and back["finding"]["rule_id"] == "firmware.behavior_parameters"


@pytest.mark.parametrize(
    "params,needle",
    [
        ({"obstacle_stop_distance_m": 0.25, "turn_duration_ms": -5, "forward_speed_fraction": 0.45}, "turn_duration_ms"),
        ({"obstacle_stop_distance_m": 0.25, "forward_speed_fraction": 0.45}, "missing"),
        ({"obstacle_stop_distance_m": 0.25, "turn_duration_ms": 600, "forward_speed_fraction": 0.45, "boost": 1}, "Unknown"),
        ({"obstacle_stop_distance_m": 1.5, "turn_duration_ms": 600, "forward_speed_fraction": 0.45}, "sensor range"),
    ],
)
def test_invalid_behavior_parameters_fail_verification(params, needle):
    p = real_plan_dict()
    p["behavior"]["parameters"] = params
    found = non_pass(run(p), "firmware.behavior_parameters")
    assert found and all(f.result == "FAIL" and f.severity == "blocking" for f in found)
    assert any(needle in f.message for f in found)


# --- 4: malformed parameter names are rejected --------------------------------------------


@pytest.mark.parametrize("name", [[], {"a": 1}, None, 5, "max_speed"])
def test_bad_parameter_name_rejected(plan, name):
    result = rivet_engine.apply_edit(plan, {"op": "set_behavior_parameter", "name": name, "value": 0.5})
    assert result["accepted"] is False and result["finding"]["rule_id"] == "edit.behavior_parameter"


# --- remaining audit defects -------------------------------------------------------------


def test_supply_below_motor_stall_load_fails():
    records = real_records()
    battery = next(r for r in records if r["catalog_id"] == "testpart.battery_6v")
    next(p for p in battery["ports"] if p["port_id"] == "v_out")["current_limit_a"] = 0.001
    [f] = [f for f in non_pass(run(records=records), "electrical.supply_capacity") if "power-motor-1" in f.affected_instance_ids]
    assert f.result == "FAIL" and "1.6" in f.message


def test_supply_capacity_passes_only_with_documented_load():
    report = run()
    capacity = [f for f in report.findings if f.rule_id == "electrical.supply_capacity"]
    assert capacity and all(f.result == "PASS" for f in capacity)


def test_two_motors_on_one_driver_channel_fail():
    p = real_plan_dict()
    for conn in p["connections"]:
        if conn["connection_id"] == "w-bo1":
            conn["from"]["port_id"] = "ao1"
        if conn["connection_id"] == "w-bo2":
            conn["from"]["port_id"] = "ao2"
    messages = [f.message for f in non_pass(run(p), "electrical.motor_channels")]
    assert any("drives more than one motor" in m for m in messages)


def test_missing_direction_or_standby_wire_fails():
    for wire, port in (("w-ain1", "ain1"), ("w-stby", "stby")):
        p = real_plan_dict()
        p["connections"] = [c for c in p["connections"] if c["connection_id"] != wire]
        p["firmware"]["pin_map"] = {k: v for k, v in p["firmware"]["pin_map"].items() if v != {"w-ain1": 26, "w-stby": 4}[wire]}
        assert any(f"driver-1.{port}" in f.message for f in non_pass(run(p), "electrical.required_connections")), wire


def test_native_i2c_pins_get_logic_checks():
    records = real_records()
    board = next(r for r in records if r["catalog_id"] == "testpart.controller")
    sda = next(p for p in board["ports"] if p["port_id"] == "gpio21")
    sda.update(signal="i2c_sda", logic_level_v=5.0)
    found = non_pass(run(records=records), "electrical.logic_level")
    assert any("gpio21" in f.message and f.result == "FAIL" for f in found)


def test_mounted_part_without_mount_reference_fails():
    p = real_plan_dict()
    controller = next(c for c in p["components"] if c["instance_id"] == "controller-1")
    controller["attached_to_mount_id"] = controller["own_mount_id"] = None
    assert any("no mount reference" in f.message for f in non_pass(run(p), "integrity.mounts"))


def test_part_far_from_its_mount_fails():
    p = real_plan_dict()
    next(c for c in p["components"] if c["instance_id"] == "sensor-1")["pose"]["position_mm"][2] += 1000
    [f] = non_pass(run(p), "mechanical.pose_consistency")
    assert f.result == "FAIL" and "sensor-1" in f.affected_instance_ids


def test_engine_plans_are_pose_consistent(plan):
    found = _findings(plan, "mechanical.pose_consistency")
    assert found and all(f["result"] == "PASS" for f in found)


def test_size_limit_unknown_when_any_bounds_missing():
    def partial(instance, component):
        return None if instance.instance_id == "sensor-1" else box_bounds(instance, component)

    from tests.test_constraints import box_bounds

    [f] = non_pass(run(bounds=partial, requirements=requirements(max_width_mm=500)), "requirements.dimensions")
    assert f.result == "UNKNOWN" and f.severity == "blocking" and "sensor-1" in f.affected_instance_ids


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p["components"][0]["pose"].update(position_mm=[float("nan"), 0, 0]),
        lambda p: p["components"][0]["pose"].update(rotation_deg=[0, float("inf"), 0]),
        lambda p: p.update(created_at="yesterday"),
        lambda p: p.update(created_at="2026-13-45T00:00:00Z"),
        lambda p: p.update(created_at="2026-10-24T00:00:00"),
    ],
)
def test_invalid_numbers_and_dates_rejected(mutate):
    from pydantic import ValidationError

    p = support.synthetic_plan_dict()
    mutate(p)
    with pytest.raises(ValidationError):
        BuildPlan.model_validate(p)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r["physical"]["dimensions_mm"].update(x=-5),
        lambda r: r["physical"]["dimensions_mm"].update(y=0),
        lambda r: r["physical"].update(mass_g=-1),
        lambda r: r["ports"][0].update(voltage_max_v=-3),
        lambda r: r["ports"][0].update(current_limit_a=float("nan")),
    ],
)
def test_invalid_catalog_numbers_rejected(mutate):
    from pydantic import ValidationError

    from rivet_engine.models import CatalogComponent

    record = next(r for r in support.synthetic_catalog_records() if r["ports"])
    mutate(record)
    with pytest.raises(ValidationError):
        CatalogComponent.model_validate(record)


def test_empty_or_incomplete_assembly_steps_fail():
    p = real_plan_dict()
    p["assembly_steps"] = []
    assert any("no assembly steps" in f.message for f in non_pass(run(p), "integrity.assembly_steps"))
    p = real_plan_dict()
    p["assembly_steps"] = p["assembly_steps"][:1]
    assert any("never appear" in f.message for f in non_pass(run(p), "integrity.assembly_steps"))


def test_loaded_catalog_cannot_be_corrupted_by_callers():
    first = load_catalog()
    first.require("driver.adafruit_tb6612_2448").ports[0].current_limit_a = 99
    first.require("driver.adafruit_tb6612_2448").mounts.clear()
    fresh = load_catalog().require("driver.adafruit_tb6612_2448")
    assert fresh.ports[0].current_limit_a != 99 and fresh.mounts
    rivet_engine.get_catalog()[0]["catalog_id"] = "tampered"
    assert rivet_engine.get_catalog()[0]["catalog_id"] != "tampered"
