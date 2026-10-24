"""API against lane B's real rivet_engine (skipped when it is not installed).

Install with `pip install -e ../../packages/engineering`. These tests assert that the API
passes the engine's answers through untouched: status, findings and BOM come from the
engine, never from the API.
"""

import copy
import csv
import io
import json
import time
import zipfile

import pytest

pytest.importorskip("rivet_engine")

from rivet_api.adapters.engineering import RealEngineeringAdapter  # noqa: E402
from rivet_api.config import Settings  # noqa: E402
from rivet_api.contract import assert_build_plan_contract  # noqa: E402
from rivet_api.models.plan import BuildPlan  # noqa: E402
from rivet_api.smoke import run_smoke  # noqa: E402

TEXT = {"input": {"kind": "text", "user_text": "Build a small rover that avoids obstacles"}}
VALIDATE_STATUS = {"verified": "ok", "verified_with_warnings": "warning", "needs_review": "warning", "unbuildable": "failed"}


class Spy:
    """Real engine, recording what it returned so tests can compare with what was stored."""

    def __init__(self):
        self.inner = RealEngineeringAdapter()
        self.solved: list[dict] = []
        self.edits: list[dict] = []

    def solve(self, intent):
        plan = self.inner.solve(intent)
        self.solved.append(copy.deepcopy(plan))
        return plan

    def apply_edit(self, plan, operation):
        out = self.inner.apply_edit(plan, operation)
        self.edits.append(copy.deepcopy(out))
        return out

    def verify(self, plan):
        return self.inner.verify(plan)

    def get_catalog(self):
        return self.inner.get_catalog()


class LiveLabeledVision:
    mode = "live"

    def interpret(self, request, image):
        from rivet_api.agents.vision import MockVisionProvider

        return MockVisionProvider().interpret(request, image)


@pytest.fixture
def real(make_client, tmp_path):
    spy = Spy()
    client, app = make_client(settings=Settings(mode="live", data_root=tmp_path, allow_fallback=False), engine=spy)
    return client, app, spy


def run_job(client, body=TEXT):
    job_id = client.post("/api/projects/generate", json=body).json()["job_id"]
    for _ in range(300):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("complete", "failed"):
            return job
        time.sleep(0.02)
    raise AssertionError(job)


def events(client, job_id):
    with client.stream("GET", f"/api/jobs/{job_id}/events") as resp:
        text = "".join(resp.iter_text())
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


def test_the_real_engine_is_wired_in_not_the_fixture(real):
    _, app, spy = real
    assert type(spy.inner).__name__ == "RealEngineeringAdapter"
    assert not hasattr(app.state.deps.engine, "generation_mode")


def test_stored_plan_is_exactly_what_the_engine_returned(real):
    client, _, spy = real
    job = run_job(client)
    assert job["status"] == "complete"
    stored = client.get(f"/api/projects/{job['build_id']}").json()
    engine_plan = spy.solved[0]
    for key in ("status", "verification", "bom", "components", "connections", "assembly_steps", "firmware", "behavior"):
        assert stored[key] == engine_plan[key], key
    assert_build_plan_contract(BuildPlan.model_validate(stored), spy.get_catalog())


def test_label_reflects_that_the_vision_side_is_still_offline(make_client, tmp_path):
    settings = Settings(mode="live", data_root=tmp_path, allow_fallback=False)
    client, _ = make_client(settings=settings, engine=Spy())
    job = run_job(client)
    prov = client.get(f"/api/projects/{job['build_id']}").json()["provenance"]
    assert prov["generation_mode"] == "fallback" and any("vision" in n.lower() for n in prov["notes"])


def test_live_vision_plus_real_engine_is_labeled_live(make_client, tmp_path):
    settings = Settings(mode="live", data_root=tmp_path, allow_fallback=False)
    client, _ = make_client(settings=settings, engine=Spy(), vision=LiveLabeledVision())
    job = run_job(client)
    assert client.get(f"/api/projects/{job['build_id']}").json()["provenance"]["generation_mode"] == "live"


