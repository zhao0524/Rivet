"""Offers routes against the stub and fake providers (docs/e-commerce-layer/plan.md section 5)."""

import json
import threading
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from rivet_api.errors import ApiError
from rivet_api.offers.engine_provider import ProviderAuth, ProviderQuota, ProviderUnavailable, map_offers_error
from rivet_api.offers.models import InvalidIdentifier, OfferSet
from rivet_api.offers.store import OfferSetStore
from rivet_api.offers.stub import STUB_NOTICE, StubOffersProvider

REPO = Path(__file__).resolve().parents[3]
SCHEMA = Draft202012Validator(json.loads((REPO / "contracts" / "offer.schema.json").read_text()))
MULTI = {"sku": "TEST-MV-3801", "mpn": "MV3801", "manufacturer": "Maker Shop (TEST)"}
ADAFRUIT_ID = "motor.adafruit_tt_bimetal_1to90_3801"


def valid(body: dict) -> dict:
    SCHEMA.validate(body)
    return body


def ids(body: dict) -> list[str]:
    return [o["offer_id"] for o in body["offers"]]


class CountingStub(StubOffersProvider):
    def __init__(self):
        super().__init__()
        self.calls = 0

    def find(self, query):
        self.calls += 1
        return super().find(query)


class FakeProvider:
    """Answers with a canned payload, raises, or blocks; claims whichever mode the test needs."""

    def __init__(self, result=None, raises=None, mode="recorded", name="fake"):
        self.result, self.raises, self.mode, self.name = result, raises, mode, name
        self.calls = 0
        self.release = threading.Event()
        self.release.set()

    def find(self, query):
        self.calls += 1
        self.release.wait(5)
        if self.raises is not None:
            raise self.raises
        return self.result if not callable(self.result) else self.result(query)


class RealCatalogEngine:
    """The saved fixture engine with a test-only catalog whose first part is the real Adafruit 3801 motor."""

    def __init__(self, stub_engine_cls):
        self.inner = stub_engine_cls(real=True)

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def get_catalog(self):
        catalog = self.inner.get_catalog()
        motor = next(e for e in catalog if e["identity"]["category"] == "motor")
        motor["catalog_id"] = ADAFRUIT_ID
        motor["identity"].update(sku="3801", manufacturer="Adafruit")
        no_sku = next(e for e in catalog if e["identity"]["category"] != "motor")
        no_sku["catalog_id"] = "test.no_sku_part"
        no_sku["identity"]["sku"] = None
        return catalog


@pytest.fixture
def stub_client(make_client):
    provider = CountingStub()
    client, app = make_client(offers_provider=provider)
    return client, provider


def stub_fixture(name: str) -> dict:
    return json.loads((REPO / "fixtures" / "offers" / name).read_text())


# ---- POST /api/offers/search, stub provider ----------------------------------------------


def test_search_returns_the_multivendor_fixture_labelled_as_stub(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json=MULTI).json())
    assert body["provider_mode"] == "stub" and body["synthetic"] is True and STUB_NOTICE in body["notices"]
    assert body["outcome"] == "partial" and len(body["offers"]) == 8
    assert ids(body) == sorted(ids(body), key=lambda i: (-next(o["reliability"]["score"] for o in body["offers"] if o["offer_id"] == i), i))


def test_search_by_sku_alone_hits_a_unique_fixture(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={"sku": "3801"}).json())
    assert body["outcome"] == "found" and body["offers"][0]["vendor"]["domain"] == "adafruit.com"
    assert body["offers"][0]["price_amount"] == "4.50" and body["query"]["catalog_id"] is None


def test_unknown_sku_is_not_found_with_no_offers_and_a_no_lookup_notice(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={"sku": "NOPE-0000"}).json())
    assert body["outcome"] == "not_found" and body["offers"] == [] and body["provider_mode"] == "stub"
    assert body["ledger"][0]["status"] == "skipped" and "no live lookup" in body["notices"][0]


def test_search_needs_an_identifier_and_rejects_unknown_fields(stub_client):
    client, _ = stub_client
    assert client.post("/api/offers/search", json={"manufacturer": "Adafruit"}).status_code == 400
    assert client.post("/api/offers/search", json={"sku": "3801", "affiliate": "x"}).status_code == 400
    assert client.post("/api/offers/search", json={"sku": "3801", "sort": "cheapest"}).status_code == 400


