"""File-backed immutable revision store.

Layout: <root>/<build_id>/revision-<n>.json plus an append-only edit-log.jsonl.
Revisions are never rewritten. Appending requires the caller's base_revision to be the
latest one (optimistic concurrency), enforced under a per-project lock. The store
never edits `status`, `verification` or any engineering field; it only sets
`build_id`, `revision` and (on appended revisions) `created_at`.
"""

import copy
import json
import os
import re
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rivet_api.errors import ApiError

_BUILD_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
_REVISION_RE = re.compile(r"^revision-(\d+)\.json$")
_EDIT_LOG = "edit-log.jsonl"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ProjectStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    # -- helpers -----------------------------------------------------------
    def _lock(self, build_id: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(build_id, threading.Lock())

    @staticmethod
    def _check_id(build_id: str) -> str:
        if not isinstance(build_id, str) or not _BUILD_ID_RE.match(build_id):
            raise ApiError("BAD_BUILD_ID", "build_id is not a valid identifier", 400)
        return build_id

    def _dir(self, build_id: str) -> Path:
        return self.root / self._check_id(build_id)

    def _revisions(self, build_id: str) -> list[int]:
        d = self._dir(build_id)
        if not d.is_dir():
            raise ApiError("PROJECT_NOT_FOUND", f"No project {build_id!r}", 404)
        found = []
        for p in d.iterdir():
            m = _REVISION_RE.match(p.name)
            if m:
                found.append(int(m.group(1)))
        if not found:
            raise ApiError("PROJECT_NOT_FOUND", f"No project {build_id!r}", 404)
        return sorted(found)

    @staticmethod
    def _write_atomic(path: Path, plan: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(plan, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    # -- public API --------------------------------------------------------
    def create(self, plan: dict[str, Any], build_id: str | None = None) -> dict[str, Any]:
        build_id = self._check_id(
            build_id if build_id is not None else f"rivet-{uuid.uuid4().hex[:12]}"
        )
        with self._lock(build_id):
            if self._dir(build_id).exists():
                raise ApiError("PROJECT_EXISTS", f"Project {build_id!r} already exists", 409)
            stored = copy.deepcopy(plan)
            stored["build_id"] = build_id
            stored["revision"] = 1
            self._write_atomic(self._dir(build_id) / "revision-1.json", stored)
            return copy.deepcopy(stored)

    def get(self, build_id: str, revision: int | None = None) -> dict[str, Any]:
        revisions = self._revisions(build_id)
        if revision is None:
            revision = revisions[-1]
        elif revision not in revisions:
            raise ApiError("REVISION_NOT_FOUND", f"No revision {revision} for {build_id!r}", 404)
        return json.loads((self._dir(build_id) / f"revision-{revision}.json").read_text())

    def append_revision(self, build_id: str, base_revision: int, plan: dict[str, Any]) -> int:
        with self._lock(build_id):
            latest = self._revisions(build_id)[-1]
            if base_revision != latest:
                raise ApiError(
                    "STALE_REVISION",
                    f"base_revision {base_revision} is not the latest ({latest})",
                    409,
                    {"latest_revision": latest},
                )
            stored = copy.deepcopy(plan)
            stored["build_id"] = build_id
            stored["revision"] = latest + 1
            stored["created_at"] = _now()
            self._write_atomic(self._dir(build_id) / f"revision-{latest + 1}.json", stored)
            return latest + 1

    def list_revisions(self, build_id: str) -> list[dict[str, Any]]:
        out = []
        for n in self._revisions(build_id):
            plan = self.get(build_id, n)
            out.append(
                {
                    "revision": n,
                    "created_at": plan.get("created_at"),
                    "status": plan.get("status"),
                    "title": plan.get("title"),
                }
            )
        return out

    def log_edit(self, build_id: str, entry: dict[str, Any]) -> None:
        self._revisions(build_id)  # 404 if missing
        record = {**entry, "logged_at": _now()}
        with self._lock(build_id):
            with open(self._dir(build_id) / _EDIT_LOG, "a") as f:
                f.write(json.dumps(record) + "\n")
                f.flush()
                os.fsync(f.fileno())

    def read_edit_log(self, build_id: str) -> list[dict[str, Any]]:
        self._revisions(build_id)
        path = self._dir(build_id) / _EDIT_LOG
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