def test_events_report_the_engines_real_results(real):
    client, _, spy = real
    job = run_job(client)
    plan = spy.solved[0]
    evs = events(client, job["job_id"])
    assembly = next(e for e in evs if e["stage"] == "assembly")
    assert f"{len(plan['components'])} components" in assembly["message"]
    assert f"{len(plan['assembly_steps'])} assembly steps" in assembly["message"]
    validate = next(e for e in evs if e["stage"] == "validate")
    assert validate["status"] == VALIDATE_STATUS[plan["verification"]["overall"]]
    results = [f["result"] for f in plan["verification"]["findings"]]
    for r in ("PASS", "WARN", "FAIL", "UNKNOWN"):
        assert f"{results.count(r)} {r}" in validate["message"]
    assert [e["event_id"] for e in evs] == list(range(1, len(evs) + 1))


def test_bom_csv_uses_the_engines_subtotal_and_prices(real):
    client, _, spy = real
    job = run_job(client)
    bom = spy.solved[0]["bom"]
    rows = list(csv.reader(io.StringIO(client.get(f"/api/projects/{job['build_id']}/exports/bom.csv").text)))
    assert len(rows) == len(bom["items"]) + 2
    assert rows[-1][3] == (bom["known_subtotal_amount"] or "")
    assert rows[-1][6] == f"total_status:{bom['total_status']}"
    for item, row in zip(bom["items"], rows[1:]):
        assert row[3] == (item["unit_price_amount"] or "")


def test_accepted_edit_stores_the_engines_plan_as_the_next_revision(real):
    client, app, spy = real
    build_id = run_job(client)["build_id"]
    resp = client.post(
        f"/api/projects/{build_id}/edits",
        json={"base_revision": 1, "operation": {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 700}},
    )
    assert resp.json() == {"accepted": True, "build_id": build_id, "revision": 2}
    returned = spy.edits[-1]["plan"]
    stored = app.state.deps.store.get(build_id, 2)
    for key in ("status", "verification", "bom", "behavior"):
        assert stored[key] == returned[key], key
    assert stored["behavior"]["parameters"]["turn_duration_ms"] == 700
    assert app.state.deps.store.get(build_id, 1)["behavior"]["parameters"]["turn_duration_ms"] == 600


def test_engine_rejections_are_honest_findings_and_create_no_revision(real):
    client, _, _ = real
    build_id = run_job(client)["build_id"]
    for op in (
        {"op": "change_appearance_color", "instance_id": "ghost-9", "color": "#223344"},
        {"op": "set_behavior_parameter", "name": "nonsense", "value": 1},
        {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 9999, 0]},
        {"op": "set_budget", "amount": "1.00"},
    ):
        body = client.post(f"/api/projects/{build_id}/edits", json={"base_revision": 1, "operation": op}).json()
        assert body["accepted"] is False and body["finding"]["result"] in ("FAIL", "UNKNOWN", "WARN"), op
    assert len(client.get(f"/api/projects/{build_id}/revisions").json()["revisions"]) == 1


def test_stale_edit_is_409_before_the_engine_is_called(real):
    client, _, spy = real
    build_id = run_job(client)["build_id"]
    op = {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 700}
    client.post(f"/api/projects/{build_id}/edits", json={"base_revision": 1, "operation": op})
    before = len(spy.edits)
    assert client.post(f"/api/projects/{build_id}/edits", json={"base_revision": 1, "operation": op}).status_code == 409
    assert len(spy.edits) == before


def test_unsupported_family_never_reaches_the_engine(real):
    client, _, spy = real
    job = run_job(client, {"input": {"kind": "text", "user_text": "design a racing drone"}})
    assert job["status"] == "failed" and job["error"]["code"] == "UNSUPPORTED_PROJECT_FAMILY"
    assert spy.solved == []


def test_firmware_follows_the_engines_status_and_pin_map(real):
    client, _, spy = real
    job = run_job(client)
    plan = spy.solved[0]
    resp = client.get(f"/api/projects/{job['build_id']}/exports/firmware.zip")
    if plan["status"] == "unbuildable":
        assert resp.status_code == 422 and resp.json()["error"]["code"] == "FIRMWARE_REFUSED"
    elif not plan["firmware"]["pin_map"]:
        assert resp.status_code == 422 and resp.json()["error"]["code"] == "FIRMWARE_NOT_SUPPORTED"
    else:
        assert resp.status_code == 200
        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            manifest = json.loads(z.read("manifest.json"))
        assert (manifest["build_id"], manifest["plan_status"]) == (job["build_id"], plan["status"])


def test_smoke_passes_against_the_real_engine(real):
    client, _, _ = real
    results = run_smoke(client, poll_interval_s=0.02)
    assert not [r for r in results if r.status == "FAIL"], results
    assert next(r for r in results if r.name == "edit").status == "PASS"
