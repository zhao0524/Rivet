from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/api/health")
def health(request: Request) -> dict:
    return {"ok": True, "mode": request.app.state.settings.mode}
