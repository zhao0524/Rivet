from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from rivet_api.firmware.estelle import EVIDENCE_FILE

router = APIRouter()


class GroundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["locate", "dependencies"]
    name: str


@router.get("/api/estelle/status")
def estelle_status(request: Request) -> dict[str, Any]:
    return request.app.state.deps.grounder.status()


@router.post("/api/estelle/ground")
def estelle_ground(req: GroundRequest, request: Request) -> dict[str, Any]:
    grounder = request.app.state.deps.grounder
    result = grounder.locate_symbols(req.name) if req.kind == "locate" else grounder.inspect_dependencies(req.name)
    captured = grounder.capture_evidence(result)
    return {**result.to_dict(), "evidence_file": EVIDENCE_FILE if captured else None}
