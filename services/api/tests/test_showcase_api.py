"""Showcase catalogue routes (docs/e-commerce-layer/plan-showcase.md 3.4) and the fixture mirror."""

import json
import threading
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from rivet_api.offers.stub import StubOffersProvider
from rivet_api.showcase.models import ShowcaseIndex, ShowcaseProduct
from rivet_api.showcase.service import MERGED_NOTICE, MORE_VENDORS_NOTICE, PRECOLLECTED_NOTICE, part_query
from rivet_api.showcase.store import FIXTURE_DIR, ShowcaseStore

REPO = Path(__file__).resolve().parents[3]
SHARED = REPO / "fixtures" / "showcase"
SCHEMA = json.loads((REPO / "contracts" / "showcase-product.schema.json").read_text())
PRODUCT_SCHEMA = Draft202012Validator(SCHEMA)
INDEX_SCHEMA = Draft202012Validator({"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": "#/$defs/ShowcaseIndex"})
OFFER_SCHEMA = Draft202012Validator(json.loads((REPO / "contracts" / "offer.schema.json").read_text()))

PRODUCT = "sample-sparkfun-inventors-kit"
PRECOLLECTED_PART = "hobby-gearmotor-pair"
PLAIN_PART = "redboard-qwiic"
OFFERS_URL = f"/api/showcase/products/{PRODUCT}/parts/{{part}}/offers"


class FakeLiveProvider:
    mode = "live"
    name = "fake-live"

    def __init__(self):
        self.calls = 0
        self.release = threading.Event()
        self.release.set()

    def find(self, query, candidate_urls=()):
        self.calls += 1
        self.candidate_urls = list(candidate_urls)
        self.release.wait(5)
        data = json.loads((FIXTURE_DIR / "offers" / "sample-rob-13302.json").read_text())
        if getattr(self, "empty", False):
            data.update(outcome="not_found", offers=[], possible_matches=[], alternatives=[])
        data["provider_mode"] = "live"
        data["query"] = query.model_dump(mode="json")
        return data


@pytest.fixture
def client(make_client):
    return make_client(offers_provider=StubOffersProvider())[0]


# ---- index and product -------------------------------------------------------------------


def test_index_lists_the_sample_and_validates(client):
    body = client.get("/api/showcase/products").json()
    INDEX_SCHEMA.validate(body)
    assert PRODUCT in [p["product_id"] for p in body["products"]]


def test_index_category_filter(client):
    robots = client.get("/api/showcase/products?category=robot").json()["products"]
    assert PRODUCT in [p["product_id"] for p in robots] and {p["category"] for p in robots} == {"robot"}
    assert client.get("/api/showcase/products?category=bogus").status_code == 400


def test_product_validates_and_is_never_synthetic(client):
    body = client.get(f"/api/showcase/products/{PRODUCT}").json()
    PRODUCT_SCHEMA.validate(body)
    assert body["synthetic"] is False and body["totals"]["parts_verified"] == len(body["parts"]) == 5


def test_unknown_product_is_404(client):
    resp = client.get("/api/showcase/products/nope")
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "SHOWCASE_NOT_FOUND"


def test_unknown_part_is_404(client):
    resp = client.get(OFFERS_URL.format(part="nope"))
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "PART_NOT_FOUND"


# ---- part offers -------------------------------------------------------------------------


def test_precollected_set_is_served_as_recorded(client):
    body = client.get(OFFERS_URL.format(part=PRECOLLECTED_PART)).json()
    OFFER_SCHEMA.validate(body)
    assert body["provider_mode"] == "recorded" and body["outcome"] == "found" and body["synthetic"] is False
    assert body["query"]["sku"] == "ROB-13302" and body["offers"][0]["price_amount"] == "7.50"
    assert body["notices"][0] == PRECOLLECTED_NOTICE and MORE_VENDORS_NOTICE not in body["notices"]


def test_precollected_set_honours_sort_and_filter_params(client):
    assert client.get(OFFERS_URL.format(part=PRECOLLECTED_PART) + "?in_stock=true").json()["offers"] == []
    assert client.get(OFFERS_URL.format(part=PRECOLLECTED_PART) + "?sort=cheapest").status_code == 400


def test_part_without_a_precollected_set_falls_through_to_the_provider(client):
    body = client.get(OFFERS_URL.format(part=PLAIN_PART)).json()
    OFFER_SCHEMA.validate(body)
    assert body["provider_mode"] == "stub" and body["outcome"] == "not_found" and body["query"]["sku"] == "DEV-15123"


