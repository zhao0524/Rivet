"""/api/v2: geometry-first generation, candidates, revisions, assets and exports.

Every route is scoped to the caller's Rivet session (httponly cookie `rivet_session`, or
`X-Rivet-Session` for scripts); jobs, events, assets and designs of other sessions are
404. Asset URLs are content-addressed and never expose filesystem paths.
"""
from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator

from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response, StreamingResponse

from rivet_api.assets.store import AssetStore
from rivet_api.design.artifacts import TERMINAL, digest
from rivet_api.design.models import GenerationRequest, RestoreRequest, RevisionRequest, SelectionRequest
from rivet_api.design.orchestrator import Run, cache_key, firmware_zip, run_job
from rivet_api.errors import ApiError

router = APIRouter(prefix="/api/v2")
COOKIE = "rivet_session"


def _svc(request: Request):
    return request.app.state.design


def _owner(request: Request, create: bool = False) -> tuple[str, str | None]:
    token = request.cookies.get(COOKIE) or request.headers.get("x-rivet-session")
    return _svc(request).store.session(token, create=create)


def _with_cookie(body: dict, token: str | None, status: int = 200) -> JSONResponse:
    response = JSONResponse(body, status_code=status)
    if token:
        response.set_cookie(COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30)
    return response


@router.get("/session")
def session(request: Request) -> JSONResponse:
    owner, token = _owner(request, create=True)
    svc = _svc(request)
    return _with_cookie({"session": "ok", "generation_mode": svc.mode, "renderer": svc.renderer, "providers": getattr(svc, "provider_names", {})}, token)


@router.post("/assets/images")
async def upload(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    owner, token = _owner(request, create=True)
    cleaner = AssetStore(_svc(request).work_root / "uploads")
    data = await file.read(cleaner.max_bytes + 1)
    if len(data) > cleaner.max_bytes:
        raise ApiError("FILE_TOO_LARGE", f"Images must be at most {cleaner.max_bytes} bytes", 413)
    fmt, clean = await run_in_threadpool(cleaner._decode_and_clean, data)
    encoded = cleaner._encode(clean, fmt)
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[fmt]
    stored = _svc(request).store.put(owner, encoded, mime)
    _svc(request).store.record_input(owner, stored["asset_id"], {"kind": "reference_image", "mime_type": mime, "width": clean.size[0], "height": clean.size[1], "sha256": stored["sha256"]})
    return _with_cookie({"asset_id": stored["asset_id"], "preview_url": stored["url"], "sha256": stored["sha256"], "mime_type": mime, "width": clean.size[0], "height": clean.size[1]}, token)


@router.get("/assets/{asset_id}")
def asset(asset_id: str, request: Request) -> Response:
    owner, _ = _owner(request)
    path, mime = _svc(request).store.asset(owner, asset_id)
    return Response(path.read_bytes(), media_type=mime, headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'",
                                                                  "Cache-Control": "private, max-age=31536000, immutable"})


def _start(request: Request, owner: str, body: dict, action, build_id: str | None = None, key: str | None = None) -> dict:
    svc = _svc(request)
    job = svc.store.create_job(owner, body, build_id)
    job["cache_key"] = key
    threading.Thread(target=run_job, args=(svc, owner, job, action), name=f"rivet-{job['job_id']}", daemon=True).start()
    return job


@router.post("/generations", status_code=202)
def generate(req: GenerationRequest, request: Request) -> JSONResponse:
    owner, token = _owner(request, create=True)
    svc = _svc(request)
    body = req.model_dump(mode="json")
    image_sha = None
    if req.input.image_asset_id:
        svc.store.input(owner, req.input.image_asset_id)  # 404/400 unless it is this session's uploaded reference
        image_sha = req.input.image_asset_id[6:]
    names = getattr(svc, "provider_names", {})
    key = cache_key(svc, body, image_sha, names)
    cached = svc.store.cache_get(owner, key) if req.allow_cached else None
    if cached is not None:
        job = _start(request, owner, body, lambda run: run.replay(cached))
        return _with_cookie({"job_id": job["job_id"], "build_id": job["build_id"], "status": "queued", "cached": True}, token, 202)
    job = _start(request, owner, body, Run.generate, key=key)
    return _with_cookie({"job_id": job["job_id"], "build_id": job["build_id"], "status": "queued", "cached": False}, token, 202)


