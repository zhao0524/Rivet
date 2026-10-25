"""Issue #66: show what was understood, and recover from unsupported results.

The support gate's 422 carries the interpretation; `POST /api/intents/interpret` returns it
without running the engine; a build can reuse it by `intent_id`; and the closest supported
rover is built only on the user's explicit, recorded choice.
"""

import json
from pathlib import Path

import pytest

from rivet_api.agents.vision import LiveVisionProvider, MockVisionProvider, ensure_supported
from rivet_api.errors import ApiError
from rivet_api.models.intent import IntentSpec
from rivet_api.models.requests import GenerateRequest
from rivet_api.orchestration.interpretation import CLOSEST_ROVER_NOTE, IntentStore

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
ROVER = {"input": {"kind": "text", "user_text": "Build a small rover that avoids obstacles"}}
DRONE = {"input": {"kind": "text", "user_text": "Design a racing drone that flies"}}
ASSET = "asset-" + "b" * 32
INTERPRETATION_KEYS = {
    "intent_id",
    "project_family",
    "requested_behavior",
    "support_status",
    "confidence",
    "visual_features",
    "assumptions",
    "unknowns",
    "vision_mode",
}
MODEL_REPLY = {
    "project_family": "rover",
    "requested_behavior": "obstacle_avoidance",
    "visual_features": ["two drive wheels", "flat deck"],
    "requirements": {"required_capabilities": ["differential_drive"]},
    "assumptions": ["Wheel size is a guess"],
    "unknowns": ["Motor type"],
    "confidence": "medium",
    "support_status": "supported",
}


class FakeBackend:
    def __init__(self, reply: dict):
        self.reply = reply
        self.calls = 0

    def complete_json(self, system, user_text, image):
        self.calls += 1
        return json.dumps(self.reply)


def live_vision(**overrides) -> tuple[LiveVisionProvider, FakeBackend]:
    backend = FakeBackend({**MODEL_REPLY, **overrides})
    return LiveVisionProvider(backend, model="test-model"), backend


class CountingVision:
    """The offline mock, counting calls (vision must not run twice for one interpretation)."""

    mode = "fixture"

    def __init__(self):
        self.calls = 0

    def interpret(self, request, image):
        self.calls += 1
        return MockVisionProvider().interpret(request, image)


def events(client, job_id: str) -> list[dict]:
    with client.stream("GET", f"/api/jobs/{job_id}/events") as resp:
        text = "".join(resp.iter_text())
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