# ---- case 6: null price sorts last, never 0 ----------------------------------------------


@pytest.mark.parametrize("sort", ["price_asc", "price_desc"])
def test_null_price_sorts_last_in_both_price_directions(stub_client, sort):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "sort": sort}).json())
    assert body["offers"][-1]["price_amount"] is None
    assert "0" not in {o["price_amount"] for o in body["offers"]} and "0.00" not in {o["price_amount"] for o in body["offers"]}
    usd = [o for o in body["offers"] if o["currency"] == "USD" and o["price_amount"] is not None]
    assert ids(body)[: len(usd)] == [o["offer_id"] for o in usd]


# ---- case 7: currencies ------------------------------------------------------------------


def test_currency_filter_returns_only_that_currency_without_conversion(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "currency": "EUR"}).json())
    assert [(o["currency"], o["price_amount"]) for o in body["offers"]] == [("EUR", "4.20")]
    assert body["outcome"] == "partial"


def test_eur_offer_follows_usd_offers_in_price_sort(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "sort": "price_asc"}).json())
    currencies = [o["currency"] for o in body["offers"] if o["price_amount"] is not None]
    assert currencies.index("EUR") == len(currencies) - 1


# ---- case 8: pack size -------------------------------------------------------------------


def test_three_pack_is_compared_per_unit_and_keeps_its_basis(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "sort": "price_asc", "currency": "USD"}).json())
    prices = [o["price_amount"] for o in body["offers"]]
    pack = next(o for o in body["offers"] if o["pack"]["quantity"] == 3)
    assert pack["pack"]["unit_price_basis"] == "per_pack" and pack["price_amount"] == "12.00"
    assert prices.index("12.00") < prices.index("4.50")


def test_max_price_uses_the_unit_price_for_packs(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "max_price": "4.00"}).json())
    assert {o["price_amount"] for o in body["offers"]} == {"0.99", "12.00"}


# ---- case 10: ratings --------------------------------------------------------------------


def test_min_rating_excludes_null_ratings(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "min_rating": 4}).json())
    assert body["offers"] and all(o["rating"] is not None and o["rating"]["count"] >= 1 for o in body["offers"])
    body = valid(client.post("/api/offers/search", json={**MULTI, "min_rating": 0}).json())
    assert all(o["rating"] is not None for o in body["offers"]) and len(body["offers"]) == 2


def test_single_review_five_star_rating_has_a_low_reliability_weight(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "sort": "rating"}).json())
    top = body["offers"][0]
    assert top["rating"]["value"] == 5.0 and top["rating"]["count"] == 1
    assert top["reliability"]["score"] < max(o["reliability"]["score"] for o in body["offers"])


# ---- cases 11 and 12: stale and demoted stay listed --------------------------------------


def test_stale_and_demoted_offers_are_returned_and_labelled(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json=MULTI).json())
    statuses = {o["offer_id"]: o["status"] for o in body["offers"]}
    stale = [o for o in body["offers"] if o["status"] == "stale"]
    demoted = [o for o in body["offers"] if o["status"] == "demoted"]
    assert stale and stale[0]["fetched_at"] < "2026-09-24"
    assert any(o["link_status"] == "broken" for o in demoted)
    assert set(statuses.values()) == {"ok", "stale", "demoted"}


# ---- case 18: determinism and empty result -----------------------------------------------


@pytest.mark.parametrize(
    "params",
    [
        {"sort": "price_asc"},
        {"sort": "price_desc", "in_stock": True},
        {"sort": "rating", "vendor_tier": ["authorized_distributor", "marketplace"]},
        {"sort": "availability"},
        {"sort": "newest", "currency": "USD"},
        {"sort": "reliability", "max_price": "5.00"},
    ],
)
def test_sort_filter_combinations_are_identical_across_calls(stub_client, params):
    client, _ = stub_client
    first = valid(client.post("/api/offers/search", json={**MULTI, **params}).json())
    second = valid(client.post("/api/offers/search", json={**MULTI, **params}).json())
    assert ids(first) == ids(second) and first["possible_matches"] == second["possible_matches"]