@router.get("/generations/{job_id}")
def job_status(job_id: str, request: Request) -> dict:
    owner, _ = _owner(request)
    job = _svc(request).store.job(owner, job_id)
    job.pop("request", None)
    return job


@router.post("/generations/{job_id}/cancel")
def cancel(job_id: str, request: Request) -> dict:
    owner, _ = _owner(request)
    svc = _svc(request)
    job = svc.store.job(owner, job_id)
    if job["status"] in TERMINAL:
        return {"job_id": job_id, "status": job["status"], "cancelled": False}
    svc.cancels.setdefault(job_id, threading.Event()).set()
    return {"job_id": job_id, "status": "cancelling", "cancelled": True}


@router.get("/generations/{job_id}/events")
def events(job_id: str, request: Request) -> StreamingResponse:
    owner, _ = _owner(request)
    store = _svc(request).store
    store.job(owner, job_id)
    raw = request.headers.get("last-event-id") or request.query_params.get("last_event_id") or "0"
    last = int(raw) if raw.isdigit() else 0

    def stream() -> Iterator[str]:
        nonlocal last
        deadline = time.monotonic() + 600
        idle = time.monotonic()
        while time.monotonic() < deadline:
            batch = store.events(owner, job_id, last)
            for e in batch:
                last = e["event_id"]
                yield f"id: {e['event_id']}\nevent: {e['stage']}\ndata: {json.dumps(e)}\n\n"
            if batch:
                idle = time.monotonic()
            if store.job(owner, job_id)["status"] in TERMINAL and not store.events(owner, job_id, last):
                return
            if time.monotonic() - idle > 15:
                idle = time.monotonic()
                yield ": keepalive\n\n"
            with store.condition:
                store.condition.wait(timeout=1.0)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/projects")
def projects(request: Request) -> dict:
    owner, _ = _owner(request)
    return {"projects": _svc(request).store.list_projects(owner)}


@router.get("/projects/{build_id}/design")
def design(build_id: str, request: Request, revision: int | None = Query(default=None, ge=1)) -> dict:
    owner, _ = _owner(request)
    return _svc(request).store.bundle(owner, build_id, revision)


@router.get("/projects/{build_id}/candidates")
def candidates(build_id: str, request: Request, revision: int | None = Query(default=None, ge=1)) -> dict:
    owner, _ = _owner(request)
    b = _svc(request).store.bundle(owner, build_id, revision)
    return {"build_id": build_id, "revision": b["revision"], "selected_candidate_id": b["selected_candidate_id"], "recommendation": b["recommendation"],
            "candidates": [{k: c.get(k) for k in ("id", "strategy", "status", "feasible", "claims", "visual", "shots", "geometry_digest", "scene_asset_url", "error")} for c in b["candidates"]]}


@router.get("/projects/{build_id}/revisions")
def revisions(build_id: str, request: Request) -> dict:
    owner, _ = _owner(request)
    return {"build_id": build_id, "revisions": _svc(request).store.revisions(owner, build_id)}


@router.post("/projects/{build_id}/select")
def select(build_id: str, req: SelectionRequest, request: Request) -> dict:
    owner, _ = _owner(request)
    store = _svc(request).store
    base = store.bundle(owner, build_id, req.base_revision)
    if base["job_id"] != req.job_id:
        raise ApiError("JOB_MISMATCH", "This choice belongs to a different generation job", 409)
    chosen = next((c for c in base["candidates"] if c["id"] == req.candidate_id), None)
    if chosen is None or chosen["status"] != "complete":
        raise ApiError("CANDIDATE_NOT_FOUND", "No completed candidate with that id in this revision", 404)
    nxt = dict(base)
    nxt.update(selected_candidate_id=chosen["id"], scene_asset_url=chosen["scene_asset_url"], change={"selected": chosen["id"], "previous": base["selected_candidate_id"]},
               assembly=[{"id": p["body_id"], "body_id": p["body_id"], "parent_id": p["parent_id"], "role": p["role"], "kind": p["kind"], "transform_mm": p["transform_mm"],
                          "asset_url": p.get("asset_url"), "provenance": p["geometry_source"]} for p in chosen["part_manifest"] if p["status"] == "placed"],
               linked_plan_url=chosen.get("functional", {}).get("linked_plan_url"))
    if base["mode"] == "concept_only":
        nxt["status"] = "complete" if chosen["feasible"] else "needs_review"
    return store.save_bundle(owner, nxt, req.base_revision)


