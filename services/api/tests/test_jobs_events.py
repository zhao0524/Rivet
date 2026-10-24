import json
import threading
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from rivet_api.config import Settings
from rivet_api.errors import ApiError
from rivet_api.main import create_app
from rivet_api.orchestration.jobs import JobManager


@pytest.fixture
def jobs(tmp_path) -> JobManager:
    return JobManager(tmp_path / "jobs")


def sse_events(text: str) -> list[dict]:
    out = []
    for block in text.split("\n\n"):
        lines = [ln for ln in block.splitlines() if ln and not ln.startswith(":")]
        if not lines:
            continue
        fields = dict(ln.split(": ", 1) for ln in lines)
        out.append({"id": int(fields["id"]), **json.loads(fields["data"])})
    return out


def make_app_client(tmp_path, jobs: JobManager | None = None):
    app = create_app(Settings(mode="fixture", data_root=tmp_path))
    if jobs is not None:
        app.state.jobs = jobs
    return app, TestClient(app)


def test_event_ids_monotonic_per_job(jobs):
    a, b = jobs.create("generate"), jobs.create("generate")
    ids_a = [jobs.emit(a.job_id, "understand", "vision", "running", "x").event_id for _ in range(3)]
    ids_b = [jobs.emit(b.job_id, "understand", "vision", "running", "x").event_id for _ in range(2)]
    assert ids_a == [1, 2, 3]
    assert ids_b == [1, 2]


def test_events_after_returns_only_newer(jobs):
    job = jobs.create("generate")
    for i in range(4):
        jobs.emit(job.job_id, "understand", "vision", "running", f"m{i}")
    assert [e.event_id for e in jobs.events_after(job.job_id, 2)] == [3, 4]
    assert jobs.events_after(job.job_id, 99) == []


def test_stage_actor_status_enums_enforced(jobs):
    job = jobs.create("generate")
    with pytest.raises(ValidationError):
        jobs.emit(job.job_id, "dreaming", "vision", "running", "x")
    with pytest.raises(ValidationError):
        jobs.emit(job.job_id, "understand", "wizard", "running", "x")
    with pytest.raises(ValidationError):
        jobs.emit(job.job_id, "understand", "vision", "great", "x")
    assert jobs.events_after(job.job_id, 0) == []


def test_status_lifecycle_and_complete(jobs):
    job = jobs.create("generate")
    assert jobs.get(job.job_id).status == "queued"
    jobs.emit(job.job_id, "understand", "vision", "running", "reading")
    snap = jobs.get(job.job_id)
    assert (snap.status, snap.stage) == ("running", "understand")
    jobs.complete(job.job_id, "demo-build-001", 1)
    done = jobs.get(job.job_id)
    assert (done.status, done.build_id, done.revision) == ("complete", "demo-build-001", 1)
    last = jobs.events_after(job.job_id, 0)[-1]
    assert (last.stage, last.status) == ("complete", "ok")


def test_emit_after_terminal_is_rejected(jobs):
    job = jobs.create("generate")
    jobs.complete(job.job_id, "demo-build-001", 1)
    with pytest.raises(ValueError):
        jobs.emit(job.job_id, "understand", "vision", "running", "late")


def test_progress_is_null_without_planned_stages_and_real_when_planned(jobs):
    plain = jobs.create("generate")
    jobs.emit(plain.job_id, "understand", "vision", "ok", "done")
    assert jobs.get(plain.job_id).progress is None

    planned = jobs.create("generate", planned_stages=["understand", "assembly", "validate", "complete"])
    assert jobs.get(planned.job_id).progress == 0.0
    jobs.emit(planned.job_id, "understand", "vision", "running", "working")
    assert jobs.get(planned.job_id).progress == 0.0  # running is not completed
    jobs.emit(planned.job_id, "understand", "vision", "ok", "done")
    assert jobs.get(planned.job_id).progress == 0.25
    jobs.complete(planned.job_id, "demo-build-001", 1)
    assert jobs.get(planned.job_id).progress == 1.0


def test_fail_records_error_and_failed_event(jobs):
    job = jobs.create("generate")
    jobs.fail(job.job_id, ApiError("UNSUPPORTED_PROJECT_FAMILY", "no drones", 422, {"x": 1}))
    snap = jobs.get(job.job_id)
    assert snap.status == "failed"
    assert snap.error == {
        "code": "UNSUPPORTED_PROJECT_FAMILY",
        "message": "no drones",
        "details": {"x": 1},
        "retryable": False,
    }
    last = jobs.events_after(job.job_id, 0)[-1]
    assert (last.stage, last.status, last.actor) == ("failed", "failed", "system")


def test_run_converts_unexpected_exception_to_failed_without_leaking(jobs):
    job = jobs.create("generate")

    def boom(_job):
        raise ValueError("secret path /home/x")

    jobs.run(job.job_id, boom).join(timeout=5)
    snap = jobs.get(job.job_id)
    assert snap.status == "failed"
    assert snap.error["code"] == "INTERNAL"
    assert "secret path" not in json.dumps(snap.error)


def test_run_keeps_api_error_details(jobs):
    job = jobs.create("generate")

    def boom(_job):
        raise ApiError("VISION_PARSE_FAILED", "bad json", 502, retryable=True)

    jobs.run(job.job_id, boom).join(timeout=5)
    assert jobs.get(job.job_id).error["retryable"] is True


def test_run_function_that_returns_without_result_is_failed_not_hung(jobs):
    job = jobs.create("generate")
    jobs.run(job.job_id, lambda _j: None).join(timeout=5)
    snap = jobs.get(job.job_id)
    assert snap.status == "failed"
    assert snap.error["code"] == "INTERNAL"