def test_price_ties_break_on_offer_id(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "sort": "price_asc"}).json())
    tied = [o["offer_id"] for o in body["offers"] if o["price_amount"] == "4.50"]
    assert len(tied) == 2 and tied == sorted(tied)


def test_empty_after_filter_is_200_with_the_original_outcome(stub_client):
    client, _ = stub_client
    resp = client.post("/api/offers/search", json={**MULTI, "currency": "GBP"})
    body = valid(resp.json())
    assert resp.status_code == 200 and body["offers"] == [] and body["outcome"] == "partial"
    assert len(body["possible_matches"]) == 1 and len(body["alternatives"]) == 1


def test_filters_do_not_touch_possible_matches_or_alternatives(stub_client):
    client, _ = stub_client
    body = valid(client.post("/api/offers/search", json={**MULTI, "vendor_tier": ["manufacturer"], "in_stock": True}).json())
    assert {o["vendor"]["tier"] for o in body["offers"]} == {"manufacturer"}
    assert body["possible_matches"][0]["match"]["kind"] == "fuzzy" and body["alternatives"]


# ---- case 21: identifiers ----------------------------------------------------------------


def test_bad_gtin_check_digit_is_400_invalid_identifier(stub_client):
    client, provider = stub_client
    resp = client.post("/api/offers/search", json={"gtin": "012345678904"})
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "INVALID_IDENTIFIER"
    assert provider.calls == 0


def test_whitespace_and_case_variants_share_one_cache_entry(stub_client):
    client, provider = stub_client
    first = valid(client.post("/api/offers/search", json={"sku": " test-mv-3801", "mpn": "mv3801 ", "manufacturer": "maker  shop (test)"}).json())
    second = valid(client.post("/api/offers/search", json=MULTI).json())
    assert provider.calls == 1
    assert first["query"]["normalized_key"] == second["query"]["normalized_key"] == "test-mv-3801|mv3801||maker shop (test)"
    assert ids(first) == ids(second)


# ---- GET /api/parts/{catalog_id}/offers --------------------------------------------------


def test_part_offers_for_a_real_catalog_part(make_client, stub_engine_cls):
    provider = CountingStub()
    client, _ = make_client(engine=RealCatalogEngine(stub_engine_cls), offers_provider=provider)
    resp = client.get(f"/api/parts/{ADAFRUIT_ID}/offers?sort=price_asc")
    body = valid(resp.json())
    assert resp.status_code == 200 and body["outcome"] == "found" and body["query"]["catalog_id"] == ADAFRUIT_ID
    assert body["query"]["sku"] == "3801" and body["offers"][0]["url"] == "https://www.adafruit.com/product/3801"


def test_part_offers_query_filters_apply(make_client, stub_engine_cls):
    client, _ = make_client(engine=RealCatalogEngine(stub_engine_cls), offers_provider=CountingStub())
    body = valid(client.get(f"/api/parts/{ADAFRUIT_ID}/offers?vendor_tier=marketplace&vendor_tier=reseller").json())
    assert body["offers"] == [] and body["outcome"] == "found"
    assert client.get(f"/api/parts/{ADAFRUIT_ID}/offers?sort=cheapest").status_code == 400
    assert client.get(f"/api/parts/{ADAFRUIT_ID}/offers?min_rating=7").status_code == 400
    assert client.get(f"/api/parts/{ADAFRUIT_ID}/offers?max_price=0").status_code == 400


def test_synthetic_demo_part_is_refused_without_a_provider_call(stub_client):
    client, provider = stub_client
    resp = client.get("/api/parts/demo.tt_motor/offers")
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "EXPORT_REFUSED_SYNTHETIC"
    assert provider.calls == 0


def test_unknown_part_is_404(stub_client):
    client, provider = stub_client
    resp = client.get("/api/parts/nope.part/offers")
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "PART_NOT_FOUND" and provider.calls == 0


def test_real_part_without_a_sku_is_refused_not_searched(make_client, stub_engine_cls):
    provider = CountingStub()
    client, _ = make_client(engine=RealCatalogEngine(stub_engine_cls), offers_provider=provider)
    resp = client.get("/api/parts/test.no_sku_part/offers")
    body = valid(resp.json())
    assert resp.status_code == 200 and body["outcome"] == "refused" and body["offers"] == [] and provider.calls == 0


