import json

import pytest

from rivet_api.agents.vision import LiveVisionProvider, MockVisionProvider
from rivet_api.config import Settings
from rivet_api.errors import ApiError
from rivet_api.resolution.resolver import ProductCandidate, ResolverResult
from rivet_api.resolution.stub import StubResolver
from rivet_api.resolution.store import ResolutionStore

ASSET = "asset-" + "c" * 32


def text_body(text):
    return {"input": {"kind": "text", "user_text": text}}


@pytest.fixture
def resolve(make_client, wait_job):
    def _go(body, **kwargs):
        client, app = make_client(**kwargs)
        resp = client.post("/api/resolve", json=body)
        assert resp.status_code == 202, resp.text
        job = wait_job(client, resp.json()["job_id"])
        record = client.get(f"/api/resolutions/{job['resolution_id']}").json() if job["status"] == "complete" else None
        return client, app, job, record

    return _go


class LiveishResolver(StubResolver):
    """The stub's answers, rewritten onto real-looking hosts and SKUs, claiming to be live."""

    mode = "live"
    name = "test-live"

    def resolve(self, guess, user_text):
        raw = super().resolve(guess, user_text).model_dump_json()
        return ResolverResult.model_validate_json(raw.replace(".stub.invalid", ".shop-rivet.com").replace("STUB-", "RV-"))


class StubClaimingLive(StubResolver):
    mode = "live"
    name = "stub-claiming-live"


class ListedVision(MockVisionProvider):
    mode = "live"


# ---- happy paths per outcome -----------------------------------------------------------
def test_exact_match_end_to_end(resolve):
    client, app, job, rec = resolve(text_body("DJI Mini 4 drone"))
    assert job["status"] == "complete" and job["progress"] == 1.0
    assert rec["outcome"] == "exact_match"
    assert rec["product"]["status"] == "verified"
    assert {p["status"] for p in rec["parts"]} == {"verified", "unavailable"}
    assert rec["guess"]["brand"] == "DJI"
    # fixture providers: the saved-example banner is always present
    assert rec["provenance"]["saved_example"] is True and "Saved example" in rec["provenance"]["banner"]


def test_partial_match_end_to_end(resolve):
    _, _, _, rec = resolve(text_body("Parrot Anafi drone"))
    assert rec["outcome"] == "partial_match"
    assert rec["counts"]["inferred"] == 1 and rec["counts"]["not_found"] == 1
    assert rec["typical_parts"] and rec["typical_parts"][0]["label"] == "typical_for_category"
    assert all(p["name"] != rec["typical_parts"][0]["name"] or p["part_id"] != "typical" for p in rec["parts"])


def test_no_match_with_alternatives_end_to_end(resolve):
    _, _, _, rec = resolve(text_body("Zorblax Q9 drone"))
    assert rec["outcome"] == "no_match_with_alternatives"
    assert rec["product"] is None and rec["parts"] == []
    assert rec["alternatives"] and rec["alternatives"][0]["status"] == "verified"


def test_unsupported_end_to_end_does_not_call_the_resolver(resolve):
    class Boom(StubResolver):
        def resolve(self, guess, user_text):
            raise AssertionError("must not be called")

    _, _, job, rec = resolve(text_body("a sunset landscape"), resolver=Boom())
    assert job["status"] == "complete"
    assert rec["outcome"] == "unsupported" and rec["unsupported_reason"] and rec["ledger"] == []


def test_image_input_flows_through_vision(resolve, fake_assets_cls):
    assets = fake_assets_cls({ASSET: (b"\x89PNG", "image/png")})
    body = {"input": {"kind": "image_and_text", "image_asset_id": ASSET, "user_text": "DJI Mini 4"}}
    client, app, job, rec = resolve(body, assets=assets)
    assert rec["outcome"] == "exact_match" and rec["input"]["image_asset_id"] == ASSET
    body = client.get(f"/api/jobs/{job['job_id']}/events").text
    stages = [json.loads(c.split("data: ", 1)[1].split("\n")[0])["stage"] for c in body.split("\n\n") if "data: " in c]
    assert stages[0] == "upload" and "identify" in stages and "verify" in stages and stages[-1] == "complete"


def test_live_vision_model_is_used_when_configured(resolve):
    reply = {"brand": "DJI", "model_guess": "Mini 4", "category": "drone", "visible_features": ["gimbal"],
             "confidence": "high", "verdict": "supported", "unsupported_reason": None}

    class Backend:
        def complete_json(self, system, user_text, image):
            return json.dumps(reply)

    _, _, _, rec = resolve(text_body("what is this"), vision=LiveVisionProvider(Backend(), "m"))
    assert rec["outcome"] == "exact_match" and rec["provenance"]["vision_mode"] == "live"


