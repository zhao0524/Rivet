"""End-to-end v2 generation through the HTTP API with the real compiler, checks, renderer
and store (offline author in fixture mode; live-mode behaviour with injected providers)."""
import io
import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

pytest.importorskip("manifold3d", reason="v2 needs the engine geometry extra")
pytest.importorskip("OCP", reason="v2 needs the engine geometry extra")

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from rivet_api.config import Settings  # noqa: E402
from rivet_api.design.providers import CallLedger  # noqa: E402
from rivet_api.design.setup import build_design_services  # noqa: E402
from rivet_api.errors import ApiError  # noqa: E402
from rivet_api.main import create_app  # noqa: E402
from rivet_engine import get_catalog  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    return create_app(Settings(mode="fixture", data_root=tmp_path_factory.mktemp("v2")))


def client_for(app) -> TestClient:
    c = TestClient(app)
    assert c.get("/api/v2/session").status_code == 200
    return c


def wait(c: TestClient, job_id: str, timeout: float = 240) -> dict:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        job = c.get(f"/api/v2/generations/{job_id}").json()
        if job["status"] in ("complete", "failed", "cancelled", "budget_exhausted"):
            return job
        time.sleep(0.2)
    raise AssertionError(f"job {job_id} did not finish")


def events(c: TestClient, job_id: str) -> list[dict]:
    text = c.get(f"/api/v2/generations/{job_id}/events").text
    return [json.loads(line[5:]) for line in text.splitlines() if line.startswith("data:")]


def generate(c: TestClient, text: str, **kw) -> tuple[dict, dict]:
    body = {"input": {"user_text": text, "image_asset_id": kw.pop("image", None)}, "mode": kw.pop("mode", "concept_only"), **kw}
    r = c.post("/api/v2/generations", json=body)
    assert r.status_code == 202, r.text
    job = wait(c, r.json()["job_id"])
    return r.json(), job


def png(draw) -> bytes:
    img = Image.new("RGB", (400, 300), (240, 240, 240))
    draw(ImageDraw.Draw(img))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def rover(app):
    c = client_for(app)
    started, job = generate(c, "a small orange rover that avoids obstacles", mode="engineered")
    assert job["status"] == "complete", job
    bundle = c.get(f"/api/v2/projects/{job['build_id']}/design").json()
    return c, started, job, bundle


def test_full_quality_run_streams_every_stage_and_real_geometry(rover):
    c, started, job, bundle = rover
    evs = events(c, job["job_id"])
    stages = [e["stage"] for e in evs]
    for stage in ("intake", "distilled", "concept_ready", "candidate_started", "body_ready", "geometry_preview", "mechanical_report", "engineering_report",
                  "render_ready", "visual_review", "candidate_complete", "choice_requested", "revision_ready", "export_ready", "complete"):
        assert stage in stages, stage
    assert [e["event_id"] for e in evs] == list(range(1, len(evs) + 1))
    previews = [e for e in evs if e["stage"] == "geometry_preview" and e["candidate_id"] == "cand-1"]
    assert len(previews) >= 2 and previews[0]["is_partial"] and not previews[-1]["is_partial"]
    glb = c.get(previews[0]["snapshot"]["scene_asset_url"]).content
    assert glb[:4] == b"glTF"
    assert all(not e["references"] or e["references"][0]["url"].startswith("/api/v2/assets/") for e in evs)


def test_three_distinct_candidates_with_six_renders_and_bound_critique(rover):
    c, _, _, bundle = rover
    done = [x for x in bundle["candidates"] if x["status"] == "complete"]
    assert len(done) == 3
    assert len({x["geometry_digest"] for x in done}) == 3 and len({x["spec_digest"] for x in done}) == 3
    assert {x["strategy"] for x in done} == {"closest_to_reference", "simpler_manufacture", "signature_geometry"}
    for x in done:
        assert [s["view"] for s in x["shots"]] == ["front", "left", "back", "right", "top", "perspective"]
        assert c.get(x["shots"][0]["image_url"]).content[:8] == b"\x89PNG\r\n\x1a\n"
        ids = {p["body_id"] for p in x["part_manifest"]}
        assert x["visual"]["subjective"] is True and all(i["body_id"] in ids or i["body_id"] is None for i in x["visual"]["issues"])
        assert set(x["claims"]) >= {"visual_similarity", "geometric_validity", "manufacturability", "electrical", "firmware", "buildability"}


def test_engineered_rover_is_honest_about_buildability(rover):
    _, _, _, bundle = rover
    chosen = next(x for x in bundle["candidates"] if x["id"] == bundle["selected_candidate_id"])
    assert bundle["status"] == "needs_review" and bundle["provenance"]["generation_mode"] == "fixture"
    assert chosen["claims"]["buildability"] == "needs_review" and chosen["functional"]["profile"] == "rover_2wd_differential"
    kinds = {p["kind"] for p in chosen["part_manifest"]}
    assert {"purchased", "fabricated"} <= kinds
    sensor = next(p for p in chosen["part_manifest"] if p["catalog_id"] == "sensor.adafruit_vl53l0x_3317")
    assert sensor["catalog"]["recipe"] == "tof_breakout" and sensor["catalog"]["mesh_source_verified"] is False
    assert bundle["recommendation"]["candidate_id"] == chosen["id"]


