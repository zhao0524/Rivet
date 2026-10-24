"""In-process job manager with replayable events.

Hackathon-grade: jobs live in memory and are mirrored best-effort to
<root>/<job_id>.json so finished jobs survive a restart. This is not a durable queue.
Events are only ever emitted by real pipeline stages; nothing here invents progress.
"""

import json
import logging
import os
import re
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from rivet_api.errors import ApiError
from rivet_api.models.events import JobEvent

log = logging.getLogger("rivet_api")

_JOB_ID_RE = re.compile(r"^job-[0-9a-f]{12}$")
_DONE_STATUSES = ("ok", "warning")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class JobSnapshot:
    job_id: str
    kind: str
    status: str
    stage: str | None
    progress: float | None
    error: dict[str, Any] | None
    build_id: str | None
    revision: int | None
    resolution_id: str | None = None


@dataclass
class _Job:
    job_id: str
    kind: str
    planned_stages: list[str] | None = None
    status: str = "queued"
    stage: str | None = None
    error: dict[str, Any] | None = None
    build_id: str | None = None
    revision: int | None = None
    resolution_id: str | None = None
    events: list[JobEvent] = field(default_factory=list)

    @property
    def terminal(self) -> bool:
        return self.status in ("complete", "failed")

    def progress(self) -> float | None:
        if not self.planned_stages:
            return None
        if self.status == "complete":
            return 1.0
        finished = {e.stage for e in self.events if e.status in _DONE_STATUSES}
        done = sum(1 for s in self.planned_stages if s in finished)
        return round(done / len(self.planned_stages), 2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "kind": self.kind,
            "planned_stages": self.planned_stages,
            "status": self.status,
            "stage": self.stage,
            "error": self.error,
            "build_id": self.build_id,
            "revision": self.revision,
            "resolution_id": self.resolution_id,
            "events": [e.model_dump(mode="json") for e in self.events],
        }