# ---- GET /api/offers/{offer_set_id} -------------------------------------------------------


def test_offer_set_is_retrievable_by_id_and_unknown_ids_are_404(make_client):
    store = OfferSetStore()
    client, _ = make_client(offers_provider=CountingStub(), offer_sets=store)
    body = valid(client.post("/api/offers/search", json=MULTI).json())
    offer_set_id = store.cached(body["query"]["normalized_key"])[0]
    stored = valid(client.get(f"/api/offers/{offer_set_id}").json())
    assert stored["query"] == body["query"] and len(stored["offers"]) == 8
    for bad in ("ofs-000000000000", "nope", "ofs-" + "z" * 12, "res-000000000000"):
        resp = client.get(f"/api/offers/{bad}")
        assert resp.status_code == 404 and resp.json()["error"]["code"] == "OFFER_SET_NOT_FOUND"


def test_cache_expires_after_its_ttl(make_client):
    now = [0.0]
    store = OfferSetStore(cache_ttl_s=10, clock=lambda: now[0])
    provider = CountingStub()
    client, _ = make_client(offers_provider=provider, offer_sets=store)
    client.post("/api/offers/search", json=MULTI)
    client.post("/api/offers/search", json=MULTI)
    assert provider.calls == 1
    now[0] = 11
    client.post("/api/offers/search", json=MULTI)
    assert provider.calls == 2


def test_store_is_bounded(make_client):
    store = OfferSetStore(max_items=2)
    provider = CountingStub()
    client, _ = make_client(offers_provider=provider, offer_sets=store)
    first = store.cached(valid(client.post("/api/offers/search", json={"sku": "A-1"}).json())["query"]["normalized_key"])[0]
    client.post("/api/offers/search", json={"sku": "A-2"})
    client.post("/api/offers/search", json={"sku": "A-3"})
    assert client.get(f"/api/offers/{first}").status_code == 404 and store.cached("a-1|||") is None


# ---- case 14: provider failures ----------------------------------------------------------


@pytest.mark.parametrize(
    "exc,status,code,retryable",
    [
        (ProviderQuota("brave-search", "slow down"), 429, "PROVIDER_QUOTA", True),
        (ProviderAuth("mouser-api", "bad key"), 502, "PROVIDER_AUTH", False),
        (ProviderUnavailable("brave-search", "down"), 503, "PROVIDER_UNAVAILABLE", True),
        (InvalidIdentifier("gtin check digit does not match"), 400, "INVALID_IDENTIFIER", False),
        (RuntimeError("secret-token-123"), 502, "PROVIDER_ERROR", False),
    ],
)
def test_provider_errors_map_to_typed_api_errors(make_client, exc, status, code, retryable):
    client, _ = make_client(offers_provider=FakeProvider(raises=exc))
    resp = client.post("/api/offers/search", json={"sku": "3801"})
    err = resp.json()["error"]
    assert (resp.status_code, err["code"], err["retryable"]) == (status, code, retryable)
    assert "secret-token" not in resp.text


def test_map_offers_error_passes_api_errors_through():
    original = ApiError("PROVIDER_QUOTA", "x", 429, retryable=True)
    assert map_offers_error(original) is original


def test_partial_outcome_from_the_provider_is_served_with_its_notice(make_client):
    client, _ = make_client(offers_provider=FakeProvider(result=stub_fixture("synthetic-multivendor.json")))
    body = valid(client.post("/api/offers/search", json=MULTI).json())
    assert body["outcome"] == "partial" and any("partial" in n for n in body["notices"])
    assert {e["status"] for e in body["ledger"]} >= {"blocked", "error"}


# ---- case 20: bad URLs from a provider never reach a client -------------------------------


@pytest.mark.parametrize("url", ["javascript:alert(1)", "http://maker-shop.example/p/test-mv-3801", "ftp://x.example/a", "https://"])
def test_provider_returning_a_non_https_url_is_a_502_not_a_response(make_client, url):
    payload = stub_fixture("synthetic-multivendor.json")
    payload["offers"][0]["url"] = url
    client, _ = make_client(offers_provider=FakeProvider(result=payload))
    resp = client.post("/api/offers/search", json=MULTI)
    assert resp.status_code == 502 and resp.json()["error"]["code"] == "PROVIDER_ERROR"
    assert url not in resp.text and "offers.0.url" in resp.json()["error"]["details"]["fields"]