def test_exports_are_real_or_refused_with_a_reason(rover):
    c, _, job, bundle = rover
    b = job["build_id"]
    assert c.get(f"/api/v2/projects/{b}/export", params={"kind": "glb"}).content[:4] == b"glTF"
    chosen = next(x for x in bundle["candidates"] if x["id"] == bundle["selected_candidate_id"])
    fab = next(p["body_id"] for p in chosen["part_manifest"] if p["kind"] == "fabricated" and p["representation"] == "brep")
    step = c.get(f"/api/v2/projects/{b}/export", params={"kind": "step", "body_id": fab})
    assert step.status_code == 200 and b"ISO-10303-21" in step.content[:200]
    assert c.get(f"/api/v2/projects/{b}/export", params={"kind": "stl", "body_id": fab}).status_code == 200
    purchased = next(p["body_id"] for p in chosen["part_manifest"] if p["kind"] == "purchased")
    refused = c.get(f"/api/v2/projects/{b}/export", params={"kind": "step", "body_id": purchased})
    assert refused.status_code == 422
    assert "purchased" in json.dumps(c.get(f"/api/v2/projects/{b}/export", params={"kind": "bom"}).json())
    fw = c.get(f"/api/v2/projects/{b}/export", params={"kind": "firmware"})
    assert fw.status_code == 200 and fw.content[:2] == b"PK"


def test_replay_is_byte_identical_and_labelled_cached(rover, app):
    c, started, job, bundle = rover
    again = c.post("/api/v2/generations", json={"input": {"user_text": "a small orange rover that avoids obstacles", "image_asset_id": None}, "mode": "engineered", "allow_cached": True})
    assert again.json()["cached"] is True
    replay_job = wait(c, again.json()["job_id"])
    replayed = c.get(f"/api/v2/projects/{replay_job['build_id']}/design").json()
    assert replayed["provenance"]["cached"] is True and replayed["provenance"]["replay_of"] == f"{job['build_id']}@1"
    assert [x.get("geometry_digest") for x in replayed["candidates"]] == [x.get("geometry_digest") for x in bundle["candidates"]]
    assert replayed["budget"]["spent_usd"] == 0
    assert all(e["message"].startswith("replay:") for e in events(c, replay_job["job_id"]) if e["stage"] not in ("complete",))


def test_sessions_are_isolated(rover, app):
    _, _, job, bundle = rover
    other = client_for(app)
    assert other.get(f"/api/v2/projects/{job['build_id']}/design").status_code == 404
    assert other.get(bundle["scene_asset_url"]).status_code == 404
    assert other.get(f"/api/v2/generations/{job['job_id']}").status_code == 404
    assert TestClient(app).get(f"/api/v2/projects/{job['build_id']}/design").status_code == 401


def test_wider_chassis_edit_is_a_targeted_immutable_revision(rover):
    c, _, job, bundle = rover
    r = c.post(f"/api/v2/projects/{job['build_id']}/revise", json={"base_revision": bundle["revision"], "instruction": "make the chassis wider"})
    assert r.status_code == 202, r.text
    done = wait(c, r.json()["job_id"])
    assert done["status"] == "complete" and done["revision"] == bundle["revision"] + 1
    new = c.get(f"/api/v2/projects/{job['build_id']}/design").json()
    assert new["parent_revision"] == bundle["revision"] and "deck" in new["change"]["changed_bodies"]["changed"]
    old_c = next(x for x in bundle["candidates"] if x["id"] == bundle["selected_candidate_id"])
    new_c = next(x for x in new["candidates"] if x["id"] == new["selected_candidate_id"])
    old_d = {p["body_id"]: p["geometry_digest"] for p in old_c["part_manifest"]}
    new_d = {p["body_id"]: p["geometry_digest"] for p in new_c["part_manifest"]}
    assert old_d["deck"] != new_d["deck"] and old_d["controller"] == new_d["controller"]
    assert new_c["mechanical"]["bounds_mm"]["size"][0] > old_c["mechanical"]["bounds_mm"]["size"][0]
    assert c.get(f"/api/v2/projects/{job['build_id']}/design", params={"revision": bundle["revision"]}).json() == bundle  # immutable


