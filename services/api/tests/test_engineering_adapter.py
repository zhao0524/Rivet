import sys
import types

import pytest

from rivet_api.adapters.engineering import (
    RealEngineeringAdapter,
    build_engineering_port,
)
from rivet_api.adapters.fixture import FixtureEngineeringAdapter
from rivet_api.config import Settings
from rivet_api.contract import assert_build_plan_contract
from rivet_api.errors import ApiError
from rivet_api.models.plan import BuildPlan


def test_fixture_solve_returns_contract_valid_plan_labeled_fixture(intent_dict, catalog):
    adapter = FixtureEngineeringAdapter()
    plan = adapter.solve(intent_dict)
    assert plan["provenance"]["generation_mode"] == "fixture"
    assert plan["source_intent_id"] == intent_dict["intent_id"]
    assert_build_plan_contract(BuildPlan.model_validate(plan), adapter.get_catalog())


def test_fixture_solve_is_deep_copy(intent_dict):
    adapter = FixtureEngineeringAdapter()
    first = adapter.solve(intent_dict)
    first["components"].clear()
    first["status"] = "verified"
    second = adapter.solve(intent_dict)
    assert len(second["components"]) > 0
    assert second["status"] == "needs_review"


def test_fixture_get_catalog_has_demo_components():
    ids = {c["catalog_id"] for c in FixtureEngineeringAdapter().get_catalog()}
    assert "demo.chassis_2wd" in ids


def test_fixture_edit_behavior_parameter_accepted_and_does_not_touch_verification(intent_dict):
    adapter = FixtureEngineeringAdapter()
    plan = adapter.solve(intent_dict)
    out = adapter.apply_edit(
        plan,
        {"op": "set_behavior_parameter", "name": "obstacle_stop_distance_m", "value": 0.4},
    )
    assert out["accepted"] is True
    assert out["plan"]["behavior"]["parameters"]["obstacle_stop_distance_m"] == 0.4
    assert out["plan"]["verification"] == plan["verification"]
    assert out["plan"]["status"] == plan["status"]
    assert plan["behavior"]["parameters"]["obstacle_stop_distance_m"] == 0.25  # input untouched


def test_fixture_edit_color_accepted(intent_dict):
    adapter = FixtureEngineeringAdapter()
    plan = adapter.solve(intent_dict)
    out = adapter.apply_edit(
        plan, {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "#112233"}
    )
    assert out["accepted"] is True
    chassis = next(c for c in out["plan"]["components"] if c["instance_id"] == "chassis-1")
    assert chassis["render_overrides"]["color"] == "#112233"


@pytest.mark.parametrize(
    "op",
    [
        {"op": "replace_optional_sensor", "catalog_id": "demo.range"},
        {"op": "set_budget", "amount": "50"},
        {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 10, 0]},
        {"op": "set_behavior_parameter", "name": "forward_speed_fraction", "value": 5},
        {"op": "set_behavior_parameter", "name": "unknown_param", "value": 1},
        {"op": "change_appearance_color", "instance_id": "ghost-9", "color": "#112233"},
        {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "red; rm -rf"},
        {"op": "delete_everything"},
    ],
)
def test_fixture_edit_unsupported_or_invalid_op_rejected_with_finding(intent_dict, op):
    adapter = FixtureEngineeringAdapter()
    plan = adapter.solve(intent_dict)
    out = adapter.apply_edit(plan, op)
    assert out["accepted"] is False
    assert "plan" not in out
    assert out["finding"]["message"]


def test_real_adapter_missing_package_raises_engine_unavailable(monkeypatch):
    monkeypatch.setitem(sys.modules, "rivet_engine", None)  # makes import fail
    with pytest.raises(ApiError) as exc:
        RealEngineeringAdapter()
    assert exc.value.code == "ENGINE_UNAVAILABLE"
    assert exc.value.status == 503


def test_real_adapter_delegates_to_public_entry_points(monkeypatch):
    fake = types.ModuleType("rivet_engine")
    calls = []
    fake.solve = lambda intent: calls.append(("solve", intent)) or {"p": 1}
    fake.apply_edit = lambda plan, op: calls.append(("apply_edit", plan, op)) or {"accepted": True}
    fake.verify = lambda plan: calls.append(("verify", plan)) or {"overall": "needs_review"}
    fake.get_catalog = lambda: calls.append(("get_catalog",)) or [{"catalog_id": "x"}]
    monkeypatch.setitem(sys.modules, "rivet_engine", fake)
    adapter = RealEngineeringAdapter()
    assert adapter.solve({"i": 1}) == {"p": 1}
    assert adapter.apply_edit({"p": 1}, {"op": "x"}) == {"accepted": True}
    assert adapter.verify({"p": 1}) == {"overall": "needs_review"}
    assert adapter.get_catalog() == [{"catalog_id": "x"}]
    assert [c[0] for c in calls] == ["solve", "apply_edit", "verify", "get_catalog"]


def test_build_port_fixture_mode_returns_fixture_adapter():
    port = build_engineering_port(Settings(mode="fixture"))
    assert isinstance(port, FixtureEngineeringAdapter)


def test_live_without_engine_falls_back_labeled_fallback(monkeypatch, intent_dict):
    monkeypatch.setitem(sys.modules, "rivet_engine", None)
    port = build_engineering_port(Settings(mode="live", allow_fallback=True))
    plan = port.solve(intent_dict)
    assert plan["provenance"]["generation_mode"] == "fallback"


def test_live_without_engine_and_no_fallback_raises(monkeypatch):
    monkeypatch.setitem(sys.modules, "rivet_engine", None)
    with pytest.raises(ApiError) as exc:
        build_engineering_port(Settings(mode="live", allow_fallback=False))
    assert exc.value.code == "ENGINE_UNAVAILABLE"


def test_live_with_engine_marks_nothing_as_fixture(monkeypatch):
    fake = types.ModuleType("rivet_engine")
    fake.solve = fake.apply_edit = fake.verify = lambda *a, **k: {}
    fake.get_catalog = lambda: []
    monkeypatch.setitem(sys.modules, "rivet_engine", fake)
    assert isinstance(build_engineering_port(Settings(mode="live")), RealEngineeringAdapter)
