"""Standalone demo CLI (B7): the plans it writes, and that bad input never tracebacks."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

import rivet_engine
from rivet_engine import demo
from rivet_engine.models import BuildPlan
from tests import support

PACKAGE_DIR = Path(__file__).resolve().parents[1]


def _run(tmp_path, *args):
    out = tmp_path / "plan.json"
    code = demo.main([*args, "--output", str(out)])
    return code, (json.loads(out.read_text()) if out.exists() else None)


def _intent_file(tmp_path, intent):
    path = tmp_path / "intent.json"
    path.write_text(json.dumps(intent))
    return str(path)


@pytest.fixture(scope="module")
def sample_plan(tmp_path_factory):
    code, plan = _run(tmp_path_factory.mktemp("demo"), "--sample")
    assert code == 0
    return plan


# --- plans written by the CLI ---------------------------------------------------------


def test_sample_plan_is_schema_valid_and_complete(sample_plan):
    model = BuildPlan.model_validate(sample_plan)
    assert model.schema_version == "1.0" and model.revision == 1
    roles = {c.role for c in model.components}
    assert {"chassis", "motor", "wheel", "caster", "controller", "motor_driver", "distance_sensor"} <= roles
    assert model.connections and model.assembly_steps and model.bom.items


def test_sample_plan_references_agree(sample_plan):
    catalog = rivet_engine.load_catalog()
    by_id = {c["instance_id"]: c for c in sample_plan["components"]}
    assert len(by_id) == len(sample_plan["components"])
    for c in sample_plan["components"]:
        if c["own_mount_id"] is not None:  # loose accessories have no modeled mount
            parent = catalog.require(by_id[c["parent_instance_id"]]["catalog_id"])
            assert parent.mount(c["attached_to_mount_id"])
            assert catalog.require(c["catalog_id"]).mount(c["own_mount_id"])
    for conn in sample_plan["connections"]:
        for end in (conn["from"], conn["to"]):
            assert catalog.require(by_id[end["instance_id"]]["catalog_id"]).port(end["port_id"])
    assert all(set(s["instance_ids"]) <= set(by_id) for s in sample_plan["assembly_steps"])
    assert sorted(i for item in sample_plan["bom"]["items"] for i in item["instance_ids"]) == sorted(by_id)


def test_default_plan_reports_its_blocking_unknowns(sample_plan):
    # The default rover has no FAIL left; the undocumented motor fit keeps it in needs_review.
    assert sample_plan["status"] == sample_plan["verification"]["overall"] == "needs_review"
    findings = sample_plan["verification"]["findings"]
    current = [f for f in findings if f["rule_id"] == "electrical.motor_driver_current"]
    assert current and all(f["result"] == "PASS" and "driver-1" in f["affected_instance_ids"] and f["evidence_urls"] for f in current)
    blocking = [f for f in findings if f["severity"] == "blocking" and f["result"] != "PASS"]
    assert blocking and all(f["rule_id"] == "mechanical.fit_evidence" and f["result"] == "UNKNOWN" for f in blocking)


def test_simulation_is_metric_and_labeled_and_compile_unclaimed(sample_plan):
    catalog = rivet_engine.load_catalog()
    by_id = {c["instance_id"]: c for c in sample_plan["components"]}
    wheel = catalog.require(by_id["wheel-left-1"]["catalog_id"]).physical.dimensions_mm
    sim = sample_plan["simulation"]
    assert sim["wheel_radius_m"] == pytest.approx(max(wheel.y, wheel.z) / 2000, abs=1e-4)
    assert 0 < sim["wheel_base_m"] < 1  # meters, not millimeters
    assert any("nominal" in line for line in sim["limitations"])
    assert sample_plan["firmware"]["compile_status"] in {"not_checked", "not_supported"}


def test_two_runs_are_identical_ignoring_timestamp(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir(), b.mkdir()
    (_, first), (_, second) = _run(a, "--sample"), _run(b, "--sample")
    first.pop("created_at"), second.pop("created_at")
    assert first == second


def test_budget_failure_is_a_plan(tmp_path, capsys):
    code, plan = _run(tmp_path, "--sample", "--max-budget", "60")
    assert code == 0 and plan["status"] == "unbuildable"
    assert "budget.max_budget" in capsys.readouterr().err


def test_intent_file_matches_sample(tmp_path, sample_plan):
    code, plan = _run(tmp_path, "--intent", _intent_file(tmp_path, demo.SAMPLE_INTENT))
    assert code == 0
    plan.pop("created_at")
    assert plan == {k: v for k, v in sample_plan.items() if k != "created_at"}


def test_runs_as_module(tmp_path):
    out = tmp_path / "plan.json"
    proc = subprocess.run(
        [sys.executable, "-m", "rivet_engine.demo", "--sample", "--output", str(out)],
        cwd=PACKAGE_DIR, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert json.loads(out.read_text())["schema_version"] == "1.0"


# --- structured failures, no tracebacks -------------------------------------------------


def test_missing_intent_file(tmp_path, capsys):
    assert _run(tmp_path, "--intent", str(tmp_path / "missing.json")) == (2, None)
    assert "not found" in capsys.readouterr().err


@pytest.mark.parametrize("text", ["{bad", "[1]", '"rover"', "{}"])
def test_malformed_intent_exits_2(tmp_path, capsys, text):
    path = tmp_path / "intent.json"
    path.write_text(text)
    assert _run(tmp_path, "--intent", str(path), "--max-budget", "5") == (2, None)
    assert "Traceback" not in capsys.readouterr().err


def test_unreadable_intent_path_exits_2(tmp_path, capsys):
    assert _run(tmp_path, "--intent", str(tmp_path)) == (2, None)  # a directory
    assert "cannot read" in capsys.readouterr().err


@pytest.mark.parametrize("budget", ["abc", "-5"])
def test_invalid_budget_override_exits_2_with_envelope(tmp_path, capsys, budget):
    assert _run(tmp_path, "--sample", "--max-budget", budget) == (2, None)
    assert json.loads(capsys.readouterr().err)["error"]["code"] == "INVALID_INPUT"


@pytest.mark.parametrize("change", [{"project_family": "drone"}, {"requested_behavior": "line_following"}])
def test_unsupported_request_exits_3_with_envelope(tmp_path, capsys, change):
    intent = support.appendix_intent_dict() | change
    assert _run(tmp_path, "--intent", _intent_file(tmp_path, intent)) == (3, None)
    assert json.loads(capsys.readouterr().err)["error"]["code"] == "UNSUPPORTED_REQUEST"


def test_unwritable_output_exits_2(tmp_path, capsys):
    code = demo.main(["--sample", "--output", str(tmp_path / "no-such-dir" / "plan.json")])
    assert code == 2
    assert "cannot write" in capsys.readouterr().err


# --- shared repo inputs, once they land ---------------------------------------------------


def test_shared_intent_fixture_when_present(tmp_path):
    path = support.shared_fixture("intent/rover_obstacle_v1.json")
    if path is None:
        pytest.skip("shared fixtures/ not landed; --sample covers the same intent")
    code, plan = _run(tmp_path, "--intent", str(path))
    assert code == 0
    BuildPlan.model_validate(plan)


def test_plan_matches_shared_schema_when_present(sample_plan):
    schema_path = support.REPO_ROOT / "contracts" / "build-plan.schema.json"
    if not schema_path.exists():
        pytest.skip("shared contracts/ schemas not landed; plan is validated by the Pydantic models")
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(sample_plan, json.loads(schema_path.read_text()))