def test_run_success_path(jobs):
    job = jobs.create("generate")

    def work(j):
        jobs.emit(j.job_id, "understand", "vision", "ok", "read")
        jobs.complete(j.job_id, "demo-build-001", 1)

    jobs.run(job.job_id, work).join(timeout=5)
    assert jobs.get(job.job_id).status == "complete"


def test_finished_job_survives_a_new_manager_instance(tmp_path):
    first = JobManager(tmp_path / "jobs")
    job = first.create("generate")
    first.emit(job.job_id, "understand", "vision", "ok", "read")
    first.complete(job.job_id, "demo-build-001", 1)
    second = JobManager(tmp_path / "jobs")
    assert second.get(job.job_id).status == "complete"
    assert [e.event_id for e in second.events_after(job.job_id, 0)] == [1, 2]


@pytest.mark.parametrize("bad", ["../x", "job-zzz", "", "job-1/2", "x" * 200])
def test_bad_or_unknown_job_ids_are_404_never_touch_disk(jobs, bad):
    with pytest.raises(ApiError) as exc:
        jobs.get(bad)
    assert exc.value.status == 404 and exc.value.code == "JOB_NOT_FOUND"


# ---- HTTP / SSE -----------------------------------------------------------


def test_job_status_route(tmp_path, jobs):
    job = jobs.create("generate")
    jobs.emit(job.job_id, "understand", "vision", "running", "reading")
    _, client = make_app_client(tmp_path, jobs)
    body = client.get(f"/api/jobs/{job.job_id}").json()
    assert body == {
        "job_id": job.job_id,
        "status": "running",
        "stage": "understand",
        "progress": None,
    }
    jobs.complete(job.job_id, "demo-build-001", 1)
    body = client.get(f"/api/jobs/{job.job_id}").json()
    assert body["build_id"] == "demo-build-001" and body["revision"] == 1


def test_unknown_job_route_404_envelope(tmp_path):
    _, client = make_app_client(tmp_path)
    resp = client.get("/api/jobs/job-000000000000")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "JOB_NOT_FOUND"
    assert client.get("/api/jobs/job-000000000000/events").status_code == 404


def test_sse_streams_all_events_then_closes_after_complete(tmp_path, jobs):
    job = jobs.create("generate")
    jobs.emit(job.job_id, "understand", "vision", "running", "reading")
    jobs.emit(job.job_id, "understand", "vision", "ok", "read")
    jobs.complete(job.job_id, "demo-build-001", 1)
    _, client = make_app_client(tmp_path, jobs)
    with client.stream("GET", f"/api/jobs/{job.job_id}/events") as resp:
        assert resp.headers["content-type"].startswith("text/event-stream")
        text = "".join(resp.iter_text())
    events = sse_events(text)
    assert [e["event_id"] for e in events] == [1, 2, 3]
    assert [e["id"] for e in events] == [1, 2, 3]
    assert events[-1]["stage"] == "complete"


def test_sse_replays_from_last_event_id_no_duplicates_or_gaps(tmp_path, jobs):
    job = jobs.create("generate")
    for i in range(4):
        jobs.emit(job.job_id, "understand", "vision", "running", f"m{i}")
    jobs.complete(job.job_id, "demo-build-001", 1)
    _, client = make_app_client(tmp_path, jobs)
    with client.stream(
        "GET", f"/api/jobs/{job.job_id}/events", headers={"Last-Event-ID": "2"}
    ) as resp:
        header_ids = [e["event_id"] for e in sse_events("".join(resp.iter_text()))]
    assert header_ids == [3, 4, 5]
    with client.stream("GET", f"/api/jobs/{job.job_id}/events?last_event_id=4") as resp:
        query_ids = [e["event_id"] for e in sse_events("".join(resp.iter_text()))]
    assert query_ids == [5]


def test_sse_garbage_last_event_id_replays_everything(tmp_path, jobs):
    job = jobs.create("generate")
    jobs.emit(job.job_id, "understand", "vision", "running", "x")
    jobs.complete(job.job_id, "demo-build-001", 1)
    _, client = make_app_client(tmp_path, jobs)
    with client.stream("GET", f"/api/jobs/{job.job_id}/events", headers={"Last-Event-ID": "abc"}) as r:
        ids = [e["event_id"] for e in sse_events("".join(r.iter_text()))]
    assert ids == [1, 2]


def test_sse_delivers_live_events_emitted_while_connected(tmp_path, jobs):
    job = jobs.create("generate")
    _, client = make_app_client(tmp_path, jobs)

    def produce():
        time.sleep(0.2)
        jobs.emit(job.job_id, "understand", "vision", "ok", "read")
        time.sleep(0.2)
        jobs.complete(job.job_id, "demo-build-001", 1)

    t = threading.Thread(target=produce)
    t.start()
    with client.stream("GET", f"/api/jobs/{job.job_id}/events") as resp:
        events = sse_events("".join(resp.iter_text()))
    t.join()
    assert [e["stage"] for e in events] == ["understand", "complete"]


def test_sse_ends_at_max_duration_for_job_that_never_finishes(tmp_path, jobs):
    jobs.keepalive_s = 0.05
    jobs.max_stream_s = 0.3
    job = jobs.create("generate")
    jobs.emit(job.job_id, "understand", "vision", "running", "stuck")
    _, client = make_app_client(tmp_path, jobs)
    started = time.monotonic()
    with client.stream("GET", f"/api/jobs/{job.job_id}/events") as resp:
        text = "".join(resp.iter_text())
    assert time.monotonic() - started < 3
    assert ": keepalive" in text
    assert [e["event_id"] for e in sse_events(text)] == [1]
