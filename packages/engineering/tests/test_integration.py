import copy
import json
import socket
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pytest

import rivet_engine
from rivet_engine import demo
from rivet_engine.catalog import catalog_from_records
from rivet_engine.configurator import Builder, parse_intent, solve_intent
from rivet_engine.models import BuildPlan
from rivet_engine.ports import EngineError, InvalidInputError, UnsupportedRequestError
from tests import support
from tests.test_wiring import SYNTHETIC_PROFILE

PACKAGE_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def plan():
    return rivet_engine.solve(support.appendix_intent_dict())


def _without_time(p):
    out = copy.deepcopy(p)
    out.pop("created_at")
    return out


# --- complete, consistent plan ------------------------------------------------------


def test_solve_returns_a_sourced_complete_rover(plan):
    model = BuildPlan.model_validate(plan)
    roles = Counter(c.role for c in model.components)
    assert roles["motor"] == 2 and roles["wheel"] == 2
    for role in ("chassis", "caster", "controller", "motor_driver", "distance_sensor", "motor_power", "controller_power"):
        assert roles[role] == 1, role
    assert not any(c.catalog_id.startswith(("demo.", "synthetic.")) for c in model.components)
    assert len(model.assembly_steps) >= 6
    assert model.provenance.generation_mode == "live"
    assert model.provenance.catalog_version == rivet_engine.load_catalog().version


def test_status_is_honest_for_the_sourced_rover(plan):
    assert plan["status"] == plan["verification"]["overall"] == "verified_with_warnings"
    results = {(f["rule_id"], f["result"]) for f in plan["verification"]["findings"]}
    assert ("electrical.motor_driver_current", "WARN") in results  # 1.5 A stall vs 1.2 A continuous
    assert ("completeness.availability", "WARN") in results  # ESP32 board out of stock when checked
    assert not any(f["result"] == "FAIL" and f["severity"] == "blocking" for f in plan["verification"]["findings"])


def test_every_reference_resolves(plan):
    catalog = rivet_engine.load_catalog()
    ids = {c["instance_id"] for c in plan["components"]}
    by_id = {c["instance_id"]: c for c in plan["components"]}
    assert len(ids) == len(plan["components"])
    for c in plan["components"]:
        comp = catalog.require(c["catalog_id"])
        if c["own_mount_id"]:
            assert comp.mount(c["own_mount_id"])
            assert catalog.require(by_id[c["parent_instance_id"]]["catalog_id"]).mount(c["attached_to_mount_id"])
    for conn in plan["connections"]:
        for end in (conn["from"], conn["to"]):
            assert catalog.require(by_id[end["instance_id"]]["catalog_id"]).port(end["port_id"])
    for step in plan["assembly_steps"]:
        assert set(step["instance_ids"]) <= ids
    bom_ids = [i for item in plan["bom"]["items"] for i in item["instance_ids"]]
    assert sorted(bom_ids) == sorted(ids)
    for item in plan["bom"]["items"]:
        assert item["quantity"] == len(item["instance_ids"])


def test_netlist_covers_every_electrical_part(plan):
    catalog = rivet_engine.load_catalog()
    wired = {e["instance_id"] for c in plan["connections"] for e in (c["from"], c["to"])}
    for c in plan["components"]:
        if c["role"] != "accessory" and catalog.require(c["catalog_id"]).ports:
            assert c["instance_id"] in wired, c["instance_id"]


def test_bom_total_is_exact_and_sourced(plan):
    catalog = rivet_engine.load_catalog()
    from decimal import Decimal

    total = sum(Decimal(i["unit_price_amount"]) * i["quantity"] for i in plan["bom"]["items"])
    assert plan["bom"]["total_status"] == "complete"
    assert Decimal(plan["bom"]["known_subtotal_amount"]) == total
    for item in plan["bom"]["items"]:
        assert item["unit_price_amount"] == catalog.require(item["catalog_id"]).sourcing.price_amount


def test_firmware_pin_map_and_simulation(plan):
    fw, sim = plan["firmware"], plan["simulation"]
    assert set(fw["pin_map"]) == {
        "motor_left_pwm", "motor_left_in1", "motor_left_in2", "motor_right_pwm",
        "motor_right_in1", "motor_right_in2", "motor_standby", "i2c_sda", "i2c_scl",
    }
    assert fw["compile_status"] == "not_checked"  # the engine never claims compilation
    assert sim["wheel_radius_m"] == pytest.approx(0.0315)
    wheel_x = [c["pose"]["position_mm"][0] for c in plan["components"] if c["role"] == "wheel"]
    assert sim["wheel_base_m"] == pytest.approx(abs(wheel_x[0] - wheel_x[1]) / 1000)
    assert any("approximat" in l.lower() for l in sim["limitations"])
    assert plan["behavior"]["controller_catalog_id"] == "board.esp32_devkitc_v4_wroom32e"


