"""Opt-in live check that the vision model reads the picture, not just the prompt.

Two original drawings, made here with Pillow (nothing is downloaded or committed), go through
the API exactly like a user's upload: POST /api/assets/images, then POST /api/projects/generate
with `kind: "image"` and no text, so the text sent to the model is identical for both and only
the picture differs. With the real `openai` provider (LiveVisionProvider + OpenAIBackend, built
by the server's own `build_vision_port`) the 2WD rover must come back as `rover` and its job
completes; the quadcopter must come back as `drone` and its job fails with the 422 error
UNSUPPORTED_PROJECT_FAMILY, `details.detected_family == "drone"`. The engine side runs in
fixture mode: only the vision step is under test.

Skipped unless RIVET_LIVE_VISION_TEST=1, OPENAI_API_KEY is set and the openai package is
installed (`pip install -e '.[live]'`). Each run makes at least two paid model calls (more if
a reply needs the parser's one retry). Model: RIVET_VISION_MODEL, default gpt-4o.

    RIVET_LIVE_VISION_TEST=1 python -m pytest -q tests/test_live_vision_provider.py -rs

Draw the two pictures for the manual check in README.md:

    python tests/test_live_vision_provider.py /tmp/rivet-vision-check
"""

import importlib.util
import io
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from rivet_api.adapters.vision_provider import OpenAIBackend
from rivet_api.agents.vision import LiveVisionProvider, build_vision_port
from rivet_api.assets.store import AssetStore
from rivet_api.config import Settings
from rivet_api.main import create_app
from rivet_api.models.intent import IntentSpec

MODEL = os.environ.get("RIVET_VISION_MODEL") or "gpt-4o"
JOB_TIMEOUT_S = 240.0
W, H = 1024, 768


def _missing_for_live_run() -> list[str]:
    missing = []
    if os.environ.get("RIVET_LIVE_VISION_TEST", "").strip().lower() not in {"1", "true", "yes", "on"}:
        missing.append("RIVET_LIVE_VISION_TEST=1")
    if not os.environ.get("OPENAI_API_KEY"):
        missing.append("OPENAI_API_KEY")
    if importlib.util.find_spec("openai") is None:
        missing.append("the openai package (pip install -e '.[live]')")
    return missing


MISSING = _missing_for_live_run()
live = pytest.mark.skipif(
    bool(MISSING), reason="opt-in live OpenAI vision check (paid API calls); needs " + ", ".join(MISSING)
)


# ---- the two pictures: original drawings, deterministic, no text in them ----------------


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def rover_png() -> bytes:
    """Top-down 2WD rover, front up: chassis plate, two drive wheels, rear caster, front sensor."""
    img = Image.new("RGB", (W, H), "#f1f3f5")
    d = ImageDraw.Draw(img)
    cx, cy = W // 2, H // 2 + 20
    d.rounded_rectangle((cx - 170, cy - 220, cx + 170, cy + 220), radius=36, fill="#c9ced6", outline="#6b7280", width=4)
    for hx in (cx - 140, cx + 140):  # mounting holes
        for hy in range(cy - 190, cy + 200, 76):
            d.ellipse((hx - 7, hy - 7, hx + 7, hy + 7), fill="#8a919c")
    for x0 in (cx - 240, cx + 176):  # the two drive wheels, one on each side
        d.rounded_rectangle((x0, cy - 105, x0 + 64, cy + 65), radius=14, fill="#1f2328")
        for ty in range(cy - 95, cy + 60, 15):
            d.line((x0 + 6, ty, x0 + 58, ty), fill="#3d434c", width=5)
    d.ellipse((cx - 30, cy + 150, cx + 30, cy + 210), fill="#5b6270", outline="#2f343c", width=3)  # rear caster
    d.ellipse((cx - 12, cy + 168, cx + 12, cy + 192), fill="#d6dae0")
    d.rectangle((cx - 95, cy - 262, cx + 95, cy - 214), fill="#2463b4", outline="#163d73", width=3)  # front sensor
    for ex in (cx - 50, cx + 50):
        d.ellipse((ex - 32, cy - 282, ex + 32, cy - 218), fill="#d4d8de", outline="#6b7280", width=4)
        d.ellipse((ex - 18, cy - 268, ex + 18, cy - 232), fill="#3f4650")
    d.rounded_rectangle((cx - 85, cy - 170, cx + 85, cy - 50), radius=8, fill="#1f7a4d", outline="#124a2f", width=3)
    for px in range(cx - 75, cx + 76, 12):  # controller board header pins
        d.rectangle((px, cy - 164, px + 6, cy - 158), fill="#e3c76b")
        d.rectangle((px, cy - 62, px + 6, cy - 56), fill="#e3c76b")
    d.rectangle((cx - 28, cy - 132, cx + 28, cy - 88), fill="#1a1d21")
    d.rounded_rectangle((cx - 90, cy - 10, cx + 90, cy + 120), radius=8, fill="#26292e")  # 4xAA battery holder
    for i in range(4):
        x0 = cx - 80 + i * 40
        d.rectangle((x0, cy + 2, x0 + 32, cy + 108), fill="#c7ccd3")
        d.rectangle((x0, cy + 2, x0 + 32, cy + 20), fill="#b87333")
    for x, color in ((cx - 60, "#d62828"), (cx - 40, "#111111")):  # battery leads
        d.line((x, cy - 10, x, cy - 50), fill=color, width=5)
    for x, color in ((cx - 20, "#f4a261"), (cx + 20, "#2a9d8f")):  # sensor wires
        d.line((x, cy - 170, x, cy - 214), fill=color, width=4)
    return _png(img)


