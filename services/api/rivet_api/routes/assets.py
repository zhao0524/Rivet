from typing import Any

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

router = APIRouter()


@router.post("/api/assets/images")
async def upload_image(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    store = request.app.state.deps.assets
    # Read at most one byte past the limit so oversized uploads are rejected without
    # holding them fully in memory.
    data = await file.read(store.max_bytes + 1)
    session_id = request.headers.get("x-rivet-session") or (
        request.client.host if request.client else "anonymous"
    )
    record = await run_in_threadpool(store.save, data, session_id)
    return {
        "asset_id": record.asset_id,
        "mime_type": record.mime_type,
        "size_bytes": record.size_bytes,
        "preview_url": f"/api/assets/{record.asset_id}/preview",
    }


@router.get("/api/assets/{asset_id}/preview")
def preview(asset_id: str, request: Request) -> Response:
    data, mime = request.app.state.deps.assets.read_bytes(asset_id)
    return Response(
        content=data,
        media_type=mime,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
            "Cache-Control": "private, max-age=3600",
        },
    )
