from typing import Any

from fastapi import APIRouter, Query, Request

from rivet_api.adapters.fixture import FixtureEngineeringAdapter
from rivet_api.errors import ApiError
from rivet_api.models.requests import EditRequest, GenerateRequest
from rivet_api.orchestration.pipeline import apply_edit_request, generate_project, planned_stages

router = APIRouter()


@router.post("/api/projects/generate", status_code=202)
def generate(req: GenerateRequest, request: Request) -> dict[str, Any]:
    deps = request.app.state.deps
    if req.input.image_asset_id and not deps.assets.exists(req.input.image_asset_id):
        raise ApiError("ASSET_NOT_FOUND", "No such image asset", 404)
    job = deps.jobs.create("generate", planned_stages=planned_stages(deps, req))
    deps.jobs.run(job.job_id, lambda snapshot: generate_project(req, deps, snapshot))
    return {"job_id": job.job_id, "status": "queued", "build_id": None}


# Registered before /{build_id} so "examples" is not read as a build id.
@router.get("/api/projects/examples")
def examples(request: Request) -> dict[str, Any]:
    fixture = FixtureEngineeringAdapter(request.app.state.deps.settings.demo_fixture)
    return {"examples": [fixture.describe()]}


@router.get("/api/projects/{build_id}")
def get_project(build_id: str, request: Request, revision: int | None = Query(default=None, ge=1)) -> dict:
    return request.app.state.deps.store.get(build_id, revision)


@router.get("/api/projects/{build_id}/revisions")
def revisions(build_id: str, request: Request) -> dict[str, Any]:
    return {"build_id": build_id, "revisions": request.app.state.deps.store.list_revisions(build_id)}


@router.post("/api/projects/{build_id}/edits")
def edits(build_id: str, req: EditRequest, request: Request) -> dict[str, Any]:
    return apply_edit_request(build_id, req, request.app.state.deps)


@router.get("/api/catalog")
def catalog(request: Request, category: str | None = None) -> dict[str, Any]:
    components = request.app.state.deps.engine.get_catalog()
    if category is not None:
        components = [c for c in components if c.get("identity", {}).get("category") == category]
    return {"schema_version": "1.0", "components": components}
