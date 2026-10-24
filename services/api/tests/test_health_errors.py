from fastapi import APIRouter
from fastapi.testclient import TestClient

from rivet_api.config import Settings
from rivet_api.errors import ApiError
from rivet_api.main import create_app


def make_client(**overrides) -> TestClient:
    settings = Settings(mode="fixture", **overrides)
    return TestClient(create_app(settings), raise_server_exceptions=False)


def test_health_reports_mode():
    resp = make_client().get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "mode": "fixture"}


def test_api_error_envelope():
    app = create_app(Settings(mode="fixture"))
    router = APIRouter()

    @router.get("/boom")
    def boom():
        raise ApiError(
            "UNSUPPORTED_PROJECT_FAMILY",
            "Flight-ready drone generation is not supported in this version",
            422,
            {"supported_families": ["rover"]},
        )

    app.include_router(router)
    resp = TestClient(app).get("/boom")
    assert resp.status_code == 422
    assert resp.json() == {
        "error": {
            "code": "UNSUPPORTED_PROJECT_FAMILY",
            "message": "Flight-ready drone generation is not supported in this version",
            "details": {"supported_families": ["rover"]},
            "retryable": False,
        }
    }


def test_unknown_exception_is_500_envelope_without_traceback():
    app = create_app(Settings(mode="fixture"))
    router = APIRouter()

    @router.get("/crash")
    def crash():
        raise RuntimeError("secret internal detail")

    app.include_router(router)
    resp = TestClient(app, raise_server_exceptions=False).get("/crash")
    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "INTERNAL"
    assert "secret internal detail" not in resp.text
    assert "Traceback" not in resp.text


def test_validation_error_is_400_envelope():
    app = create_app(Settings(mode="fixture"))
    router = APIRouter()

    @router.get("/needs-int")
    def needs_int(n: int):
        return {"n": n}

    app.include_router(router)
    resp = TestClient(app).get("/needs-int?n=abc")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "BAD_REQUEST"