@router.post("/projects/{build_id}/restore")
def restore(build_id: str, req: RestoreRequest, request: Request) -> dict:
    owner, _ = _owner(request)
    store = _svc(request).store
    store.bundle(owner, build_id, req.base_revision)
    target = store.bundle(owner, build_id, req.target_revision)
    return store.save_bundle(owner, {**target, "change": {"restored_from": req.target_revision}}, req.base_revision)


@router.post("/projects/{build_id}/revise", status_code=202)
def revise(build_id: str, req: RevisionRequest, request: Request) -> dict:
    owner, _ = _owner(request)
    store = _svc(request).store
    base = store.bundle(owner, build_id)
    if base["revision"] != req.base_revision:
        raise ApiError("STALE_REVISION", "The design changed; reload before editing", 409, {"latest_revision": base["revision"]})
    if not base.get("selected_candidate_id"):
        raise ApiError("NO_SELECTION", "Choose a candidate before revising", 409)
    job = _start(request, owner, {"kind": "revision", "build_id": build_id, "instruction": req.instruction, "base_revision": req.base_revision, "generation_budget_usd": base["budget"]["limit_usd"],
                                  "mode": base["mode"], "input": base["original_request"] | {"user_text": base["original_request"].get("text", "")}},
                 lambda run: run.revise(base, req.instruction, req.selected_body_ids), build_id=build_id)
    return {"job_id": job["job_id"], "build_id": build_id, "status": "queued"}


@router.get("/projects/{build_id}/export")
def export(build_id: str, request: Request, kind: str = Query(...), revision: int | None = Query(default=None, ge=1), body_id: str | None = None) -> Response:
    owner, _ = _owner(request)
    store = _svc(request).store
    b = store.bundle(owner, build_id, revision)
    chosen = next((c for c in b["candidates"] if c["id"] == b["selected_candidate_id"]), None)
    if chosen is None or chosen["status"] != "complete":
        raise ApiError("EXPORT_UNAVAILABLE", "This revision has no completed selected candidate", 422)

    def serve(url: str | None, name: str, reason: str) -> Response:
        if not url:
            raise ApiError("EXPORT_UNAVAILABLE", reason, 422)
        path, mime = store.asset(owner, url.rsplit("/", 1)[-1])
        return Response(path.read_bytes(), media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})

    stem = f"{build_id}-r{b['revision']}"
    if kind == "glb":
        return serve(chosen["scene_asset_url"], f"{stem}.glb", "no scene")
    if kind in ("part_glb", "step", "stl"):
        want = "glb" if kind == "part_glb" else kind
        asset = next((a for a in chosen["manufacturing_assets"] if a["kind"] == want and a.get("body_id") == body_id), None)
        reason = (asset or {}).get("unavailable") or f"no {kind} export for body {body_id!r} (STEP/STL exist only for fabricated parts with valid geometry)"
        return serve((asset or {}).get("url"), f"{stem}-{body_id}.{want if want != 'glb' else 'glb'}", reason)
    if kind == "assembly_step":
        asset = next((a for a in chosen["manufacturing_assets"] if a["kind"] == "step_assembly"), None)
        return serve((asset or {}).get("url"), f"{stem}-assembly.step", (asset or {}).get("unavailable") or "no B-rep bodies")
    if kind in ("bom", "assembly_steps", "manifest"):
        return serve(b["exports"].get(kind), f"{stem}-{kind}.json", f"no {kind}")
    if kind == "trace":
        return serve(b.get("generation_trace_url"), f"{stem}-trace.json", "no trace")
    if kind == "firmware":
        url = chosen.get("functional", {}).get("linked_plan_url")
        if not url or not chosen.get("functional", {}).get("firmware", {}).get("supported"):
            raise ApiError("EXPORT_REFUSED", chosen.get("functional", {}).get("firmware", {}).get("reason") or "No tested firmware profile for this design", 422)
        path, _ = store.asset(owner, url.rsplit("/", 1)[-1])
        plan = json.loads(path.read_bytes())
        plan["build_id"], plan["revision"] = build_id[:64], b["revision"]
        return Response(firmware_zip(plan), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{stem}-firmware.zip"'})
    raise ApiError("BAD_EXPORT_KIND", "kind must be glb, part_glb, step, stl, assembly_step, bom, assembly_steps, manifest, trace or firmware", 400)


def digest_request(body: dict) -> str:
    return digest(body)
