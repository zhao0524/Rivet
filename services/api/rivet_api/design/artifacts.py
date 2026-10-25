"""Durable v2 state and immutable, owner-authorized content-addressed assets."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import secrets
import sqlite3
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rivet_api.errors import ApiError
from .models import DesignBundle, DesignEvent


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


TERMINAL = {"complete", "failed", "cancelled", "budget_exhausted"}


class DesignStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.blobs = self.root / "assets"
        self.blobs.mkdir(exist_ok=True)
        self.condition = threading.Condition()
        with self.db() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions(owner TEXT PRIMARY KEY, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS asset_owners(asset TEXT NOT NULL, owner TEXT NOT NULL,
                PRIMARY KEY(asset,owner));
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner TEXT NOT NULL, build_id TEXT NOT NULL,
                status TEXT NOT NULL, stage TEXT, request TEXT NOT NULL, error TEXT, revision INTEGER,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(job TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY(job,seq));
            CREATE TABLE IF NOT EXISTS revisions(build TEXT NOT NULL, revision INTEGER NOT NULL,
                owner TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(build,revision));
            CREATE TABLE IF NOT EXISTS cache(key TEXT NOT NULL, owner TEXT NOT NULL, build TEXT NOT NULL,
                revision INTEGER NOT NULL, PRIMARY KEY(key,owner));
            CREATE TABLE IF NOT EXISTS inputs(asset TEXT NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY(asset,owner));
            CREATE TABLE IF NOT EXISTS calls(job TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY(job,id));
            """)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.root / "design.sqlite3", timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def session(self, token: str | None, *, create: bool = False) -> tuple[str, str | None]:
        if token and len(token) <= 128:
            owner = hashlib.sha256(token.encode()).hexdigest()
            with self.db() as db:
                if db.execute("SELECT 1 FROM sessions WHERE owner=?", (owner,)).fetchone():
                    return owner, None
        if not create:
            raise ApiError("SESSION_REQUIRED", "Start a Rivet session before accessing designs", 401)
        token = secrets.token_urlsafe(32)
        owner = hashlib.sha256(token.encode()).hexdigest()
        with self.db() as db:
            db.execute("INSERT INTO sessions VALUES (?,?)", (owner, now()))
        return owner, token

    def put(self, owner: str, data: bytes, mime: str) -> dict:
        asset_id = "asset-" + hashlib.sha256(data).hexdigest()
        path = self.blobs / asset_id
        if not path.exists():
            fd, tmp = tempfile.mkstemp(dir=self.blobs, prefix=".tmp-")
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(tmp, path)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO assets VALUES (?,?,?)", (asset_id, mime, len(data)))
            db.execute("INSERT OR IGNORE INTO asset_owners VALUES (?,?)", (asset_id, owner))
        return {"asset_id": asset_id, "url": f"/api/v2/assets/{asset_id}", "sha256": asset_id[6:], "mime_type": mime, "size_bytes": len(data)}

    def put_json(self, owner: str, value: Any) -> dict:
        return self.put(owner, canonical(value), "application/json")

    def asset(self, owner: str, asset_id: str) -> tuple[Path, str]:
        with self.db() as db:
            row = db.execute("SELECT a.* FROM assets a JOIN asset_owners o ON a.id=o.asset WHERE a.id=? AND o.owner=?", (asset_id, owner)).fetchone()
        if not row or not (self.blobs / row["id"]).is_file():
            raise ApiError("ASSET_NOT_FOUND", "No such design asset", 404)
        return self.blobs / row["id"], row["mime"]

    def record_input(self, owner: str, asset_id: str, record: dict):
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO inputs VALUES (?,?,?)", (asset_id, owner, canonical(record).decode()))

    def input(self, owner: str, asset_id: str) -> dict:
        self.asset(owner, asset_id)
        with self.db() as db:
            row = db.execute("SELECT data FROM inputs WHERE asset=? AND owner=?", (asset_id, owner)).fetchone()
        if not row:
            raise ApiError("INVALID_REFERENCE", "Asset is not an uploaded reference", 400)
        return json.loads(row["data"])

    def create_job(self, owner: str, request: dict, build_id: str | None = None) -> dict:
        job_id = "gen-" + secrets.token_hex(12)
        build_id = build_id or "design-" + secrets.token_hex(12)
        with self.db() as db:
            db.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)", (job_id, owner, build_id, "queued", "intake", canonical(request).decode(), None, None, now(), now()))
        return self.job(owner, job_id)

    def job(self, owner: str, job_id: str) -> dict:
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=? AND owner=?", (job_id, owner)).fetchone()
        if not row:
            raise ApiError("JOB_NOT_FOUND", "No such generation job", 404)
        return {"job_id": row["id"], "build_id": row["build_id"], "status": row["status"], "stage": row["stage"], "request": json.loads(row["request"]), "error": json.loads(row["error"]) if row["error"] else None, "revision": row["revision"], "created_at": row["created_at"], "updated_at": row["updated_at"]}

    def emit(self, owner: str, job_id: str, stage: str, message: str, *, actor="system", status="ok", **kwargs) -> dict:
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=? AND owner=?", (job_id, owner)).fetchone()
            if not row:
                raise ApiError("JOB_NOT_FOUND", "No such generation job", 404)
            if row["status"] in TERMINAL:
                raise ApiError("JOB_TERMINAL", "Generation is already finished", 409)
            seq = db.execute("SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE job=?", (job_id,)).fetchone()[0]
            kwargs.setdefault("build_id", row["build_id"])
            event = DesignEvent(event_id=seq, job_id=job_id, timestamp=now(), stage=stage, actor=actor, status=status, message=message, **kwargs).model_dump(mode="json")
            db.execute("INSERT INTO events VALUES (?,?,?)", (job_id, seq, canonical(event).decode()))
            db.execute("UPDATE jobs SET status='running',stage=?,updated_at=? WHERE id=?", (stage, now(), job_id))
        with self.condition:
            self.condition.notify_all()
        return event

    def finish(self, owner: str, job_id: str, status: str, *, error: dict | None = None, revision: int | None = None):
        with self.db() as db:
            db.execute("UPDATE jobs SET status=?,error=?,revision=?,updated_at=? WHERE id=? AND owner=?", (status, canonical(error).decode() if error else None, revision, now(), job_id, owner))
        with self.condition:
            self.condition.notify_all()

    def events(self, owner: str, job_id: str, after=0) -> list[dict]:
        self.job(owner, job_id)
        with self.db() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT data FROM events WHERE job=? AND seq>? ORDER BY seq", (job_id, after))]

    def checkpoint(self, owner: str, job_id: str, name: str, value: dict):
        self.job(owner, job_id)
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO calls VALUES (?,?,?)", (job_id, name, canonical(value).decode()))

    def checkpoints(self, owner: str, job_id: str) -> dict:
        self.job(owner, job_id)
        with self.db() as db:
            return {r["id"]: json.loads(r["data"]) for r in db.execute("SELECT * FROM calls WHERE job=?", (job_id,))}

    def save_bundle(self, owner: str, bundle: dict, base_revision: int | None = None) -> dict:
        data = copy.deepcopy(bundle)
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT revision,owner FROM revisions WHERE build=? ORDER BY revision DESC LIMIT 1", (data["build_id"],)).fetchone()
            latest = row["revision"] if row else 0
            if row and row["owner"] != owner:
                raise ApiError("PROJECT_NOT_FOUND", "No such design", 404)
            if (base_revision or 0) != latest:
                raise ApiError("STALE_REVISION", "The design changed; reload before editing", 409, {"latest_revision": latest})
            data.update(revision=latest+1, parent_revision=base_revision, created_at=now())
            data = DesignBundle.model_validate(data).model_dump(mode="json")
            # All blob URLs are authorized and materialized before publishing a revision.
            def verify(value):
                if isinstance(value, dict):
                    for v in value.values(): verify(v)
                elif isinstance(value, list):
                    for v in value: verify(v)
                elif isinstance(value, str) and value.startswith("/api/v2/assets/"):
                    aid = value.rsplit("/", 1)[-1]
                    if not db.execute("SELECT 1 FROM asset_owners WHERE asset=? AND owner=?", (aid,owner)).fetchone() or not (self.blobs/aid).is_file():
                        raise ApiError("MISSING_ASSET", "Revision references a missing artifact", 422)
            verify(data)
            db.execute("INSERT INTO revisions VALUES (?,?,?,?)", (data["build_id"], data["revision"], owner, canonical(data).decode()))
        return data

    def bundle(self, owner: str, build_id: str, revision: int | None = None) -> dict:
        with self.db() as db:
            if revision is None:
                row = db.execute("SELECT data FROM revisions WHERE build=? AND owner=? ORDER BY revision DESC LIMIT 1", (build_id,owner)).fetchone()
            else:
                row = db.execute("SELECT data FROM revisions WHERE build=? AND owner=? AND revision=?", (build_id,owner,revision)).fetchone()
        if not row:
            raise ApiError("PROJECT_NOT_FOUND", "No such design revision", 404)
        return json.loads(row[0])

    def list_projects(self, owner: str) -> list[dict]:
        with self.db() as db:
            rows = db.execute("SELECT r.data FROM revisions r JOIN (SELECT build,MAX(revision) n FROM revisions WHERE owner=? GROUP BY build) l ON r.build=l.build AND r.revision=l.n ORDER BY r.rowid DESC", (owner,))
            return [self.summary(json.loads(row[0])) for row in rows]

    def revisions(self, owner: str, build_id: str) -> list[dict]:
        self.bundle(owner,build_id)
        with self.db() as db:
            return [self.summary(json.loads(row[0])) for row in db.execute("SELECT data FROM revisions WHERE build=? AND owner=? ORDER BY revision", (build_id,owner))]

    @staticmethod
    def summary(bundle):
        return {key: bundle[key] for key in ("build_id","revision","title","status","mode","created_at","selected_candidate_id","scene_asset_url","parent_revision")}

    def cache_put(self, owner: str, key: str, bundle: dict):
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?,?)", (key,owner,bundle["build_id"],bundle["revision"]))

    def cache_get(self, owner: str, key: str) -> dict | None:
        with self.db() as db:
            row = db.execute("SELECT build,revision FROM cache WHERE key=? AND owner=?", (key,owner)).fetchone()
        return self.bundle(owner,row["build"],row["revision"]) if row else None

    def recover_interrupted(self):
        with self.db() as db:
            rows = list(db.execute("SELECT id,owner FROM jobs WHERE status NOT IN ('complete','failed','cancelled','budget_exhausted')"))
        for row in rows:
            error = {"code":"JOB_INTERRUPTED","message":"Service restarted; completed artifacts were retained. Retry explicitly to avoid repeating uncertain paid calls.","details":{},"retryable":True}
            self.emit(row["owner"],row["id"],"failed",error["message"],status="failed")
            self.finish(row["owner"],row["id"],"failed",error=error)