def test_everything_live_means_no_saved_example_banner(resolve):
    _, _, _, rec = resolve(
        text_body("DJI Mini 4"),
        vision=ListedVision(), resolver=LiveishResolver(),
        settings=Settings(mode="live"),
    )
    assert rec["provenance"]["saved_example"] is False and rec["provenance"]["banner"] is None


def test_live_resolver_still_gets_full_evidence_checks(resolve):
    _, _, _, rec = resolve(
        text_body("DJI Mini 4"), vision=ListedVision(), resolver=LiveishResolver(), settings=Settings(mode="live")
    )
    assert rec["outcome"] == "exact_match" and rec["product"]["sku"] == "RV-DJI-MINI4"


def test_low_confidence_reading_asks_for_another_photo_and_skips_the_resolver(resolve, fake_assets_cls):
    class Boom(StubResolver):
        def resolve(self, guess, user_text):
            raise AssertionError("must not be called")

    class Backend:
        def complete_json(self, system, user_text, image):
            return json.dumps({"brand": "DJI", "model_guess": "Mini 4?", "category": "drone",
                               "visible_features": ["blurry"], "confidence": "low", "verdict": "supported",
                               "unsupported_reason": None})

    assets = fake_assets_cls({ASSET: (b"\x89PNG", "image/png")})
    _, _, job, rec = resolve(
        {"input": {"kind": "image", "image_asset_id": ASSET}},
        assets=assets, vision=LiveVisionProvider(Backend(), "m"), resolver=Boom(),
    )
    assert job["status"] == "complete" and rec["outcome"] == "unsupported"
    assert rec["guess"]["brand"] is None and "photo" in rec["unsupported_reason"]
    assert rec["headline"].startswith("We could not tell which product this is")


@pytest.mark.parametrize(
    ("reply", "outcome"),
    [
        ({"brand": "DJI", "model_guess": "Mini 4", "category": "drone", "confidence": "high"}, "exact_match"),
        ({"brand": None, "model_guess": None, "category": "rover", "confidence": "medium"},
         "no_match_with_alternatives"),
        ({"brand": None, "model_guess": None, "category": "not_a_product", "confidence": "high",
          "verdict": "unsupported", "unsupported_reason": "A photo of a beach"}, "unsupported"),
    ],
    ids=["drone", "rover", "non_product"],
)
def test_image_of_drone_rover_and_non_product_reach_their_outcomes(resolve, fake_assets_cls, reply, outcome):
    full = {"visible_features": [], "verdict": "supported", "unsupported_reason": None, **reply}

    class Backend:
        def complete_json(self, system, user_text, image):
            assert image is not None
            return json.dumps(full)

    assets = fake_assets_cls({ASSET: (b"\x89PNG", "image/png")})
    _, _, _, rec = resolve(
        {"input": {"kind": "image", "image_asset_id": ASSET}}, assets=assets, vision=LiveVisionProvider(Backend(), "m")
    )
    assert rec["outcome"] == outcome and rec["guess"]["category"] == reply["category"]


# ---- fail closed ------------------------------------------------------------------
def test_live_resolver_returning_stub_records_fails_closed_and_stores_nothing(resolve, tmp_path):
    _, _, job, rec = resolve(
        text_body("DJI Mini 4"), vision=ListedVision(), resolver=StubClaimingLive(), settings=Settings(mode="live")
    )
    assert job["status"] == "failed" and job["error"]["code"] == "SYNTHETIC_EVIDENCE_IN_LIVE_RESOLUTION"
    assert any("stub.invalid" in s for s in job["error"]["details"]["sources"])
    assert rec is None and not list((tmp_path / "resolutions").glob("*.json"))


def test_fixture_mode_stub_is_allowed_and_labelled(resolve):
    _, _, _, rec = resolve(text_body("DJI Mini 4"))
    assert rec["provenance"]["resolver_mode"] == "fixture" and rec["provenance"]["saved_example"] is True


def test_live_mode_refuses_the_stub_resolver_up_front(make_client):
    client, _ = make_client(settings=Settings(mode="live"))
    resp = client.post("/api/resolve", json=text_body("DJI Mini 4"))
    assert resp.status_code == 503
    err = resp.json()["error"]
    assert err["code"] == "RESOLVER_UNAVAILABLE" and err["details"] == {"resolver": "stub"}


