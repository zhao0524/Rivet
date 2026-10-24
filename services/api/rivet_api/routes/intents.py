from typing import Any

from fastapi import APIRouter, Request

from rivet_api.errors import ApiError
from rivet_api.models.requests import InterpretRequest
from rivet_api.orchestration.pipeline import interpret_request

router = APIRouter()


@router.post("/api/intents/interpret")
def interpret(req: InterpretRequest, request: Request) -> dict[str, Any]:
    """Read the input (vision + sanitizer, never the engine) and keep the result for a build.

    Same input rules as generate. An unsupported interpretation is a 200 with a `limitation`,
    so the client can show what was understood and offer choices instead of an error.
    """
    deps = request.app.state.deps
    if req.input.image_asset_id and not deps.assets.exists(req.input.image_asset_id):
        raise ApiError("ASSET_NOT_FOUND", "No such image asset", 404)
    return interpret_request(req, deps)
