"""Hand-built concept models for the demo photos (rivet_api/concept/demo)."""

import hashlib
import io

import pytest
from PIL import Image

from rivet_api.agents.vision import MockVisionProvider
from rivet_api.concept import build_concept_plan
from rivet_api.concept import demo as demo_pkg
from rivet_api.concept.demo import demo_concept, demo_keys, match_upload, normalise_name
from rivet_api.concept.model import MAX_PARTS, floating_parts
from rivet_api.errors import ApiError
from rivet_api.orchestration.pipeline import DEMO_MODEL_NOTE, check_concept_plan

DEMO_FILES = {
    "drone.jpg": "drone",
    "MINI-GIZMOFPV_black.jpg": "fpv_car",
    "RC car.jpeg": "rc_truck",
    "boat.jpeg": "boat",
    "mechanical arm.jpeg": "arm",
    "robot dog.jpeg": "robot_dog",
    "raspberry pi camera.jpeg": "pi_camera",
    "Microconstroller.jpeg": "esp32",
}


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), (40, 120, 200)).save(buf, "PNG")
    return buf.getvalue()


def _upload(client, filename: str) -> str:
    resp = client.post("/api/assets/images", files={"file": (filename, _png(), "image/png")})
    assert resp.status_code == 200, resp.text
    return resp.json()["asset_id"]


def _generate(client, wait_job, asset_id: str, choice: str = "as_interpreted") -> dict:
    body = {"input": {"kind": "image", "image_asset_id": asset_id}, "interpretation_choice": choice}
    resp = client.post("/api/projects/generate", json=body)
    assert resp.status_code == 202, resp.text
    return wait_job(client, resp.json()["job_id"])


@pytest.mark.parametrize("key", demo_keys())
def test_every_demo_model_is_a_detailed_consistent_concept_plan(key):
    concept = demo_concept(key)  # building also checks no hand-placed internal part overlaps another
    assert len(concept.parts) >= 50
    assert concept.confidence == "high" and concept.title and concept.summary
    assert len({p.name for p in concept.parts}) == len(concept.parts)
    plan = build_concept_plan(concept, "intent-demo", "image", "manual_template")
    check_concept_plan(plan)
    assert plan["status"] == "needs_review" and plan["provenance"]["generation_mode"] == "manual_template"
    assert not floating_parts(concept, gap_mm=1.0), floating_parts(concept, gap_mm=1.0)


def test_demo_wires_all_resolve_to_named_parts():
    for key in demo_keys():
        module = __import__(f"rivet_api.concept.demo.{key}", fromlist=["build"])
        raw_wires = len(module.build().wires)
        assert len(demo_concept(key).wires) == raw_wires, key


def test_demo_concept_hands_out_copies():
    first = demo_concept("drone")
    first.parts[0].color = "#ffffff"
    assert demo_concept("drone").parts[0].color != "#ffffff"


@pytest.mark.parametrize("filename,key", sorted(DEMO_FILES.items()))
def test_demo_photos_are_recognised_by_file_name(filename, key):
    assert match_upload(filename, b"not the original bytes") == key


@pytest.mark.parametrize(
    "filename,key",
    [
        ("robot_dog (1).jpeg", "robot_dog"),
        ("C:\\Users\\me\\Downloads\\RC-car.PNG", "rc_truck"),
        ("mini gizmofpv black copy.jpg", "fpv_car"),
        ("microcontroller.webp", "esp32"),
        ("cat.jpg", None),
        ("dronefly.jpg", None),
        ("", None),
        (None, None),
    ],
)
def test_file_name_matching_tolerates_copies_case_and_separators(filename, key):
    assert match_upload(filename, b"x") == key


def test_demo_photos_are_recognised_by_their_bytes_under_any_name(monkeypatch):
    data = b"exact demo photo bytes"
    entry = demo_pkg.DemoEntry("boat", ("boat",), hashlib.sha256(data).hexdigest())
    monkeypatch.setattr(demo_pkg, "_ENTRIES", (entry,))
    assert match_upload("IMG_0042.jpg", data) == "boat"
    assert match_upload("IMG_0042.jpg", data + b"!") is None


def test_normalise_name():
    assert normalise_name("/tmp/MINI-GIZMOFPV_black.jpg") == "mini gizmofpv black"
    assert normalise_name("raspberry  pi camera (2).jpeg") == "raspberry pi camera"


def test_upload_of_a_demo_photo_builds_its_hand_built_model(make_client, wait_job):
    client, app = make_client()
    asset_id = _upload(client, "robot dog.jpeg")
    assert app.state.deps.assets.demo_key(asset_id) == "robot_dog"
    job = _generate(client, wait_job, asset_id)
    assert job["status"] == "complete", job
    plan = client.get(f"/api/projects/{job['build_id']}").json()
    assert plan["concept"]["demo"] == "robot_dog"
    assert plan["provenance"]["generation_mode"] == "manual_template" and DEMO_MODEL_NOTE in plan["provenance"]["notes"]
    expected = demo_concept("robot_dog")
    assert len(plan["components"]) == len(expected.parts) + len(expected.wires)
    events = client.get(f"/api/jobs/{job['job_id']}").json()
    assert "complete" in str(events)


@pytest.mark.parametrize("choice", ["as_interpreted", "concept_model"])
def test_a_demo_photo_wins_over_the_clarify_choice_and_skips_vision(make_client, wait_job, choice):
    class NoVision(MockVisionProvider):
        def interpret(self, *a, **k):
            raise AssertionError("the vision model must not be asked for a demo photo")

        concept = interpret

    client, _ = make_client(vision=NoVision())
    job = _generate(client, wait_job, _upload(client, "RC car.jpeg"), choice)
    assert job["status"] == "complete", job
    assert client.get(f"/api/projects/{job['build_id']}").json()["concept"]["demo"] == "rc_truck"


def test_demo_jobs_plan_the_concept_stages(make_client):
    client, _ = make_client()
    body = {"input": {"kind": "image", "image_asset_id": _upload(client, "boat.jpeg")}}
    job = client.post("/api/projects/generate", json=body).json()
    stages = client.get(f"/api/jobs/{job['job_id']}").json().get("planned_stages")
    assert stages in (None, ["upload", "understand", "assembly", "validate", "complete"])


def test_other_uploads_are_not_tagged(make_client):
    client, app = make_client()
    asset_id = _upload(client, "my robot.png")
    assert app.state.deps.assets.demo_key(asset_id) is None
    assert app.state.deps.assets.demo_key("not-an-asset") is None


def test_recolor_of_a_demo_model_is_applied_without_the_vision_model(make_client, wait_job):
    class NoEdit(MockVisionProvider):
        def edit_concept(self, concept, instruction):
            raise ApiError("CONCEPT_PARSE_FAILED", "must not be called for a recolor", 502)

    client, _ = make_client(vision=NoEdit())
    job = _generate(client, wait_job, _upload(client, "drone.jpg"))
    build_id = job["build_id"]
    resp = client.post(f"/api/projects/{build_id}/edits", json={"base_revision": 1, "instruction": "make the body blue"})
    assert resp.status_code == 200 and resp.json()["accepted"] is True, resp.text
    plan = client.get(f"/api/projects/{build_id}").json()
    assert plan["concept"]["demo"] == "drone" and len(plan["components"]) > MAX_PARTS
    body_colors = {c["render_overrides"]["color"] for c in plan["components"] if c["role"] == "body"}
    assert body_colors == {"#2563eb"}
    assert any(c["render_overrides"]["color"] != "#2563eb" for c in plan["components"] if c["role"] == "propeller")
