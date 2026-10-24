from typing import Any

from fastapi import APIRouter, Request

from rivet_api.errors import ApiError
from rivet_api.models.requests import ResolveRequest
from rivet_api.resolution.service import planned_resolve_stages, require_usable_resolver, resolve_product

router = APIRouter()


@router.post("/api/resolve", status_code=202)
def resolve(req: ResolveRequest, request: Request) -> dict[str, Any]:
    deps = request.app.state.deps
    if req.input.image_asset_id and not deps.assets.exists(req.input.image_asset_id):
        raise ApiError("ASSET_NOT_FOUND", "No such image asset", 404)
    require_usable_resolver(deps.settings, deps.resolver)
    job = deps.jobs.create("resolve", planned_stages=planned_resolve_stages(req))
    deps.jobs.run(job.job_id, lambda snapshot: resolve_product(req, deps, snapshot))
    return {"job_id": job.job_id, "status": "queued", "resolution_id": None}


@router.get("/api/resolutions/{resolution_id}")
def get_resolution(resolution_id: str, request: Request) -> dict[str, Any]:
    return request.app.state.deps.resolutions.get(resolution_id)


@router.get("/api/resolutions/{resolution_id}/evidence")
def get_evidence(resolution_id: str, request: Request) -> dict[str, Any]:
    record = request.app.state.deps.resolutions.get(resolution_id)
    return {"resolution_id": resolution_id, "ledger": record["ledger"]}