def interpret(client, body=ROVER) -> dict:
    resp = client.post("/api/intents/interpret", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def build(client, wait_job, body: dict) -> dict:
    resp = client.post("/api/projects/generate", json=body)
    assert resp.status_code == 202, resp.text
    return wait_job(client, resp.json()["job_id"])


def no_projects(tmp_path) -> bool:
    root = tmp_path / "projects"
    return not root.exists() or not list(root.iterdir())


# ---- the support gate's 422 carries the interpretation -------------------------------------


def test_unsupported_family_job_error_carries_the_interpretation(generate, tmp_path):
    client, _, job = generate(DRONE)
    assert job["status"] == "failed"
    error = job["error"]
    assert error["code"] == "UNSUPPORTED_PROJECT_FAMILY" and error["retryable"] is False
    details = error["details"]
    assert details["supported_families"] == ["rover"] and details["detected_family"] == "drone"
    seen = details["interpretation"]
    assert set(seen) == INTERPRETATION_KEYS
    assert seen["project_family"] == "drone" and seen["support_status"] == "unsupported"
    assert seen["confidence"] == "medium" and seen["vision_mode"] == "fixture"
    assert seen["visual_features"] and seen["unknowns"]  # what the card lists
    assert no_projects(tmp_path)
    # the failed event says why, and the engine never ran
    stages = [e["stage"] for e in events(client, job["job_id"])]
    assert stages[-1] == "failed" and "catalog_selection" not in stages


def test_job_error_with_interpretation_still_matches_the_error_schema(generate):
    jsonschema = pytest.importorskip("jsonschema")
    _, _, job = generate(DRONE)
    schema = json.loads((CONTRACTS / "errors.schema.json").read_text())
    jsonschema.validate({"error": job["error"]}, schema)


def test_gate_details_for_a_planned_family_and_an_unsupported_rover_behavior():
    base = MockVisionProvider().interpret(GenerateRequest.model_validate(ROVER), None)
    rc_car = base.model_copy(update={"project_family": "rc_car", "support_status": "planned", "confidence": "high"})
    with pytest.raises(ApiError) as exc:
        ensure_supported(rc_car, "live")
    assert exc.value.status == 422 and "'rc_car'" in exc.value.message
    assert exc.value.details["detected_family"] == "rc_car"
    assert exc.value.details["interpretation"]["confidence"] == "high"
    assert exc.value.details["interpretation"]["vision_mode"] == "live"

    line = base.model_copy(update={"requested_behavior": "line_following", "support_status": "unsupported"})
    with pytest.raises(ApiError) as exc:
        ensure_supported(line, "fixture")
    assert exc.value.code == "UNSUPPORTED_PROJECT_FAMILY"
    assert "line_following" in exc.value.message  # not "rovers are not supported"
    ensure_supported(base)  # a supported rover passes; the mode argument is optional


def test_low_confidence_unsupported_result_reports_low_confidence(generate):
    provider, _ = live_vision(project_family="robot_arm", confidence="low", support_status="supported")
    _, _, job = generate(ROVER, vision=provider)
    seen = job["error"]["details"]["interpretation"]
    assert seen["confidence"] == "low" and seen["project_family"] == "robot_arm"
    assert seen["support_status"] == "unsupported" and seen["vision_mode"] == "live"


# ---- POST /api/intents/interpret ------------------------------------------------------------


def test_interpret_accepted_rover_returns_the_intent_without_running_the_engine(make_client, stub_engine_cls):
    engine = stub_engine_cls()
    client, _ = make_client(engine=engine)
    body = interpret(client)
    assert set(body) == {"intent_id", "intent", "supported", "limitation", "vision_mode"}
    assert body["supported"] is True and body["limitation"] is None
    assert body["vision_mode"] == "fixture"
    intent = IntentSpec.model_validate(body["intent"])
    assert intent.intent_id == body["intent_id"] and intent.project_family == "rover"
    assert intent.input.user_text == ROVER["input"]["user_text"]
    assert engine.solve_calls == [] and engine.edit_calls == []


class _DownLiveVision:
    """A live reader that cannot answer, the way a billing failure comes back."""

    mode = "live"

    def interpret(self, request, image):
        raise ApiError("PROVIDER_ERROR", "The vision provider could not complete the request", 502)


def test_interpret_uses_the_saved_reading_when_the_live_reader_fails(make_client):
    client, _ = make_client(vision=_DownLiveVision())
    body = interpret(client)
    assert body["vision_mode"] == "fallback"
    assert body["supported"] is True and body["intent"]["project_family"] == "rover"


def test_generate_still_finishes_when_the_live_reader_fails(make_client, wait_job):
    client, _ = make_client(vision=_DownLiveVision())
    job = build(client, wait_job, ROVER)
    assert job["status"] == "complete"
    assert job.get("error") is None


def test_interpret_intent_matches_the_intent_schema(make_client):
    jsonschema = pytest.importorskip("jsonschema")
    client, _ = make_client()
    schema = json.loads((CONTRACTS / "intent.schema.json").read_text())
    jsonschema.validate(interpret(client)["intent"], schema)
    jsonschema.validate(interpret(client, DRONE)["intent"], schema)


def test_interpret_unsupported_is_a_200_with_a_limitation_not_an_error(make_client, stub_engine_cls, tmp_path):
    engine = stub_engine_cls()
    client, _ = make_client(engine=engine)
    body = interpret(client, DRONE)
    assert body["supported"] is False
    limitation = body["limitation"]
    assert limitation["code"] == "UNSUPPORTED_PROJECT_FAMILY" and "drone" in limitation["message"]
    assert limitation["details"]["detected_family"] == "drone"
    assert limitation["details"]["interpretation"]["intent_id"] == body["intent_id"]
    assert body["intent"]["support_status"] == "unsupported"
    assert engine.solve_calls == [] and no_projects(tmp_path)


def test_interpret_low_confidence_rover_is_supported_and_says_so(make_client):
    provider, _ = live_vision(confidence="low")
    client, _ = make_client(vision=provider)
    body = interpret(client)
    assert body["supported"] is True and body["vision_mode"] == "live"
    assert body["intent"]["confidence"] == "low"


def test_interpret_applies_the_generate_input_rules(make_client, fake_assets_cls):
    client, _ = make_client()
    for bad in ({"input": {"kind": "text", "user_text": "  "}}, {"input": {"kind": "image"}}, {}):
        resp = client.post("/api/intents/interpret", json=bad)
        assert resp.status_code == 400 and resp.json()["error"]["code"] == "BAD_REQUEST"
    extra = client.post("/api/intents/interpret", json={**ROVER, "intent_id": "intent-x"})
    assert extra.status_code == 400  # interpret takes only input + requirements
    missing = client.post("/api/intents/interpret", json={"input": {"kind": "image", "image_asset_id": ASSET}})
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "ASSET_NOT_FOUND"


def test_interpret_sends_the_image_to_the_vision_port(make_client, fake_assets_cls):
    seen = {}

    class SpyVision:
        mode = "fixture"

        def interpret(self, request, image):
            seen["image"] = image
            return MockVisionProvider().interpret(request, image)

    assets = fake_assets_cls({ASSET: (b"PNGDATA", "image/png")})
    client, _ = make_client(vision=SpyVision(), assets=assets)
    body = interpret(client, {"input": {"kind": "image", "image_asset_id": ASSET}})
    assert seen["image"] == (b"PNGDATA", "image/png")
    assert body["intent"]["input"] == {
        "kind": "image",
        "image_asset_id": ASSET,
        "user_text": None,
        "image_interpretation_is_approximate": True,
    }
    assert "Hidden electronics are not inferable from the image" in body["intent"]["assumptions"]


# ---- generate with intent_id ---------------------------------------------------------------


def test_generate_with_intent_id_builds_that_interpretation_without_a_second_vision_call(
    make_client, wait_job, stub_engine_cls
):
    vision, engine = CountingVision(), stub_engine_cls()
    client, _ = make_client(vision=vision, engine=engine)
    seen = interpret(client)
    job = build(client, wait_job, {**ROVER, "intent_id": seen["intent_id"]})
    assert job["status"] == "complete"
    assert vision.calls == 1
    assert engine.solve_calls[0]["intent_id"] == seen["intent_id"]
    assert engine.solve_calls[0]["visual_features"] == seen["intent"]["visual_features"]
    plan = client.get(f"/api/projects/{job['build_id']}").json()
    assert plan["source_intent_id"] == seen["intent_id"]
    understand = [e for e in events(client, job["job_id"]) if e["stage"] == "understand"]
    assert "confirmed interpretation" in understand[0]["message"] and understand[-1]["status"] == "ok"
    assert all(e["actor"] != "vision" for e in understand)  # vision did not run in this job


def test_low_confidence_rover_builds_once_the_user_confirms(make_client, wait_job):
    provider, backend = live_vision(confidence="low")
    client, _ = make_client(vision=provider)
    seen = interpret(client)
    job = build(client, wait_job, {**ROVER, "intent_id": seen["intent_id"]})
    assert job["status"] == "complete" and backend.calls == 1
    understand_ok = [e for e in events(client, job["job_id"]) if e["stage"] == "understand" and e["status"] == "ok"]
    assert "low confidence" in understand_ok[0]["message"]


def test_requirements_on_the_build_request_apply_to_the_stored_interpretation(make_client, wait_job, stub_engine_cls):
    engine = stub_engine_cls()
    client, _ = make_client(engine=engine)
    seen = interpret(client)
    body = {**ROVER, "intent_id": seen["intent_id"], "requirements": {"max_budget": "80.00", "currency": "USD"}}
    assert build(client, wait_job, body)["status"] == "complete"
    assert engine.solve_calls[0]["requirements"]["max_budget"] == "80.00"


def test_unsupported_interpretation_without_the_choice_fails_exactly_as_before(make_client, wait_job, tmp_path):
    client, _ = make_client()
    seen = interpret(client, DRONE)
    job = build(client, wait_job, {**DRONE, "intent_id": seen["intent_id"]})
    assert job["status"] == "failed" and job["error"]["code"] == "UNSUPPORTED_PROJECT_FAMILY"
    assert job["error"]["details"]["interpretation"]["intent_id"] == seen["intent_id"]
    assert no_projects(tmp_path)


def test_unknown_or_malformed_intent_id_is_rejected_before_a_job_exists(make_client, tmp_path):
    client, _ = make_client()
    resp = client.post("/api/projects/generate", json={**ROVER, "intent_id": "intent-000000000000"})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "INTENT_NOT_FOUND" and resp.json()["error"]["retryable"] is False
    assert not (tmp_path / "jobs").exists() or not list((tmp_path / "jobs").glob("job-*.json"))
    bad = client.post("/api/projects/generate", json={**ROVER, "intent_id": "../../etc/passwd"})
    assert bad.status_code == 400


def test_expired_intent_id_is_404(make_client):
    now = [1000.0]
    client, app = make_client()
    app.state.deps.intents = IntentStore(ttl_s=60, clock=lambda: now[0])
    seen = interpret(client)
    now[0] += 61
    resp = client.post("/api/projects/generate", json={**ROVER, "intent_id": seen["intent_id"]})
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "INTENT_NOT_FOUND"


def test_intent_id_for_a_different_input_is_409(make_client):
    client, _ = make_client()
    seen = interpret(client)
    other = {"input": {"kind": "text", "user_text": "A different rover"}, "intent_id": seen["intent_id"]}
    resp = client.post("/api/projects/generate", json=other)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "INTENT_INPUT_MISMATCH"


def test_intent_store_is_bounded_and_expires():
    now = [0.0]
    store = IntentStore(ttl_s=10, max_items=2, clock=lambda: now[0])
    base = MockVisionProvider().interpret(GenerateRequest.model_validate(ROVER), None)
    ids = [f"intent-{n}" for n in range(3)]
    for intent_id in ids:
        store.put(base.model_copy(update={"intent_id": intent_id}), "fixture")
    with pytest.raises(ApiError) as exc:
        store.get(ids[0])  # oldest dropped when full
    assert exc.value.code == "INTENT_NOT_FOUND" and exc.value.status == 404
    assert store.get(ids[2]).intent.intent_id == ids[2]
    now[0] = 10
    with pytest.raises(ApiError):
        store.get(ids[2])


# ---- the explicit closest-supported-rover choice -------------------------------------------


def test_closest_rover_choice_builds_a_rover_and_records_the_choice(make_client, wait_job, stub_engine_cls):
    engine = stub_engine_cls()
    client, _ = make_client(engine=engine)
    seen = interpret(client, DRONE)
    body = {**DRONE, "intent_id": seen["intent_id"], "interpretation_choice": "closest_supported_rover"}
    job = build(client, wait_job, body)
    assert job["status"] == "complete"

    sent = engine.solve_calls[0]
    assert (sent["project_family"], sent["support_status"], sent["requested_behavior"]) == (
        "rover",
        "supported",
        "obstacle_avoidance",
    )
    assert sent["visual_features"] == seen["intent"]["visual_features"]
    assert sent["unknowns"] == seen["intent"]["unknowns"]
    assert "closest supported rover" in sent["assumptions"][0]
    assert all(a in sent["assumptions"] for a in seen["intent"]["assumptions"])

    note = (
        "User chose to build the closest supported rover; the request was interpreted as drone "
        "(medium confidence, fixture vision); requested behavior unknown replaced by obstacle_avoidance"
    )
    plan = client.get(f"/api/projects/{job['build_id']}").json()
    assert note in plan["provenance"]["notes"]
    choice = [e for e in events(client, job["job_id"]) if e["message"] == note]
    assert len(choice) == 1 and choice[0]["stage"] == "understand" and choice[0]["status"] == "warning"


def test_closest_rover_note_names_the_image_only_for_live_vision(make_client, wait_job, fake_assets_cls):
    provider, _ = live_vision(project_family="rc_car", requested_behavior="manual_drive", confidence="medium")
    assets = fake_assets_cls({ASSET: (b"PNGDATA", "image/png")})
    client, _ = make_client(vision=provider, assets=assets)
    body = {"input": {"kind": "image", "image_asset_id": ASSET}}
    seen = interpret(client, body)
    assert seen["supported"] is False and seen["intent"]["support_status"] == "planned"
    job = build(client, wait_job, {**body, "intent_id": seen["intent_id"], "interpretation_choice": "closest_supported_rover"})
    assert job["status"] == "complete"
    notes = client.get(f"/api/projects/{job['build_id']}").json()["provenance"]["notes"]
    assert (
        "User chose to build the closest supported rover; the image was interpreted as rc_car "
        "(medium confidence, live vision); requested behavior manual_drive replaced by obstacle_avoidance"
    ) in notes


def test_closest_rover_choice_needs_an_interpretation_the_user_saw(make_client):
    client, _ = make_client()
    resp = client.post("/api/projects/generate", json={**DRONE, "interpretation_choice": "closest_supported_rover"})
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "BAD_REQUEST"
    resp = client.post("/api/projects/generate", json={**ROVER, "interpretation_choice": "anything"})
    assert resp.status_code == 400


def test_closest_rover_choice_on_a_supported_rover_changes_and_records_nothing(make_client, wait_job, stub_engine_cls):
    engine = stub_engine_cls()
    client, _ = make_client(engine=engine)
    seen = interpret(client)
    job = build(client, wait_job, {**ROVER, "intent_id": seen["intent_id"], "interpretation_choice": "closest_supported_rover"})
    assert job["status"] == "complete"
    assert engine.solve_calls[0]["assumptions"] == seen["intent"]["assumptions"]
    notes = client.get(f"/api/projects/{job['build_id']}").json()["provenance"]["notes"]
    assert not any(n.startswith(CLOSEST_ROVER_NOTE) for n in notes)


def test_a_refused_job_can_be_built_as_the_closest_rover_from_its_error_details(make_client, wait_job):
    client, _ = make_client()
    failed = build(client, wait_job, DRONE)
    intent_id = failed["error"]["details"]["interpretation"]["intent_id"]
    job = build(client, wait_job, {**DRONE, "intent_id": intent_id, "interpretation_choice": "closest_supported_rover"})
    assert job["status"] == "complete"
    notes = client.get(f"/api/projects/{job['build_id']}").json()["provenance"]["notes"]
    assert any(n.startswith(CLOSEST_ROVER_NOTE) for n in notes)


def test_the_recorded_choice_survives_an_accepted_edit(make_client, wait_job, stub_engine_cls):
    def rebuild_without_our_notes(plan, operation):
        new = json.loads(json.dumps(plan))
        new["provenance"]["notes"] = ["engine rebuilt the notes"]
        new["behavior"]["parameters"]["turn_duration_ms"] = 900
        return {"accepted": True, "plan": new}

    client, _ = make_client(engine=stub_engine_cls(edit_result=rebuild_without_our_notes))
    seen = interpret(client, DRONE)
    job = build(client, wait_job, {**DRONE, "intent_id": seen["intent_id"], "interpretation_choice": "closest_supported_rover"})
    edit = client.post(
        f"/api/projects/{job['build_id']}/edits",
        json={"base_revision": 1, "operation": {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 900}},
    )
    assert edit.status_code == 200 and edit.json()["accepted"] is True
    notes = client.get(f"/api/projects/{job['build_id']}?revision=2").json()["provenance"]["notes"]
    assert "engine rebuilt the notes" in notes
    assert sum(n.startswith(CLOSEST_ROVER_NOTE) for n in notes) == 1


def test_plain_generate_is_unchanged(make_client, wait_job, stub_engine_cls):
    """No intent_id: one vision call per job, as before; the response shape is unchanged."""
    vision = CountingVision()
    client, _ = make_client(vision=vision, engine=stub_engine_cls())
    resp = client.post("/api/projects/generate", json=ROVER)
    assert resp.status_code == 202 and set(resp.json()) == {"job_id", "status", "build_id"}
    assert wait_job(client, resp.json()["job_id"])["status"] == "complete"
    assert vision.calls == 1