def test_offline_resolver_fails_the_whole_job_and_stores_nothing(resolve, tmp_path):
    class Offline(StubResolver):
        def resolve(self, guess, user_text):
            return ResolverResult(fetch_status="offline", product=ProductCandidate(brand="DJI", name="x", sku="y"))

    client, app, job, rec = resolve(text_body("DJI Mini 4"), resolver=Offline())
    assert job["status"] == "failed" and job["error"]["code"] == "RESOLVER_OFFLINE" and job["error"]["retryable"]
    assert rec is None and "resolution_id" not in job
    assert not list((tmp_path / "resolutions").glob("*.json")) if (tmp_path / "resolutions").exists() else True


def test_blocked_resolver_is_a_non_retryable_failure(resolve):
    class Blocked(StubResolver):
        def resolve(self, guess, user_text):
            return ResolverResult(fetch_status="blocked")

    _, _, job, _ = resolve(text_body("DJI Mini 4"), resolver=Blocked())
    assert job["error"]["code"] == "RESOLVER_BLOCKED" and job["error"]["retryable"] is False


def test_malformed_resolver_output_is_a_contract_violation(resolve):
    class Malformed(StubResolver):
        def resolve(self, guess, user_text):
            return {"fetch_status": "ok", "product": {"brand": "DJI"}, "surprise": 1}

    _, _, job, _ = resolve(text_body("DJI Mini 4"), resolver=Malformed())
    assert job["status"] == "failed" and job["error"]["code"] == "RESOLVER_CONTRACT_VIOLATION"


def test_resolver_crash_does_not_leak_internals(resolve):
    class Crash(StubResolver):
        def resolve(self, guess, user_text):
            raise RuntimeError("secret-token-123 at /srv/path")

    _, _, job, _ = resolve(text_body("DJI Mini 4"), resolver=Crash())
    assert job["error"]["code"] == "RESOLVER_FAILED"
    assert "secret" not in json.dumps(job)


def test_resolver_returning_dict_is_accepted_when_valid(resolve):
    class AsDict(StubResolver):
        def resolve(self, guess, user_text):
            return super().resolve(guess, user_text).model_dump()

    _, _, _, rec = resolve(text_body("DJI Mini 4"), resolver=AsDict())
    assert rec["outcome"] == "exact_match"


def test_fabricated_sku_from_the_resolver_never_reaches_a_verified_product(resolve):
    class Fabricator(StubResolver):
        def resolve(self, guess, user_text):
            result = super().resolve(guess, user_text)
            e = result.product.evidence[0].model_copy(update={"matched_text": "No such thing here"})
            return result.model_copy(update={"product": result.product.model_copy(update={"evidence": [e]})})

    _, _, _, rec = resolve(text_body("DJI Mini 4"), resolver=Fabricator())
    assert rec["outcome"] == "no_match_with_alternatives" and rec["product"]["status"] == "not_found"


def test_vision_parse_failure_fails_the_job_with_a_typed_error(resolve):
    class Backend:
        def complete_json(self, *a):
            return "not json"

    _, _, job, _ = resolve(text_body("x"), vision=LiveVisionProvider(Backend(), "m"))
    assert job["error"]["code"] == "VISION_PARSE_FAILED"


def test_vision_provider_error_is_surfaced_and_stores_nothing(resolve):
    class Backend:
        def complete_json(self, *a):
            raise ApiError("PROVIDER_QUOTA", "The vision provider rate limit was reached", 429, retryable=True)

    _, _, job, rec = resolve(text_body("x"), vision=LiveVisionProvider(Backend(), "m"))
    assert job["error"]["code"] == "PROVIDER_QUOTA" and rec is None


# ---- request validation and errors --------------------------------------------------
@pytest.mark.parametrize(
    "body",
    [
        {},
        {"input": {"kind": "text"}},
        {"input": {"kind": "image"}},
        {"input": {"kind": "text", "user_text": "x", "image_asset_id": ASSET}},
        {"input": {"kind": "text", "user_text": "x"}, "requirements": {"max_budget": "5"}},
        {"input": {"kind": "image", "image_asset_id": "../etc/passwd"}},
    ],
)
def test_invalid_requests_are_400(make_client, body):
    client, _ = make_client()
    resp = client.post("/api/resolve", json=body)
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "BAD_REQUEST"


def test_unknown_asset_is_404(make_client):
    client, _ = make_client()
    resp = client.post("/api/resolve", json={"input": {"kind": "image", "image_asset_id": ASSET}})
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "ASSET_NOT_FOUND"