def test_select_another_candidate_then_undo(rover):
    c, _, job, _ = rover
    latest = c.get(f"/api/v2/projects/{job['build_id']}/design").json()
    other = next(x for x in latest["candidates"] if x["id"] != latest["selected_candidate_id"] and x["status"] == "complete")
    wrong = c.post(f"/api/v2/projects/{job['build_id']}/select", json={"job_id": "gen-elsewhere", "base_revision": latest["revision"], "candidate_id": other["id"]})
    assert wrong.status_code == 409
    sel = c.post(f"/api/v2/projects/{job['build_id']}/select", json={"job_id": latest["job_id"], "base_revision": latest["revision"], "candidate_id": other["id"]}).json()
    assert sel["selected_candidate_id"] == other["id"] and sel["revision"] == latest["revision"] + 1
    undo = c.post(f"/api/v2/projects/{job['build_id']}/restore", json={"base_revision": sel["revision"], "target_revision": latest["revision"]}).json()
    assert undo["selected_candidate_id"] == latest["selected_candidate_id"] and undo["change"]["restored_from"] == latest["revision"]


def test_different_reference_images_produce_different_geometry(app):
    c = client_for(app)
    ids = []
    for drawing in (lambda d: d.rectangle([20, 120, 380, 200], fill=(230, 120, 30)), lambda d: d.rectangle([150, 40, 250, 260], fill=(40, 90, 210))):
        up = c.post("/api/v2/assets/images", files={"file": ("ref.png", png(drawing), "image/png")})
        assert up.status_code == 200, up.text
        ids.append(up.json()["asset_id"])
    digests = []
    for aid in ids:
        _, job = generate(c, "rover", image=aid, quality="draft", candidate_count=1, review_rounds=0)
        bundle = c.get(f"/api/v2/projects/{job['build_id']}/design").json()
        assert bundle["references"][0]["source"] == "upload" and bundle["references"][0]["provenance"]["sha256"] == aid[6:]
        digests.append(bundle["candidates"][0]["geometry_digest"])
    assert digests[0] != digests[1]


def test_four_wheel_engineered_request_keeps_four_wheels_and_says_unsupported(app):
    c = client_for(app)
    _, job = generate(c, "four-wheel rover", mode="engineered", quality="draft", candidate_count=1, review_rounds=0)
    bundle = c.get(f"/api/v2/projects/{job['build_id']}/design").json()
    cand = bundle["candidates"][0]
    assert sum(1 for p in cand["part_manifest"] if p["role"] == "wheel" and p["status"] == "placed") == 4
    assert cand["claims"]["buildability"] == "unsupported" and bundle["status"] == "unbuildable"
    assert any(f["rule_id"] == "engineering.motor_channels" for f in cand["functional"]["findings"])


def test_organic_concept_is_new_geometry_labelled_concept_only(app):
    c = client_for(app)
    _, job = generate(c, "hummingbird", quality="draft", candidate_count=1, review_rounds=0)
    bundle = c.get(f"/api/v2/projects/{job['build_id']}/design").json()
    cand = bundle["candidates"][0]
    assert cand["claims"]["buildability"] == "concept_only" and not any(p["kind"] == "purchased" for p in cand["part_manifest"])
    assert any(p["representation"] == "mesh" for p in cand["part_manifest"])  # implicit-surface body
    assert c.get(f"/api/v2/projects/{job['build_id']}/export", params={"kind": "firmware"}).status_code == 422


def test_cancel_stops_a_running_job(app):
    c = client_for(app)
    r = c.post("/api/v2/generations", json={"input": {"user_text": "red house with chimney", "image_asset_id": None}})
    assert c.post(f"/api/v2/generations/{r.json()['job_id']}/cancel").json()["cancelled"] is True
    job = wait(c, r.json()["job_id"])
    assert job["status"] == "cancelled" and events(c, job["job_id"])[-1]["stage"] == "cancelled"


class FailingLive:
    mode, name = "live", "test:failing"

    def distill(self, *a):
        raise ApiError("PROVIDER_UNAVAILABLE", "The vision provider could not be reached", 503, retryable=True)


def test_live_provider_failure_is_visible_and_never_replaced_by_a_fixture(tmp_path):
    factory = lambda ledger: (FailingLive(), None)  # noqa: E731
    factory.mode, factory.names = "live", {"design": "test:failing"}
    settings = Settings(mode="fixture", data_root=tmp_path)
    app = create_app(settings, design=build_design_services(settings, get_catalog(), provider_factory=factory))
    c = client_for(app)
    r = c.post("/api/v2/generations", json={"input": {"user_text": "a rover", "image_asset_id": None}})
    job = wait(c, r.json()["job_id"])
    assert job["status"] == "failed" and job["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert events(c, job["job_id"])[-1]["stage"] == "failed"
    assert c.get(f"/api/v2/projects/{job['build_id']}/design").status_code == 404


def test_v2_contract_schemas_are_in_sync():
    assert subprocess.run([sys.executable, str(ROOT / "scripts" / "export_design_schemas.py"), "--check"], capture_output=True).returncode == 0


def test_ledger_counts_spend():
    ledger = CallLedger()
    ledger.record("image", "m", 0.08)
    assert ledger.spent == 0.08
