"""Opt-in live check that the `live` offers provider fetches real vendor pages for a known SKU.

Runs the server's own factory (`build_offers_provider` with `offers_provider="live"`) through
the API: `POST /api/offers/search` for the Adafruit 3801 motor must return a job, the job must
complete with an `offer_set_id`, and every offer in the stored set must be an https link with a
`fetched_at` timestamp and, when a price is shown, a currency. Nothing in the response may be
synthetic and the provider must say `live`. The engine's own search/API keys come from the
environment (see docs/e-commerce-layer/plan.md).

Skipped unless RIVET_LIVE_OFFERS_TEST=1 and `rivet_engine.ecommerce` is importable. Each run
makes real network requests to vendor sites and any configured search provider.

    RIVET_LIVE_OFFERS_TEST=1 python -m pytest -q tests/test_live_offers_provider.py -rs
"""

import importlib.util
import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from rivet_api.config import Settings
from rivet_api.main import create_app
from rivet_api.offers.factory import build_offers_provider

REPO = Path(__file__).resolve().parents[3]
SCHEMA = Draft202012Validator(json.loads((REPO / "contracts" / "offer.schema.json").read_text()))
JOB_TIMEOUT_S = 180.0
KNOWN_SKU = {"sku": "3801", "manufacturer": "Adafruit"}


def _missing_for_live_run() -> list[str]:
    missing = []
    if os.environ.get("RIVET_LIVE_OFFERS_TEST", "").strip().lower() not in {"1", "true", "yes", "on"}:
        missing.append("RIVET_LIVE_OFFERS_TEST=1")
    if importlib.util.find_spec("rivet_engine") is None or importlib.util.find_spec("rivet_engine.ecommerce") is None:
        missing.append("rivet_engine.ecommerce (pip install -e ../../packages/engineering)")
    return missing


MISSING = _missing_for_live_run()
live = pytest.mark.skipif(bool(MISSING), reason="opt-in live offers check (real network requests); needs " + ", ".join(MISSING))


@pytest.fixture(scope="module")
def live_client(tmp_path_factory):
    settings = Settings(mode="fixture", data_root=tmp_path_factory.mktemp("live-offers"), offers_provider="live")
    provider = build_offers_provider(settings)
    assert provider.mode == "live"
    return TestClient(create_app(settings, offers_provider=provider))


def _wait(client: TestClient, job_id: str) -> dict:
    deadline = time.monotonic() + JOB_TIMEOUT_S
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("complete", "failed"):
            return job
        time.sleep(0.5)
    raise AssertionError(f"job {job_id} did not finish within {JOB_TIMEOUT_S:.0f}s: {job}")


@live
def test_live_search_for_a_known_sku_returns_verified_https_offers(live_client):
    resp = live_client.post("/api/offers/search", json=KNOWN_SKU)
    assert resp.status_code == 202, resp.text
    job = _wait(live_client, resp.json()["job_id"])
    assert job["status"] == "complete", job
    body = live_client.get(f"/api/offers/{job['offer_set_id']}").json()
    SCHEMA.validate(body)
    assert body["provider_mode"] == "live" and body["synthetic"] is False
    assert body["outcome"] in ("found", "partial"), body["notices"]
    for offer in body["offers"]:
        assert offer["url"].startswith("https://") and offer["fetched_at"].endswith("Z")
        assert offer["match"]["kind"] != "fuzzy" and offer["match"]["evidence_quote"]
        assert offer["price_amount"] is None or offer["currency"]
        assert not offer["vendor"]["domain"].endswith(".example")


@live
def test_live_search_for_a_nonexistent_sku_is_not_found_without_a_fabricated_link(live_client):
    resp = live_client.post("/api/offers/search", json={"sku": "9999999"})
    assert resp.status_code == 202, resp.text
    job = _wait(live_client, resp.json()["job_id"])
    assert job["status"] == "complete", job
    body = live_client.get(f"/api/offers/{job['offer_set_id']}").json()
    SCHEMA.validate(body)
    assert body["outcome"] == "not_found" and body["offers"] == []