def test_live_provider_serves_the_precollected_set_with_a_more_vendors_notice(make_client):
    provider = FakeLiveProvider()
    client, _ = make_client(offers_provider=provider)
    body = client.get(OFFERS_URL.format(part=PRECOLLECTED_PART)).json()
    OFFER_SCHEMA.validate(body)
    assert body["provider_mode"] == "recorded" and MORE_VENDORS_NOTICE in body["notices"] and provider.calls == 0


def test_live_refresh_starts_a_job(make_client, wait_job):
    provider = FakeLiveProvider()
    client, _ = make_client(offers_provider=provider)
    resp = client.get(OFFERS_URL.format(part=PRECOLLECTED_PART) + "?refresh=true")
    assert resp.status_code == 202 and resp.json()["offer_set_id"] is None
    job = wait_job(client, resp.json()["job_id"])
    body = client.get(f"/api/offers/{job['offer_set_id']}").json()
    OFFER_SCHEMA.validate(body)
    assert body["provider_mode"] == "live" and provider.calls == 1
    assert body["notices"][0] == MERGED_NOTICE
    assert provider.candidate_urls == [str(ShowcaseStore().part(PRODUCT, PRECOLLECTED_PART)[1].url)]


def test_live_refresh_keeps_precollected_offers_and_caches_apart(make_client, wait_job):
    provider = FakeLiveProvider()
    provider.empty = True
    client, app = make_client(offers_provider=provider)
    precollected = client.get(OFFERS_URL.format(part=PRECOLLECTED_PART)).json()
    job = wait_job(client, client.get(OFFERS_URL.format(part=PRECOLLECTED_PART) + "?refresh=true").json()["job_id"])
    body = client.get(f"/api/offers/{job['offer_set_id']}").json()
    assert [o["offer_id"] for o in body["offers"]] == [o["offer_id"] for o in precollected["offers"]]
    assert body["outcome"] == precollected["outcome"]
    # A plain search for the same identifiers does not get the merged set.
    assert app.state.deps.offer_sets.cached(precollected["query"]["normalized_key"]) is None
    again = client.get(OFFERS_URL.format(part=PRECOLLECTED_PART) + "?refresh=true")
    assert again.status_code == 200 and provider.calls == 1


def test_part_query_uses_a_manufacturer_tier_vendor_when_the_page_named_no_brand():
    _, part = ShowcaseStore().part(PRODUCT, PRECOLLECTED_PART)
    unbranded = part.model_copy(update={"manufacturer": None})
    assert part_query(unbranded).manufacturer == part.vendor.name
    assert part_query(unbranded).normalized_key.endswith("|sparkfun electronics")


# ---- fixture mirror -----------------------------------------------------------------------


def test_packaged_fixtures_validate_through_models_and_schema():
    store = ShowcaseStore()
    for product in store.products.values():
        PRODUCT_SCHEMA.validate(product.model_dump(mode="json"))
    INDEX_SCHEMA.validate(store.index.model_dump(mode="json"))
    assert set(store.products) == {p.product_id for p in store.index.products}


def test_empty_fixture_dir_gives_an_empty_catalogue(tmp_path):
    store = ShowcaseStore(tmp_path)
    assert store.index.products == [] and store.products == {} and store.offers_by_key == {}


def _shared_files() -> list[Path]:
    return sorted(p for p in SHARED.rglob("*.json") if p.parent.name in ("products", "offers") or p.name == "index.json")


@pytest.mark.parametrize("shared", _shared_files() or [None], ids=lambda p: p.relative_to(SHARED).as_posix() if p else "none")
def test_packaged_showcase_fixture_matches_shared_fixture(shared):
    if shared is None:
        pytest.skip("fixtures/showcase has no index, products or offers yet")
    packaged = FIXTURE_DIR / shared.relative_to(SHARED)
    assert packaged.is_file(), f"{shared.relative_to(REPO)} is not mirrored in {FIXTURE_DIR.relative_to(REPO)}"
    assert json.loads(packaged.read_text()) == json.loads(shared.read_text())


def test_models_reject_a_synthetic_product():
    data = json.loads((FIXTURE_DIR / "products" / f"{PRODUCT}.json").read_text())
    with pytest.raises(ValueError):
        ShowcaseProduct.model_validate({**data, "synthetic": True})
    with pytest.raises(ValueError):
        ShowcaseIndex.model_validate({"schema_version": "1.0", "generated_at": "2026-10-24T00:00:00Z", "products": [], "extra": 1})
