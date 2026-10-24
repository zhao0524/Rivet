import threading

import pytest

from rivet_api.errors import ApiError

BEHAVIOR_EDIT = {
    "base_revision": 1,
    "instruction": "Stop a bit earlier",
    "operation": {"op": "set_behavior_parameter", "name": "obstacle_stop_distance_m", "value": 0.4},
}


@pytest.fixture
def project(generate):
    def _make(**kwargs):
        client, app, job = generate(**kwargs)
        assert job["status"] == "complete"
        return client, app, job["build_id"]

    return _make


def test_accepted_edit_increments_revision(project):
    client, _, build_id = project()
    resp = client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT)
    assert resp.status_code == 200
    assert resp.json() == {"accepted": True, "build_id": build_id, "revision": 2}
    latest = client.get(f"/api/projects/{build_id}").json()
    assert latest["revision"] == 2
    assert latest["behavior"]["parameters"]["obstacle_stop_distance_m"] == 0.4
    old = client.get(f"/api/projects/{build_id}?revision=1").json()
    assert old["behavior"]["parameters"]["obstacle_stop_distance_m"] == 0.25


def test_rejected_edit_preserves_previous_snapshot_and_returns_finding(project):
    client, _, build_id = project()
    before = client.get(f"/api/projects/{build_id}").json()
    edit = {
        "base_revision": 1,
        "operation": {"op": "replace_optional_sensor", "catalog_id": "demo.range"},
    }
    resp = client.post(f"/api/projects/{build_id}/edits", json=edit)
    assert resp.status_code == 200
    body = resp.json()
    assert body["accepted"] is False and body["build_id"] == build_id
    assert body["finding"]["message"] and "revision" not in body
    assert client.get(f"/api/projects/{build_id}").json() == before
    assert len(client.get(f"/api/projects/{build_id}/revisions").json()["revisions"]) == 1


def test_stale_base_revision_409_without_engine_call(project, stub_engine_cls):
    engine = stub_engine_cls()
    client, _, build_id = project(engine=engine)
    assert client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT).status_code == 200
    calls_before = len(engine.edit_calls)
    resp = client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT)  # base 1 again
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "STALE_REVISION"
    assert len(engine.edit_calls) == calls_before


def test_concurrent_edits_same_base_one_wins(project):
    client, _, build_id = project()
    statuses = []

    def go():
        statuses.append(client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT).status_code)

    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert statuses.count(200) == 1 and statuses.count(409) == 5
    assert len(client.get(f"/api/projects/{build_id}/revisions").json()["revisions"]) == 2


@pytest.mark.parametrize(
    "edit",
    [
        {"base_revision": 1, "instruction": "make it look cooler"},  # free text, no operation
        {"base_revision": 1, "operation": {"op": "delete_everything"}},
        {"base_revision": 1, "operation": {"op": "set_behavior_parameter", "name": "x", "value": "fast"}},
        {"base_revision": 1, "operation": {"op": "change_appearance_color", "instance_id": "chassis-1"}},
        {"base_revision": 1, "operation": {"op": "set_behavior_parameter", "name": "a", "value": 1, "status": "verified"}},
    ],
)
def test_unsupported_or_malformed_operations_are_422_and_never_reach_engine(project, stub_engine_cls, edit):
    engine = stub_engine_cls()
    client, _, build_id = project(engine=engine)
    resp = client.post(f"/api/projects/{build_id}/edits", json=edit)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "UNSUPPORTED_EDIT"
    assert engine.edit_calls == []


def test_edit_log_records_input_and_findings(project):
    client, app, build_id = project()
    client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT)
    client.post(
        f"/api/projects/{build_id}/edits",
        json={"base_revision": 2, "operation": {"op": "replace_optional_sensor", "catalog_id": "demo.range"}},
    )
    log = app.state.deps.store.read_edit_log(build_id)
    assert [e["accepted"] for e in log] == [True, False]
    assert log[0]["operation"]["name"] == "obstacle_stop_distance_m" and log[0]["revision"] == 2
    assert log[1]["finding"]["message"] and log[1]["base_revision"] == 2


def test_engine_returning_invalid_plan_is_502_and_no_revision_is_created(project, stub_engine_cls):
    def broken(plan, op):
        bad = dict(plan)
        bad["components"] = [c for c in plan["components"] if c["instance_id"] != "driver-1"]
        return {"accepted": True, "plan": bad}

    client, app, build_id = project(engine=stub_engine_cls(edit_result=broken))
    resp = client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT)
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "ENGINE_CONTRACT_VIOLATION"
    assert len(client.get(f"/api/projects/{build_id}/revisions").json()["revisions"]) == 1
    assert app.state.deps.store.read_edit_log(build_id)[-1]["accepted"] is False


def test_engine_accept_without_plan_is_502(project, stub_engine_cls):
    client, _, build_id = project(engine=stub_engine_cls(edit_result={"accepted": True}))
    assert client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT).status_code == 502


def test_edit_unknown_project_404_and_bad_id_400(make_client):
    client, _ = make_client()
    assert client.post("/api/projects/nope-nope-nope/edits", json=BEHAVIOR_EDIT).status_code == 404
    assert client.post("/api/projects/..%2Fx/edits", json=BEHAVIOR_EDIT).status_code in (400, 404)
    assert client.post("/api/projects/BAD/edits", json=BEHAVIOR_EDIT).status_code == 400


def test_edit_missing_base_revision_is_400(project):
    client, _, build_id = project()
    resp = client.post(f"/api/projects/{build_id}/edits", json={"operation": BEHAVIOR_EDIT["operation"]})
    assert resp.status_code == 400


def test_edit_does_not_let_a_stub_edit_change_status(project, stub_engine_cls):
    """The API stores whatever the engine returns; it never edits status itself."""
    client, app, build_id = project()
    before = client.get(f"/api/projects/{build_id}").json()
    client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT)
    after = client.get(f"/api/projects/{build_id}").json()
    assert after["status"] == before["status"]
    assert after["verification"] == before["verification"]
    assert isinstance(ApiError("X", "y", 400), Exception)
