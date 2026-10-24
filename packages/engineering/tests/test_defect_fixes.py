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


def test_fit_rule_skipped_for_caller_catalogs_and_synthetic_data(plan):
    report = rivet_engine.verify(plan, rivet_engine.get_catalog())
    assert not [f for f in report["findings"] if f["rule_id"] == "mechanical.fit_evidence"]
    synthetic = verify_candidate(support.synthetic_plan(), support.synthetic_catalog())
    assert not [f for f in synthetic.findings if f.rule_id == "mechanical.fit_evidence"]


@pytest.mark.parametrize(
    "fits",
    [
        {"no-separators": {"status": "documented", "source": "https://x"}},
        {"a#m|b": {"status": "documented"}},
        {"a#m|b": {"status": "assumed"}},
        {"a#m|b": {"status": "maybe"}},
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
    # 6.4 V fresh alkaline is above the motor's 6 V rating: reported, not hidden.
    assert all(f["result"] == "WARN" for f in _findings(plan, "electrical.motor_voltage"))


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
