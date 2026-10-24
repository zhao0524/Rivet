import json
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
    assert [c[0] for c in calls] == ["get_catalog", "solve", "apply_edit", "verify", "get_catalog"]  # first is the startup probe


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


# ---- error mapping and startup probe -------------------------------------------------------


class EngineError(Exception):
    """Mirrors rivet_engine.ports.EngineError (code, http_status, retryable, to_envelope)."""

    code = "ENGINE_ERROR"
    http_status = 500

    def __init__(self, message, details=None, *, retryable=False):
        super().__init__(message)
        self.message, self.details, self.retryable = message, dict(details or {}), retryable

    def to_envelope(self):
        return {"error": {"code": self.code, "message": self.message, "details": self.details, "retryable": self.retryable}}


class EngineNotImplementedError(EngineError):
    code, http_status = "ENGINE_NOT_IMPLEMENTED", 503


class InvalidInputError(EngineError):
    code, http_status = "INVALID_INPUT", 400


class UnsupportedRequestError(EngineError):
    code, http_status = "UNSUPPORTED_REQUEST", 422


def fake_engine(monkeypatch, **overrides):
    fake = types.ModuleType("rivet_engine")
    fake.solve = lambda intent: {}
    fake.apply_edit = lambda plan, op: {}
    fake.verify = lambda plan, catalog=None: {}
    fake.get_catalog = lambda: [{"catalog_id": "x"}]
    for name, fn in overrides.items():
        setattr(fake, name, fn)
    monkeypatch.setitem(sys.modules, "rivet_engine", fake)
    return fake


def raiser(exc):
    def _raise(*a, **k):
        raise exc

    return _raise


def test_stub_engine_that_raises_not_implemented_counts_as_unavailable(monkeypatch):
    fake_engine(monkeypatch, get_catalog=raiser(EngineNotImplementedError("not yet")))
    with pytest.raises(ApiError) as exc:
        RealEngineeringAdapter()
    assert exc.value.code == "ENGINE_UNAVAILABLE" and exc.value.status == 503


def test_live_with_a_stub_engine_falls_back_labeled(monkeypatch, intent_dict):
    fake_engine(monkeypatch, get_catalog=raiser(EngineNotImplementedError("not yet")))
    port = build_engineering_port(Settings(mode="live", allow_fallback=True))
    assert port.solve(intent_dict)["provenance"]["generation_mode"] == "fallback"
    with pytest.raises(ApiError):
        build_engineering_port(Settings(mode="live", allow_fallback=False))


def test_engine_not_implemented_during_a_call_is_503(monkeypatch):
    fake_engine(monkeypatch)
    adapter = RealEngineeringAdapter()
    adapter._solve = raiser(EngineNotImplementedError("solve() is not implemented yet"))
    with pytest.raises(ApiError) as exc:
        adapter.solve({})
    assert exc.value.status == 503 and exc.value.code == "ENGINE_NOT_IMPLEMENTED"
    assert exc.value.message == "solve() is not implemented yet"


@pytest.mark.parametrize(
    "error,status,code,retryable,details",
    [
        (InvalidInputError("intent is malformed", {"field": "requirements"}), 400, "INVALID_INPUT", False, {"field": "requirements"}),
        (UnsupportedRequestError("drones are not supported", {"family": "drone"}), 422, "UNSUPPORTED_REQUEST", False, {"family": "drone"}),
        (EngineError("transient", retryable=True), 500, "ENGINE_ERROR", True, {}),
    ],
)
def test_engine_errors_are_passed_through_with_their_own_envelope(monkeypatch, error, status, code, retryable, details):
    fake_engine(monkeypatch)
    adapter = RealEngineeringAdapter()
    adapter._solve = raiser(error)
    with pytest.raises(ApiError) as exc:
        adapter.solve({})
    err = exc.value
    assert (err.status, err.code, err.retryable, err.details) == (status, code, retryable, details)
    assert err.message == error.message


def test_a_malformed_engine_envelope_falls_back_to_a_generic_error(monkeypatch):
    fake_engine(monkeypatch)
    adapter = RealEngineeringAdapter()

    class Broken(EngineError):
        def to_envelope(self):
            return {"unexpected": True}

    adapter._solve = raiser(Broken("x"))
    with pytest.raises(ApiError) as exc:
        adapter.solve({})
    assert exc.value.code == "ENGINE_ERROR" and exc.value.status == 502


def test_engine_error_reaches_the_client_with_the_engines_status_and_code(monkeypatch, make_client):
    fake_engine(monkeypatch)
    adapter = RealEngineeringAdapter()
    adapter._solve = raiser(UnsupportedRequestError("only rovers", {"family": "drone"}))
    client, _ = make_client(engine=adapter)
    resp = client.post("/api/projects/generate", json={"input": {"kind": "text", "user_text": "rover"}})
    job_id = resp.json()["job_id"]
    import time

    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("complete", "failed"):
            break
        time.sleep(0.02)
    assert job["status"] == "failed"
    assert job["error"]["code"] == "UNSUPPORTED_REQUEST" and job["error"]["details"] == {"family": "drone"}


def test_non_engine_exceptions_stay_generic_and_do_not_leak(monkeypatch):
    fake_engine(monkeypatch)
    adapter = RealEngineeringAdapter()
    adapter._apply_edit = raiser(KeyError("/home/dev/secret/path"))
    with pytest.raises(ApiError) as exc:
        adapter.apply_edit({}, {})
    assert exc.value.code == "ENGINE_ERROR"
    assert "secret" not in json.dumps(exc.value.envelope())


def test_api_errors_from_the_engine_pass_through(monkeypatch):
    fake_engine(monkeypatch)
    adapter = RealEngineeringAdapter()
    adapter._verify = raiser(ApiError("CUSTOM", "x", 418))
    with pytest.raises(ApiError) as exc:
        adapter.verify({})
    assert exc.value.status == 418
