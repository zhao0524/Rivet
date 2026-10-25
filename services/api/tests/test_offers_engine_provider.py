"""Lane B's `rivet_engine.ecommerce` behind the API offers provider, recorded mode (skipped without the engine)."""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from rivet_api.config import Settings
from rivet_api.offers.factory import build_offers_provider

ecommerce = pytest.importorskip("rivet_engine.ecommerce")

REPO = Path(__file__).resolve().parents[3]
SCHEMA = Draft202012Validator(json.loads((REPO / "contracts" / "offer.schema.json").read_text()))


@pytest.fixture
def recorded_client(make_client, tmp_path):
    settings = Settings(mode="fixture", data_root=tmp_path, offers_provider="recorded")
    provider = build_offers_provider(settings)
    assert provider.mode == "recorded" and provider.name == "engine-recorded"
    return make_client(settings=settings, offers_provider=provider)[0]


def test_factory_builds_engine_providers_for_recorded_and_live(tmp_path):
    assert build_offers_provider(Settings(data_root=tmp_path, offers_provider="live")).mode == "live"
    with pytest.raises(ValueError, match="RIVET_OFFERS_PROVIDER"):
        build_offers_provider(Settings(data_root=tmp_path, offers_provider="amazon"))


def test_recorded_lookup_of_a_known_sku_is_found_and_valid(recorded_client):
    resp = recorded_client.post("/api/offers/search", json={"sku": "3801", "manufacturer": "Adafruit"})
    body = resp.json()
    SCHEMA.validate(body)
    assert resp.status_code == 200 and body["provider_mode"] == "recorded" and body["outcome"] == "found"
    assert body["offers"][0]["url"].startswith("https://") and body["offers"][0]["match"]["evidence_quote"]


def test_recorded_lookup_of_an_unknown_sku_is_not_found_with_no_link(recorded_client):
    body = recorded_client.post("/api/offers/search", json={"sku": "9999999"}).json()
    SCHEMA.validate(body)
    assert body["outcome"] == "not_found" and body["offers"] == [] and body["ledger"]


def test_engine_invalid_identifier_maps_to_400(recorded_client):
    resp = recorded_client.post("/api/offers/search", json={"gtin": "012345678904"})
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "INVALID_IDENTIFIER"