@pytest.mark.parametrize("rid", ["res-000000000000", "nope", "res-../../x", "RES-ABCDEF123456"])
def test_unknown_or_malformed_resolution_id_is_404(make_client, rid):
    client, _ = make_client()
    for path in (f"/api/resolutions/{rid}", f"/api/resolutions/{rid}/evidence"):
        resp = client.get(path)
        assert resp.status_code == 404 and resp.json()["error"]["code"] == "RESOLUTION_NOT_FOUND"


# ---- storage and the evidence ledger --------------------------------------------------
def test_evidence_ledger_is_stored_and_served(resolve):
    client, _, job, rec = resolve(text_body("DJI Mini 4"))
    ledger = client.get(f"/api/resolutions/{rec['resolution_id']}/evidence").json()["ledger"]
    assert ledger == rec["ledger"] and len(ledger) == 4
    entry = ledger[0]
    assert entry["subject"] == "product" and entry["support"] == "verified"
    assert set(entry["evidence"]) >= {"source_url", "fetched_at", "content_sha256", "matched_text", "ttl_days"}
    # every evidence id referenced by a claim exists in the ledger
    ids = {e["evidence_id"] for e in ledger}
    for part in rec["parts"]:
        for claim in part["claims"]:
            assert set(claim["evidence_ids"]) <= ids


def test_rejected_records_stay_in_the_ledger_for_audit(resolve):
    class Fabricator(StubResolver):
        def resolve(self, guess, user_text):
            result = super().resolve(guess, user_text)
            e = result.product.evidence[0].model_copy(update={"source_host_tier": "community"})
            return result.model_copy(update={"product": result.product.model_copy(update={"evidence": [e]})})

    _, _, _, rec = resolve(text_body("DJI Mini 4"), resolver=Fabricator())
    assert rec["ledger"][0]["support"] == "rejected" and "community" in rec["ledger"][0]["reason"]


def test_resolution_is_persisted_across_app_instances(make_client, wait_job, tmp_path):
    client, _ = make_client()
    job = wait_job(client, client.post("/api/resolve", json=text_body("DJI Mini 4")).json()["job_id"])
    rid = job["resolution_id"]
    assert (tmp_path / "resolutions" / f"{rid}.json").exists()
    store = ResolutionStore(tmp_path / "resolutions")
    assert store.get(rid)["outcome"] == "exact_match"


def test_job_survives_restart_with_resolution_id(make_client, wait_job, tmp_path):
    client, _ = make_client()
    job = wait_job(client, client.post("/api/resolve", json=text_body("DJI Mini 4")).json()["job_id"])
    client2, _ = make_client()
    again = client2.get(f"/api/jobs/{job['job_id']}").json()
    assert again["status"] == "complete" and again["resolution_id"] == job["resolution_id"]


def test_same_inputs_give_the_same_outcome_and_claims(make_client, wait_job):
    client, _ = make_client()
    recs = []
    for _ in range(2):
        job = wait_job(client, client.post("/api/resolve", json=text_body("Parrot Anafi")).json()["job_id"])
        recs.append(client.get(f"/api/resolutions/{job['resolution_id']}").json())
    strip = lambda r: {k: v for k, v in r.items() if k not in ("resolution_id", "created_at", "ledger")}  # noqa: E731
    assert strip(recs[0]) == strip(recs[1])


def test_events_show_real_stages_and_end_complete(make_client, wait_job):
    client, _ = make_client()
    job = wait_job(client, client.post("/api/resolve", json=text_body("DJI Mini 4")).json()["job_id"])
    body = client.get(f"/api/jobs/{job['job_id']}/events").text
    events = [json.loads(chunk.split("data: ", 1)[1].split("\n")[0]) for chunk in body.split("\n\n") if "data: " in chunk]
    assert [e["stage"] for e in events if e["status"] != "running"] == ["identify", "verify", "decompose", "complete"]
    assert events[-1]["message"] == "Resolution ready"


def test_unsupported_job_progress_reaches_one(resolve):
    _, _, job, _ = resolve(text_body("a selfie"))
    assert job["progress"] == 1.0


def test_generate_endpoint_is_unaffected(make_client, wait_job):
    client, _ = make_client()
    job = wait_job(client, client.post("/api/projects/generate", json=text_body("small rover")).json()["job_id"])
    assert job["status"] == "complete" and "resolution_id" not in job and job["build_id"]


def test_unknown_resolver_setting_fails_at_startup():
    from rivet_api.resolution.factory import build_resolver

    with pytest.raises(ValueError):
        build_resolver(Settings(resolver_provider="bing"))
