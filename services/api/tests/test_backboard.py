import httpx
import pytest

from rivet_api.adapters.backboard_provider import BackboardBackend
from rivet_api.agents.vision import LiveVisionProvider, build_vision_port
from rivet_api.config import Settings
from rivet_api.errors import ApiError


def _backend(handler):
    return BackboardBackend("bb-secret", "gpt-4o", client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_sends_stateless_json_request_with_image():
    seen = {}

    def handler(req: httpx.Request):
        seen["url"] = str(req.url)
        seen["key"] = req.headers["x-api-key"]
        seen["body"] = req.content
        return httpx.Response(200, json={"content": "{}"})

    out = _backend(handler).complete_json("sys", "hi", (b"\x89PNG", "image/png"))
    assert out == "{}"
    assert seen["url"] == "https://app.backboard.io/api/threads/messages"
    assert seen["key"] == "bb-secret"
    for needle in (b'name="json_output"', b'name="files"', b"gpt-4o", b"image/png", b"sys"):
        assert needle in seen["body"]


@pytest.mark.parametrize("mime,ext", [("image/png", b'filename="image.png"'), ("image/jpeg", b'filename="image.jpg"'), ("image/webp", b'filename="image.webp"')])
def test_image_upload_filename_has_an_extension_backboard_accepts(mime, ext):
    seen = {}

    def handler(req: httpx.Request):
        seen["body"] = req.content
        return httpx.Response(200, json={"content": "{}"})

    _backend(handler).complete_json("s", "u", (b"data", mime))
    assert ext in seen["body"]


def test_failed_run_with_http_200_is_an_error_not_model_output():
    reply = {"content": "Add credits or start a subscription", "status": "FAILED"}
    b = _backend(lambda r: httpx.Response(200, json=reply))
    with pytest.raises(ApiError) as e:
        b.complete_json("s", "u", None)
    assert e.value.code == "PROVIDER_ERROR" and "credits" not in e.value.message


def test_completed_run_content_is_returned():
    b = _backend(lambda r: httpx.Response(200, json={"content": '{"a": 1}', "status": "COMPLETED"}))
    assert b.complete_json("s", "u", None) == '{"a": 1}'


@pytest.mark.parametrize("status,code", [(401, "PROVIDER_AUTH"), (429, "PROVIDER_QUOTA"), (500, "PROVIDER_UNAVAILABLE"), (400, "PROVIDER_ERROR")])
def test_status_errors_do_not_leak(status, code):
    b = _backend(lambda r: httpx.Response(status, text="bb-secret details"))
    with pytest.raises(ApiError) as e:
        b.complete_json("s", "u", None)
    assert e.value.code == code and "bb-secret" not in str(e.value.message)


def test_build_requires_model_and_key(monkeypatch):
    with pytest.raises(ValueError, match="RIVET_VISION_MODEL"):
        build_vision_port(Settings(vision_provider="backboard"))
    monkeypatch.delenv("BACKBOARD_API_KEY", raising=False)
    with pytest.raises(ValueError, match="BACKBOARD_API_KEY"):
        build_vision_port(Settings(vision_provider="backboard", vision_model="m"))
    monkeypatch.setenv("BACKBOARD_API_KEY", "k")
    port = build_vision_port(Settings(vision_provider="backboard", vision_model="m"))
    assert isinstance(port, LiveVisionProvider) and "k'" not in repr(port.backend)
