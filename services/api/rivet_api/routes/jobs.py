import json
import time
from collections.abc import Iterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter()


def _parse_last_event_id(request: Request) -> int:
    raw = request.headers.get("last-event-id") or request.query_params.get("last_event_id") or "0"
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


@router.get("/api/jobs/{job_id}")
def job_status(job_id: str, request: Request) -> dict:
    job = request.app.state.jobs.get(job_id)
    body = {"job_id": job.job_id, "status": job.status, "stage": job.stage, "progress": job.progress}
    if job.error is not None:
        body["error"] = job.error
    if job.build_id is not None:
        body["build_id"] = job.build_id
        body["revision"] = job.revision
    return body


@router.get("/api/jobs/{job_id}/events")
def job_events(job_id: str, request: Request) -> StreamingResponse:
    jobs = request.app.state.jobs
    jobs.get(job_id)  # 404 before streaming starts
    last = _parse_last_event_id(request)

    def stream() -> Iterator[str]:
        nonlocal last
        deadline = time.monotonic() + jobs.max_stream_s
        while True:
            for event in jobs.events_after(job_id, last):
                last = event.event_id
                yield f"id: {event.event_id}\ndata: {json.dumps(event.model_dump(mode='json'))}\n\n"
            if jobs.get(job_id).status in ("complete", "failed") and not jobs.events_after(job_id, last):
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            if not jobs.wait_for_events(job_id, last, min(jobs.keepalive_s, remaining)):
                yield ": keepalive\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