def test_unknown_preferred_controller_is_explained(plan):
    assert any("board.esp32_devkit_v1" in n for n in plan["provenance"]["notes"])


def test_repeatable_ignoring_timestamp(plan):
    again = rivet_engine.solve(support.appendix_intent_dict())
    assert _without_time(again) == _without_time(plan)
    assert again["created_at"].endswith("Z")


def test_solve_does_not_mutate_intent_and_uses_no_network(monkeypatch):
    intent = support.appendix_intent_dict()
    before = copy.deepcopy(intent)

    def refuse(*a, **k):
        raise AssertionError("network access")

    monkeypatch.setattr(socket, "socket", refuse)
    rivet_engine.solve(intent)
    assert intent == before


# --- verify / catalog entry points -------------------------------------------------------


def test_verify_entry_point_matches_solve(plan):
    report = rivet_engine.verify(plan)
    assert report["overall"] == plan["status"]
    assert report["findings"] == plan["verification"]["findings"]
    with_catalog = rivet_engine.verify(plan, rivet_engine.get_catalog())
    assert with_catalog["overall"] == plan["status"]


def test_verify_rejects_malformed_connection_to_missing_driver(plan):
    broken = copy.deepcopy(plan)
    broken["components"] = [c for c in broken["components"] if c["instance_id"] != "driver-1"]
    report = rivet_engine.verify(broken)
    assert report["overall"] == "unbuildable"
    assert any(f["rule_id"] == "integrity.connections" and f["result"] == "FAIL" for f in report["findings"])


def test_verify_appendix_fixture_with_its_catalog():
    report = rivet_engine.verify(support.appendix_plan_dict(), support.appendix_catalog_records())
    assert report["overall"] in ("needs_review", "unbuildable")


def test_get_catalog_is_canonical():
    catalog = rivet_engine.get_catalog()
    assert catalog == rivet_engine.load_catalog().to_wire()
    assert 12 <= len(catalog) <= 25


# --- unsupported and invalid requests ---------------------------------------------------


@pytest.mark.parametrize(
    "change",
    [
        {"project_family": "drone", "support_status": "unsupported"},
        {"support_status": "planned"},
        {"requested_behavior": "line_following"},
    ],
)
def test_unsupported_intent_is_a_structured_rejection(change):
    intent = support.appendix_intent_dict()
    intent.update(change)
    with pytest.raises(UnsupportedRequestError) as err:
        rivet_engine.solve(intent)
    assert err.value.to_envelope()["error"]["code"] == "UNSUPPORTED_REQUEST"


def test_unknown_capability_rejected():
    intent = support.appendix_intent_dict()
    intent["requirements"]["required_capabilities"].append("flight")
    with pytest.raises(UnsupportedRequestError):
        rivet_engine.solve(intent)


def test_malformed_intent_is_invalid_input():
    with pytest.raises(InvalidInputError):
        rivet_engine.solve({"schema_version": "1.0"})


def test_budget_that_cannot_be_met_is_unbuildable_not_an_exception():
    intent = support.appendix_intent_dict()
    intent["requirements"]["max_budget"] = "60"
    plan = rivet_engine.solve(intent)
    assert plan["status"] == "unbuildable"
    [f] = [f for f in plan["verification"]["findings"] if f["rule_id"] == "budget.max_budget"]
    assert f["result"] == "FAIL" and "102.50" in f["message"]


def test_sufficient_budget_passes():
    intent = support.appendix_intent_dict()
    intent["requirements"]["max_budget"] = "150.00"
    plan = rivet_engine.solve(intent)
    [f] = [f for f in plan["verification"]["findings"] if f["rule_id"] == "budget.max_budget"]
    assert f["result"] == "PASS"


# --- repair on engine-built plans (SYNTHETIC catalog) -----------------------------------


def _synthetic_builder():
    return Builder(support.synthetic_catalog(), profiles=[SYNTHETIC_PROFILE], generation_mode="manual_template")