class JobManager:
    def __init__(self, root: Path | None = None, keepalive_s: float = 15.0, max_stream_s: float = 300.0):
        self.root = Path(root) if root is not None else None
        self.keepalive_s = keepalive_s
        self.max_stream_s = max_stream_s
        self._jobs: dict[str, _Job] = {}
        self._cond = threading.Condition()

    # -- persistence ---------------------------------------------------------
    def _persist(self, job: _Job) -> None:
        if self.root is None:
            return
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.root, prefix=".tmp-", suffix=".json")
            with os.fdopen(fd, "w") as f:
                json.dump(job.to_dict(), f)
            os.replace(tmp, self.root / f"{job.job_id}.json")
        except OSError:
            log.warning("could not persist job %s", job.job_id, exc_info=True)

    def _load(self, job_id: str) -> _Job | None:
        if self.root is None:
            return None
        path = self.root / f"{job_id}.json"
        try:
            raw = json.loads(path.read_text())
        except (OSError, ValueError):
            return None
        job = _Job(
            job_id=raw["job_id"],
            kind=raw["kind"],
            planned_stages=raw.get("planned_stages"),
            status=raw["status"],
            stage=raw.get("stage"),
            error=raw.get("error"),
            build_id=raw.get("build_id"),
            revision=raw.get("revision"),
            resolution_id=raw.get("resolution_id"),
            events=[JobEvent.model_validate(e) for e in raw.get("events", [])],
        )
        if not job.terminal:
            self._append_failed(job, ApiError("INTERNAL", "Job was interrupted by a server restart", 500))
        return job

    # -- internals (call with self._cond held) ------------------------------------
    def _lookup(self, job_id: str) -> _Job:
        if not isinstance(job_id, str) or not _JOB_ID_RE.match(job_id):
            raise ApiError("JOB_NOT_FOUND", "No such job", 404)
        job = self._jobs.get(job_id)
        if job is None:
            job = self._load(job_id)
            if job is None:
                raise ApiError("JOB_NOT_FOUND", "No such job", 404)
            self._jobs[job_id] = job
        return job

    def _append(self, job: _Job, stage, actor, status, message, references=None) -> JobEvent:
        event = JobEvent(
            event_id=len(job.events) + 1,
            job_id=job.job_id,
            stage=stage,
            actor=actor,
            status=status,
            message=message,
            timestamp=_now(),
            references=references or [],
        )
        job.events.append(event)
        job.stage = stage
        return event

    def _append_failed(self, job: _Job, error: ApiError) -> None:
        self._append(job, "failed", "system", "failed", error.message)
        job.status = "failed"
        job.error = error.envelope()["error"]

    # -- public API ---------------------------------------------------------------
    def create(self, kind: str, planned_stages: list[str] | None = None) -> JobSnapshot:
        job = _Job(job_id=f"job-{uuid.uuid4().hex[:12]}", kind=kind, planned_stages=planned_stages)
        with self._cond:
            self._jobs[job.job_id] = job
            self._persist(job)
            return self._snapshot(job)

    def emit(self, job_id, stage, actor, status, message, references=None) -> JobEvent:
        with self._cond:
            job = self._lookup(job_id)
            if job.terminal:
                raise ValueError(f"job {job_id} is already {job.status}")
            event = self._append(job, stage, actor, status, message, references)
            job.status = "running"
            self._persist(job)
            self._cond.notify_all()
            return event

    def complete(self, job_id: str, build_id: str, revision: int) -> None:
        with self._cond:
            job = self._lookup(job_id)
            if job.terminal:
                raise ValueError(f"job {job_id} is already {job.status}")
            self._append(job, "complete", "system", "ok", "Build ready")
            job.status = "complete"
            job.build_id, job.revision = build_id, revision
            self._persist(job)
            self._cond.notify_all()

    def complete_resolution(self, job_id: str, resolution_id: str) -> None:
        with self._cond:
            job = self._lookup(job_id)
            if job.terminal:
                raise ValueError(f"job {job_id} is already {job.status}")
            self._append(job, "complete", "system", "ok", "Resolution ready")
            job.status = "complete"
            job.resolution_id = resolution_id
            self._persist(job)
            self._cond.notify_all()

    def fail(self, job_id: str, error: ApiError) -> None:
        with self._cond:
            job = self._lookup(job_id)
            if job.terminal:
                return
            self._append_failed(job, error)
            self._persist(job)
            self._cond.notify_all()

    def get(self, job_id: str) -> JobSnapshot:
        with self._cond:
            return self._snapshot(self._lookup(job_id))

    def events_after(self, job_id: str, last_id: int = 0) -> list[JobEvent]:
        with self._cond:
            return [e for e in self._lookup(job_id).events if e.event_id > last_id]

    def wait_for_events(self, job_id: str, last_id: int, timeout: float) -> bool:
        """Block until an event newer than last_id exists or the job is terminal."""
        with self._cond:
            job = self._lookup(job_id)
            return self._cond.wait_for(
                lambda: len(job.events) > last_id or job.terminal, timeout=timeout
            )

    def run(self, job_id: str, fn: Callable[[JobSnapshot], None]) -> threading.Thread:
        def target() -> None:
            try:
                fn(self.get(job_id))
                if self.get(job_id).status not in ("complete", "failed"):
                    self.fail(job_id, ApiError("INTERNAL", "Job ended without producing a result", 500))
            except ApiError as err:
                self.fail(job_id, err)
            except Exception:
                log.exception("job %s crashed", job_id)
                self.fail(job_id, ApiError("INTERNAL", "Job failed unexpectedly", 500))

        thread = threading.Thread(target=target, name=f"rivet-{job_id}", daemon=True)
        thread.start()
        return thread

    @staticmethod
    def _snapshot(job: _Job) -> JobSnapshot:
        return JobSnapshot(
            job_id=job.job_id,
            kind=job.kind,
            status=job.status,
            stage=job.stage,
            progress=job.progress(),
            error=dict(job.error) if job.error else None,
            build_id=job.build_id,
            revision=job.revision,
            resolution_id=job.resolution_id,
        )
