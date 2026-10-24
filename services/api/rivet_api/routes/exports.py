import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from rivet_api.exports.bom import bom_to_csv

router = APIRouter()


def _download(content: str, media_type: str, filename: str, plan: dict) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
            "X-Rivet-Generation-Mode": plan["provenance"]["generation_mode"],
        },
    )


@router.get("/api/projects/{build_id}/exports/bom.csv")
def export_bom(build_id: str, request: Request, revision: int | None = Query(default=None, ge=1)) -> Response:
    plan = request.app.state.deps.store.get(build_id, revision)
    return _download(bom_to_csv(plan), "text/csv", f"{build_id}-r{plan['revision']}-bom.csv", plan)


@router.get("/api/projects/{build_id}/exports/build.json")
def export_build(build_id: str, request: Request, revision: int | None = Query(default=None, ge=1)) -> Response:
    plan = request.app.state.deps.store.get(build_id, revision)
    return _download(
        json.dumps(plan, indent=2), "application/json", f"{build_id}-r{plan['revision']}.json", plan
    )