def test_engine_repairs_an_over_current_motor_choice():
    from dataclasses import replace

    from rivet_engine import configurator

    builder = _synthetic_builder()
    selection = replace(
        configurator.DEFAULT_SELECTION,
        chassis="synthetic.chassis", motor="synthetic.motor_high_stall", wheel="synthetic.wheel", caster="synthetic.caster",
        controller="synthetic.controller", motor_driver="synthetic.driver", distance_sensor="synthetic.range_sensor",
        motor_power="synthetic.battery_6v", controller_power="synthetic.usb_power", accessories=("synthetic.wire_kit",),
    )
    intent = parse_intent(support.synthetic_intent_dict())
    plan = builder.assemble(
        selection=selection, state=configurator.EngineState(), build_id="synthetic-repair", revision=1,
        source_intent_id=intent.intent_id, input_mode="text", created_at="2026-10-24T00:00:00Z",
        parameters=configurator.DEFAULT_PARAMETERS, render_overrides={},
    )
    before = builder.verify(plan)
    assert any(f.rule_id == "electrical.motor_driver_current" and f.result == "FAIL" for f in before.findings)
    repaired = builder.finalize(plan)
    # First legal fix in stable order: the higher-rated driver (the 5 V-logic driver is tried and rejected).
    assert next(c.catalog_id for c in repaired.components if c.role == "motor_driver") == "synthetic.driver_high_current"
    assert any("driver_5v_logic: rejected" in n for n in repaired.provenance.notes)
    assert not any(f.result == "FAIL" and f.severity == "blocking" for f in repaired.verification.findings)
    assert any(n.startswith("Repair round 1") and "accepted" in n for n in repaired.provenance.notes)
    # Synthetic parts still keep the plan from being "verified".
    assert repaired.status == "needs_review"


def test_engine_rejects_honestly_when_no_repair_exists():
    from dataclasses import replace

    from rivet_engine import configurator

    # Only the 4-GPIO controller exists, so no substitution can supply the missing pins.
    records = [r for r in support.synthetic_catalog_records() if r["catalog_id"] != "synthetic.controller"]
    profile = {**SYNTHETIC_PROFILE, "controller_catalog_id": "synthetic.controller_few_pins", "output_gpio_order": [4, 5, 13, 14],
               "i2c": {"sda_gpio": 13, "scl_gpio": 14}}
    builder = Builder(catalog_from_records(records, "t"), profiles=[profile])
    selection = replace(
        configurator.DEFAULT_SELECTION,
        chassis="synthetic.chassis", motor="synthetic.motor", wheel="synthetic.wheel", caster="synthetic.caster",
        controller="synthetic.controller_few_pins", motor_driver="synthetic.driver", distance_sensor="synthetic.range_sensor",
        motor_power="synthetic.battery_6v", controller_power="synthetic.usb_power", accessories=(),
    )
    plan = builder.assemble(
        selection=selection, state=configurator.EngineState(), build_id="synthetic-reject", revision=1,
        source_intent_id="intent-x", input_mode="text", created_at="2026-10-24T00:00:00Z",
        parameters=configurator.DEFAULT_PARAMETERS, render_overrides={},
    )
    final = builder.finalize(plan)
    assert final.status == "unbuildable"
    assert any(f.rule_id == "wiring.gpio_available" and f.result == "FAIL" for f in final.verification.findings)
    assert final.firmware.compile_status == "not_supported"
    assert "motor_standby" not in final.firmware.pin_map


# --- demo CLI ---------------------------------------------------------------------


def test_demo_valid_and_failing_runs(tmp_path, capsys):
    out = tmp_path / "plan.json"
    assert demo.main(["--sample", "--output", str(out)]) == 0
    assert json.loads(out.read_text())["status"] == "verified_with_warnings"
    fail = tmp_path / "fail.json"
    assert demo.main(["--sample", "--max-budget", "60", "--output", str(fail)]) == 0
    assert json.loads(fail.read_text())["status"] == "unbuildable"
    assert "budget.max_budget" in capsys.readouterr().err


def test_demo_with_intent_file_and_missing_file(tmp_path, capsys):
    path = tmp_path / "intent.json"
    path.write_text(json.dumps(support.appendix_intent_dict()))
    assert demo.main(["--intent", str(path), "--output", str(tmp_path / "p.json")]) == 0
    assert demo.main(["--intent", str(tmp_path / "missing.json"), "--output", str(tmp_path / "x.json")]) == 2
    assert "not found" in capsys.readouterr().err


def test_demo_unsupported_exit_code(tmp_path):
    path = tmp_path / "intent.json"
    intent = support.appendix_intent_dict()
    intent.update(project_family="drone", support_status="unsupported")
    path.write_text(json.dumps(intent))
    assert demo.main(["--intent", str(path), "--output", str(tmp_path / "p.json")]) == 3


def test_demo_runs_as_module(tmp_path):
    out = tmp_path / "plan.json"
    proc = subprocess.run(
        [sys.executable, "-m", "rivet_engine.demo", "--sample", "--output", str(out)],
        cwd=PACKAGE_DIR, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert json.loads(out.read_text())["schema_version"] == "1.0"


def test_shared_intent_fixture_when_present(tmp_path):
    path = support.shared_fixture("intent/rover_obstacle_v1.json")
    if path is None:
        pytest.skip("shared fixtures/ not landed; --sample covers the same intent")
    assert demo.main(["--intent", str(path), "--output", str(tmp_path / "p.json")]) == 0


def test_engine_errors_carry_envelopes():
    try:
        rivet_engine.solve({"nope": True})
    except EngineError as err:
        assert set(err.to_envelope()["error"]) == {"code", "message", "details", "retryable"}