def drone_png() -> bytes:
    """Top-down X quadcopter: central body, four arms, four motors with two-blade propellers."""
    img = Image.new("RGB", (W, H), "#f1f3f5")
    d = ImageDraw.Draw(img)
    cx, cy = W // 2, H // 2
    rotors = [(cx - 220, cy - 220), (cx + 220, cy - 220), (cx - 220, cy + 220), (cx + 220, cy + 220)]
    for mx, my in rotors:  # rotor discs
        d.ellipse((mx - 140, my - 140, mx + 140, my + 140), fill="#e2e6eb", outline="#a3abb6", width=3)
    for mx, my in rotors:  # arms
        d.line((cx, cy, mx, my), fill="#2b2f36", width=30)
    for i, (mx, my) in enumerate(rotors):  # propellers and motors
        if i in (0, 3):
            d.ellipse((mx - 130, my - 12, mx + 130, my + 12), fill="#20242a")
        else:
            d.ellipse((mx - 12, my - 130, mx + 12, my + 130), fill="#20242a")
        d.ellipse((mx - 34, my - 34, mx + 34, my + 34), fill="#4b5563", outline="#15181c", width=4)
        d.ellipse((mx - 10, my - 10, mx + 10, my + 10), fill="#c0c6ce")
    d.rounded_rectangle((cx - 85, cy - 85, cx + 85, cy + 85), radius=28, fill="#3a404a", outline="#15181c", width=4)
    d.ellipse((cx - 36, cy - 36, cx + 36, cy + 36), fill="#d9dde3", outline="#7c8591", width=3)  # GPS puck
    d.rounded_rectangle((cx - 26, cy - 125, cx + 26, cy - 85), radius=8, fill="#15181c")  # front camera
    d.ellipse((cx - 13, cy - 118, cx + 13, cy - 92), fill="#4a6fa5")
    return _png(img)


def test_check_pictures_are_deterministic_distinct_and_pass_upload_validation(tmp_path):
    """Offline: keeps the live check's inputs valid in CI, where the live tests are skipped."""
    rover, drone = rover_png(), drone_png()
    assert rover == rover_png() and drone == drone_png()
    assert rover != drone
    store = AssetStore(tmp_path)
    for png in (rover, drone):
        record = store.save(png, "live-vision-check")
        data, mime = store.read_bytes(record.asset_id)
        assert mime == "image/png" and Image.open(io.BytesIO(data)).size == (W, H)


# ---- live run ----------------------------------------------------------------------------


class _Recorder:
    """Pass-through around the real provider; keeps what the model returned per uploaded asset."""

    def __init__(self, inner: LiveVisionProvider):
        self.inner = inner
        self.mode = inner.mode
        self.intents: dict[str | None, IntentSpec] = {}

    def interpret(self, request, image):
        intent = self.inner.interpret(request, image)
        self.intents[request.input.image_asset_id] = intent
        return intent


@pytest.fixture(scope="module")
def run_picture(tmp_path_factory):
    settings = Settings(
        mode="fixture",
        data_root=tmp_path_factory.mktemp("live-vision"),
        vision_provider="openai",
        vision_model=MODEL,
    )
    provider = build_vision_port(settings)  # the server's own factory: a real OpenAI client
    assert isinstance(provider, LiveVisionProvider) and isinstance(provider.backend, OpenAIBackend)
    recorder = _Recorder(provider)
    client = TestClient(create_app(settings, vision=recorder))

    def run(png: bytes) -> tuple[dict, IntentSpec | None]:
        upload = client.post("/api/assets/images", files={"file": ("picture.png", png, "image/png")})
        assert upload.status_code == 200, upload.text
        asset_id = upload.json()["asset_id"]
        resp = client.post("/api/projects/generate", json={"input": {"kind": "image", "image_asset_id": asset_id}})
        assert resp.status_code == 202, resp.text
        job_id = resp.json()["job_id"]
        deadline = time.monotonic() + JOB_TIMEOUT_S
        while time.monotonic() < deadline:
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["status"] in ("complete", "failed"):
                return job, recorder.intents.get(asset_id)
            time.sleep(0.25)
        raise AssertionError(f"job {job_id} did not finish within {JOB_TIMEOUT_S:.0f}s: {job}")

    return run


@live
def test_live_model_reads_the_rover_picture_as_a_rover(run_picture):
    job, intent = run_picture(rover_png())
    assert intent is not None and intent.project_family == "rover", (job, intent)
    assert job["status"] == "complete", job


@live
def test_live_model_reads_the_drone_picture_as_a_drone(run_picture):
    job, intent = run_picture(drone_png())
    assert intent is not None and intent.project_family == "drone", (job, intent)
    assert job["status"] == "failed", job
    assert job["error"]["code"] == "UNSUPPORTED_PROJECT_FAMILY", job
    assert job["error"]["details"]["detected_family"] == "drone", job


if __name__ == "__main__":  # draw the two pictures for the manual check in README.md
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    for name, png in (("rover-2wd.png", rover_png()), ("drone-quadcopter.png", drone_png())):
        (out / name).write_bytes(png)
        print(out / name)