@pytest.mark.parametrize("patch", [{"price_amount": "0"}, {"price_amount": "4.50", "currency": None}])
def test_provider_returning_a_zero_or_currencyless_price_is_rejected(make_client, patch):
    payload = stub_fixture("synthetic-multivendor.json")
    payload["offers"][0].update(patch)
    client, _ = make_client(offers_provider=FakeProvider(result=payload))
    assert client.post("/api/offers/search", json=MULTI).json()["error"]["code"] == "PROVIDER_ERROR"


def test_provider_output_as_a_model_is_accepted(make_client):
    client, _ = make_client(offers_provider=FakeProvider(result=OfferSet.model_validate(stub_fixture("adafruit-3801.json"))))
    assert valid(client.post("/api/offers/search", json={"sku": "3801"}).json())["provider_mode"] == "recorded"


# ---- live provider: jobs -----------------------------------------------------------------


def live_result(query):
    data = stub_fixture("adafruit-3801.json")
    data["provider_mode"] = "live"
    data["query"] = query.model_dump(mode="json")
    return data


def test_live_miss_returns_a_job_whose_terminal_state_carries_the_offer_set_id(make_client, wait_job):
    provider = FakeProvider(result=live_result, mode="live")
    client, _ = make_client(offers_provider=provider)
    resp = client.post("/api/offers/search", json={"sku": "3801", "manufacturer": "Adafruit"})
    assert resp.status_code == 202 and resp.json() == {"job_id": resp.json()["job_id"], "status": "queued", "offer_set_id": None}
    job = wait_job(client, resp.json()["job_id"])
    assert job["status"] == "complete" and job["offer_set_id"].startswith("ofs-") and job["progress"] == 1.0
    body = valid(client.get(f"/api/offers/{job['offer_set_id']}").json())
    assert body["provider_mode"] == "live" and body["offers"][0]["price_amount"] == "4.50"
    events = client.get(f"/api/jobs/{job['job_id']}/events").text
    assert "Offers ready" in events and "1 verified offers" in events


def test_live_cache_hit_is_synchronous(make_client, wait_job):
    provider = FakeProvider(result=live_result, mode="live")
    client, _ = make_client(offers_provider=provider)
    job = wait_job(client, client.post("/api/offers/search", json={"sku": "3801", "manufacturer": "Adafruit"}).json()["job_id"])
    assert job["status"] == "complete"
    resp = client.post("/api/offers/search", json={"sku": "3801 ", "manufacturer": "adafruit", "sort": "price_desc"})
    assert resp.status_code == 200 and valid(resp.json())["provider_mode"] == "live" and provider.calls == 1


def test_live_failure_fails_the_job_with_the_mapped_error(make_client, wait_job):
    client, _ = make_client(offers_provider=FakeProvider(raises=ProviderQuota("brave-search", "x"), mode="live"))
    job = wait_job(client, client.post("/api/offers/search", json={"sku": "3801"}).json()["job_id"])
    assert job["status"] == "failed" and job["error"]["code"] == "PROVIDER_QUOTA" and job["error"]["retryable"] is True
    assert "offer_set_id" not in job


def test_live_provider_returning_synthetic_vendors_is_refused(make_client, wait_job):
    def synthetic_as_live(query):
        data = stub_fixture("synthetic-multivendor.json")
        data["provider_mode"] = "live"
        return data

    client, _ = make_client(offers_provider=FakeProvider(result=synthetic_as_live, mode="live"))
    job = wait_job(client, client.post("/api/offers/search", json=MULTI).json()["job_id"])
    assert job["status"] == "failed" and job["error"]["code"] == "SYNTHETIC_OFFERS_IN_LIVE_SET"


def test_live_part_lookup_for_a_demo_part_is_refused_before_any_job(make_client):
    provider = FakeProvider(result=live_result, mode="live")
    client, _ = make_client(offers_provider=provider)
    resp = client.get("/api/parts/demo.tt_motor/offers")
    assert resp.status_code == 422 and provider.calls == 0
