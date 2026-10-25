"""rivet_engine.ecommerce.find_offers over recorded pages (docs/e-commerce-layer/plan.md section 5,
cases 1 to 17 and 19 to 21). Offline and deterministic: `RecordedFetcher` replays
tests/support/recorded (real vendor pages) and tests/support/recorded_offers (SYNTHETIC TEST-ONLY
pages on *.example hosts)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from rivet_engine.ecommerce import (
    MultiRecordedFetcher,
    OfferSet,
    OffersProviderError,
    ProviderAuth,
    ProviderQuota,
    ProviderUnavailable,
    StubOffersProvider,
    find_offers,
    normalize_query,
)
from rivet_engine.ecommerce.extract_offer import detect_pack, extract_page, map_availability, money_string, rating_from_product
from rivet_engine.ecommerce.pipeline import HONESTY_NOTICE, NOT_FOUND_NOTICE, REFUSED_NOTICE, SYNTHETIC_NOTICE
from rivet_engine.ecommerce.providers import BraveSearchProvider, KeyedApiProvider, search_terms
from rivet_engine.ecommerce.scoring import WEIGHTS, load_weights
from rivet_engine.sourcing.extract import page_text
from rivet_engine.sourcing.fetch import FetchResult, RecordedFetcher, sha256_text
from tests import support
from tests.test_ecommerce_models import schema_errors

SUPPORT = Path(__file__).parent / "support"
RECORDED = SUPPORT / "recorded"
RECORDED_OFFERS = SUPPORT / "recorded_offers"
NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)
MV = dict(sku="TEST-MV-3801", mpn="MV3801", manufacturer="Maker Shop (TEST)")
INJECTION_URL = "https://www.adafruit.com/product/0000000-synthetic-injection-test"


@pytest.fixture(scope="module")
def fetcher() -> MultiRecordedFetcher:
    return MultiRecordedFetcher((RECORDED, RECORDED_OFFERS))


def run(fetcher, **kwargs) -> OfferSet:
    query = kwargs.pop("query", None) or normalize_query(**MV)
    offer_set = find_offers(query, mode="recorded", fetcher=fetcher, now=NOW, **kwargs)
    assert schema_errors(offer_set.to_wire()) == []
    return offer_set


def by_vendor(offer_set: OfferSet, vendor_id: str, *, sku: str | None = None):
    hits = [o for o in offer_set.offers if o.vendor.id == vendor_id and (sku is None or o.sku == sku)]
    assert hits, f"no offer from {vendor_id}"
    return hits[0]


def ledger(offer_set: OfferSet, status: str) -> list:
    return [e for e in offer_set.ledger if e.status == status]


# ---- recorded fixtures are honest ---------------------------------------------------------


def test_recorded_offer_pages_are_labelled_synthetic_and_hashed():
    index = json.loads((RECORDED_OFFERS / "index.json").read_text(encoding="utf-8"))
    assert index
    for url, entry in index.items():
        assert url.startswith("https://") and url.split("/")[2].endswith(".example"), url
        body = (RECORDED_OFFERS / entry["file"]).read_text(encoding="utf-8")
        assert "SYNTHETIC TEST-ONLY" in body
        assert sha256_text(body) == entry["content_sha256"]


# ---- case 1: SKU at several vendors -------------------------------------------------------


def test_case_1_sku_at_three_plus_vendors_is_ranked_and_verified(fetcher):
    offer_set = run(fetcher)
    assert offer_set.outcome == "partial"
    assert offer_set.synthetic is True and SYNTHETIC_NOTICE in offer_set.notices
    assert len({o.vendor.id for o in offer_set.offers}) >= 3
    for offer in offer_set.offers:
        assert offer.match.kind in ("exact_sku", "exact_mpn", "gtin")
        assert offer.match.evidence_quote and offer.evidence_level in ("verified", "stale")
        assert offer.source_sha256 and offer.fetched_at
    scores = [float(o.reliability.score) for o in offer_set.offers]
    assert scores == sorted(scores, reverse=True)
    assert offer_set.offers[0].vendor.id in ("maker-shop", "dist-one")
    assert HONESTY_NOTICE == offer_set.notices[-1]


def test_every_offer_field_traces_to_the_recorded_page(fetcher):
    offer_set = run(fetcher)
    index = json.loads((RECORDED_OFFERS / "index.json").read_text(encoding="utf-8"))
    for offer in offer_set.offers + offer_set.possible_matches:
        entry = index[offer.url]
        assert offer.source_sha256 == entry["content_sha256"]
        assert offer.fetched_at == entry["fetched_at"]
        body = (RECORDED_OFFERS / entry["file"]).read_text(encoding="utf-8")
        if offer.price_amount is not None:
            assert offer.price_amount.rstrip("0").rstrip(".") in body or offer.price_amount in body
        if offer.match.evidence_quote:
            haystacks = (body, page_text(body))
            assert any(offer.match.evidence_quote in h for h in haystacks)


# ---- cases 2, 3, 5: nothing found, SKU absent, prompt injection --------------------------


def test_case_2_unknown_sku_is_not_found_with_no_link(fetcher):
    offer_set = run(fetcher, query=normalize_query(sku="9999999"))
    assert offer_set.outcome == "not_found" and offer_set.offers == [] and offer_set.possible_matches == []
    adafruit = [e for e in offer_set.ledger if e.source == "adafruit"][0]
    assert adafruit.status == "not_found" and adafruit.reason == "HTTP 404" and adafruit.url == "https://www.adafruit.com/product/9999999"
    assert offer_set.notices == [NOT_FOUND_NOTICE]


def test_case_3_real_vendor_page_without_the_sku_is_dropped(fetcher):
    offer_set = run(fetcher, query=normalize_query(sku="2448"), candidate_urls=["https://www.adafruit.com/product/3801"])
    dropped = [e for e in offer_set.ledger if e.url == "https://www.adafruit.com/product/3801"]
    assert dropped and dropped[0].status == "dropped_no_identifier"
    assert all(o.url != "https://www.adafruit.com/product/3801" for o in offer_set.offers)


def test_case_3b_other_vendor_page_without_the_sku_is_dropped(fetcher):
    offer_set = run(fetcher)
    other = [e for e in offer_set.ledger if e.url == "https://dist-two.example/sku/other-part"]
    assert other[0].status == "dropped_no_identifier"


def test_case_5_prompt_injection_page_changes_nothing(fetcher):
    offer_set = run(fetcher, query=normalize_query(sku="FAKE-999"), candidate_urls=[INJECTION_URL])
    assert offer_set.outcome == "not_found" and offer_set.offers == [] and offer_set.possible_matches == []
    entry = [e for e in offer_set.ledger if e.url == INJECTION_URL][0]
    assert entry.status == "dropped_no_identifier" and "INJECT-1" in entry.reason
    assert "FAKE-999" not in json.dumps([o.to_wire() for o in offer_set.offers])


def test_case_5b_injection_page_does_not_verify_its_own_sku_for_another_query(fetcher):
    offer_set = run(fetcher, query=normalize_query(sku="3801", manufacturer="Adafruit"), candidate_urls=[INJECTION_URL])
    assert [o.url for o in offer_set.offers] == ["https://www.adafruit.com/product/3801"]
    assert offer_set.outcome == "found"


# ---- case 4: soft 404 ---------------------------------------------------------------------


def test_case_4_soft_404_page_is_dropped_never_in_stock(fetcher):
    offer_set = run(fetcher)
    entry = [e for e in offer_set.ledger if e.url == "https://soft404-vendor.example/test-mv-3801"][0]
    assert entry.status == "dropped_soft_404"
    assert all(o.url != entry.url for o in offer_set.offers + offer_set.possible_matches)


def test_soft_404_text_overrides_in_stock_jsonld():
    body = ('<html><head><script type="application/ld+json">{"@type":"Product","sku":"X-1","offers":{"@type":"Offer",'
            '"price":"2.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head>'
            "<body><h1>Product unavailable</h1><p>SKU: X-1</p></body></html>")
    page = extract_page(FetchResult("https://x.example/p", 200, body, "2026-10-24T00:00:00Z", sha256_text(body)))
    assert page.soft_404 and page.availability == "unknown"


# ---- case 6: price missing ----------------------------------------------------------------


def test_case_6_missing_price_is_null_not_zero(fetcher):
    offer = by_vendor(run(fetcher), "dist-two", sku="D2-77812")
    assert offer.price_amount is None and offer.currency == "USD" and offer.availability == "backorder"
    assert offer.match.kind == "exact_mpn" and offer.match.evidence_quote == '"mpn": "MV3801"'
    price_factor = [f for f in offer.reliability.factors if f.key == "price_outlier"][0]
    assert price_factor.value == 0.5 and "neutral" in price_factor.note


@pytest.mark.parametrize("raw, expected", [("4.5000", "4.50"), (14.95, "14.95"), ("12", "12.00"), ("0", None), ("0.00", None),
                                           ("-3", None), ("free", None), (None, None), ("1,299.99", "1299.99"), ("$4.50", "4.50")])
def test_money_strings_follow_the_contract(raw, expected):
    assert money_string(raw) == expected


def test_price_without_currency_is_dropped():
    body = ('<html><head><script type="application/ld+json">{"@type":"Product","sku":"X-2","offers":{"@type":"Offer","price":"2.00"}}'
            "</script></head><body>SKU: X-2</body></html>")
    page = extract_page(FetchResult("https://x.example/p", 200, body, "2026-10-24T00:00:00Z", sha256_text(body)))
    assert page.price is None and page.currency is None


# ---- case 7: mixed currencies -------------------------------------------------------------


def test_case_7_currencies_are_never_converted(fetcher):
    offer_set = run(fetcher)
    eur = by_vendor(offer_set, "eu-reseller")
    assert (eur.price_amount, eur.currency) == ("4.20", "EUR")
    assert any("does not convert currencies" in n for n in offer_set.notices)
    outlier_note = [f for f in eur.reliability.factors if f.key == "price_outlier"][0]
    assert outlier_note.value == 0.5 and "EUR" in outlier_note.note


# ---- case 8: pack size --------------------------------------------------------------------


def test_case_8_pack_variant_is_flagged_and_compared_per_unit(fetcher):
    offer_set = run(fetcher)
    pack = by_vendor(offer_set, "dist-one", sku="TEST-MV-3801-3PK")
    assert pack.pack.quantity == 3 and pack.pack.unit_price_basis == "per_pack" and pack.price_amount == "12.00"
    factor = [f for f in pack.reliability.factors if f.key == "price_outlier"][0]
    assert factor.value == 1.0 and "per unit" in factor.note


@pytest.mark.parametrize("name, sku, qty", [("Motor (3 pack)", None, 3), ("Pack of 10 LEDs", None, 10), ("Jumper wires x5", None, 5),
                                            ("LCD 16x2 character display", None, 1), ("Motor", "ABC-3PK", 3), ("Motor", "ABC", 1)])
def test_pack_detection(name, sku, qty):
    assert detect_pack(name, sku).quantity == qty


# ---- case 9: duplicates -------------------------------------------------------------------


def test_case_9_tracking_params_collapse_to_one_offer(fetcher):
    offer_set = run(fetcher)
    dist_one = [o for o in offer_set.offers if o.vendor.id == "dist-one" and o.sku == "TEST-MV-3801"]
    assert len(dist_one) == 1
    duplicates = ledger(offer_set, "duplicate")
    assert any("utm_source" in (e.url or "") for e in duplicates)


# ---- case 10: ratings ---------------------------------------------------------------------


def test_case_10_rating_absent_count_zero_and_single_review(fetcher):
    offer_set = run(fetcher)
    assert by_vendor(offer_set, "maker-shop", sku="TEST-MV-3801").rating is None
    single = by_vendor(offer_set, "bargain-bay")
    assert single.rating and single.rating.count == 1 and single.rating.value == 5.0
    factor = [f for f in single.reliability.factors if f.key == "rating"][0]
    many = [f for f in by_vendor(offer_set, "dist-one", sku="TEST-MV-3801").reliability.factors if f.key == "rating"][0]
    assert factor.value < 0.15 < many.value and "single review" in factor.note


def test_rating_count_zero_is_null():
    assert rating_from_product({"aggregateRating": {"ratingValue": "5", "ratingCount": 0}}) is None
    assert rating_from_product({"aggregateRating": {"ratingValue": "4.2", "reviewCount": "7", "bestRating": "10"}}).scale == 10
    assert rating_from_product({}) is None


# ---- case 11: stale -----------------------------------------------------------------------


def test_case_11_stale_page_is_labelled_and_penalised(fetcher):
    offer_set = run(fetcher)
    stale = [o for o in offer_set.offers if o.url == "https://dist-two.example/sku/test-mv-3801-old"][0]
    assert stale.status == "stale" and stale.evidence_level == "stale" and stale.fetched_at == "2026-08-20T12:00:00Z"
    freshness = [f for f in stale.reliability.factors if f.key == "freshness"][0]
    assert freshness.value < 0.5 and "65 days" in freshness.note
    assert any("stale" in n for n in offer_set.notices)


# ---- case 12: broken link -----------------------------------------------------------------


def test_case_12_broken_link_check_demotes_but_keeps_the_offer(fetcher):
    url = "https://maker-shop.example/p/test-mv-3801"
    offer_set = run(fetcher, link_checks={url: "broken"})
    offer = [o for o in offer_set.offers if o.url == url][0]
    assert offer.link_status == "broken" and offer.status == "demoted"
    assert [f for f in offer.reliability.factors if f.key == "link_status"][0].value == 0.0
    assert offer.reliability.score < by_vendor(offer_set, "dist-one", sku="TEST-MV-3801").reliability.score


# ---- case 13: blocked, 403/429, timeout, TLS ----------------------------------------------


class _FlakyFetcher:
    """Wraps the recorded fetcher and fails selected URLs the way the network would."""

    def __init__(self, inner, failures: dict[str, FetchResult]):
        self.inner = inner
        self.failures = failures

    @property
    def indexes(self):
        return self.inner.indexes

    def fetch(self, url: str) -> FetchResult:
        return self.failures.get(url) or self.inner.fetch(url)


def test_case_13_blocked_and_failed_sources_are_in_the_ledger_and_others_still_returned(fetcher):
    maker = "https://maker-shop.example/p/test-mv-3801"
    eu = "https://eu-reseller.example/products/test-mv-3801"
    flaky = _FlakyFetcher(fetcher, {
        maker: FetchResult.failure(maker, "disallowed by robots.txt", blocked=True),
        eu: FetchResult.failure(eu, "fetch failed: <urlopen error [SSL: CERTIFICATE_VERIFY_FAILED]>"),
    })
    offer_set = run(flaky)
    assert offer_set.outcome == "partial" and len(offer_set.offers) >= 3
    statuses = {e.url: e.status for e in offer_set.ledger if e.url}
    assert statuses[maker] == "blocked" and statuses[eu] == "error"
    assert statuses["https://blocked-vendor.example/test-mv-3801"] == "blocked"
    assert statuses["https://flaky-vendor.example/test-mv-3801"] == "error"
    assert any("results are partial" in n for n in offer_set.notices)


def test_http_429_and_timeout_map_to_blocked_and_error():
    from rivet_engine.ecommerce.pipeline import _fetch_problem

    assert _fetch_problem("x", FetchResult("https://x.example/a", 429, "", "2026-10-24T00:00:00Z", sha256_text(""))).status == "blocked"
    assert _fetch_problem("x", FetchResult.failure("https://x.example/a", "fetch failed: timed out")).status == "error"
    assert _fetch_problem("x", FetchResult("https://x.example/a", 410, "", "2026-10-24T00:00:00Z", sha256_text(""))).status == "not_found"


# ---- case 14: provider quota / auth / outage ----------------------------------------------


class _FailingSearch:
    name = "brave-search"
    disabled_reason = None

    def __init__(self, exc: OffersProviderError):
        self.exc = exc

    def search(self, query):
        raise self.exc


@pytest.mark.parametrize("exc", [ProviderQuota("brave-search", "HTTP 429"), ProviderAuth("brave-search", "HTTP 401"),
                                 ProviderUnavailable("brave-search", "timed out")])
def test_case_14_provider_failure_with_other_results_is_partial_with_a_notice(fetcher, exc):
    offer_set = run(fetcher, search_provider=_FailingSearch(exc),
                    candidate_urls=["https://maker-shop.example/p/test-mv-3801", "https://dist-one.example/item/test-mv-3801"])
    assert offer_set.outcome == "partial" and len(offer_set.offers) == 2
    entry = [e for e in offer_set.ledger if e.source == "brave-search"][0]
    assert entry.status == "error" and exc.code in entry.reason
    assert any(exc.code in n for n in offer_set.notices)


def test_case_14b_provider_failure_with_nothing_else_raises_the_typed_error(fetcher):
    with pytest.raises(ProviderQuota) as caught:
        find_offers(normalize_query(sku="ZZZ-NOPE"), mode="recorded", fetcher=fetcher, now=NOW,
                    search_provider=_FailingSearch(ProviderQuota("brave-search", "HTTP 429")))
    assert isinstance(caught.value, OffersProviderError) and caught.value.code == "PROVIDER_QUOTA"


def test_brave_without_key_is_skipped_never_faked(fetcher, monkeypatch):
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    provider = BraveSearchProvider()
    assert provider.disabled_reason == "BRAVE_SEARCH_API_KEY not set"
    offer_set = run(fetcher, search_provider=provider, candidate_urls=["https://maker-shop.example/p/test-mv-3801"])
    entry = [e for e in offer_set.ledger if e.source == "brave-search"][0]
    assert entry.status == "skipped" and entry.reason == "BRAVE_SEARCH_API_KEY not set"
    assert search_terms(normalize_query(**MV))[0] == '"TEST-MV-3801" Maker Shop (TEST) buy'


def test_keyed_apis_report_needs_api_key(fetcher, monkeypatch):
    for var in ("NEXAR_CLIENT_ID", "ELEMENT14_API_KEY", "MOUSER_API_KEY", "DIGIKEY_CLIENT_ID"):
        monkeypatch.delenv(var, raising=False)
    offer_set = run(fetcher)
    reasons = {e.source: e.reason for e in ledger(offer_set, "needs_api_key")}
    assert reasons == {"mouser-api": "MOUSER_API_KEY not set", "digikey-api": "DIGIKEY_CLIENT_ID not set",
                       "octopart-api": "NEXAR_CLIENT_ID not set", "element14-api": "ELEMENT14_API_KEY not set"}
    monkeypatch.setenv("NEXAR_CLIENT_ID", "x")
    assert KeyedApiProvider("octopart-api", "NEXAR_CLIENT_ID").lookup(normalize_query(**MV), fetcher)[0].status == "unsupported"


# ---- case 15: marketplace outlier ---------------------------------------------------------


def test_case_15_marketplace_price_far_below_median_is_demoted(fetcher):
    offer_set = run(fetcher)
    cheap = by_vendor(offer_set, "bargain-bay")
    assert cheap.vendor.tier == "marketplace" and cheap.price_amount == "0.99" and cheap.status == "demoted"
    factor = [f for f in cheap.reliability.factors if f.key == "price_outlier"][0]
    assert factor.value == 0.0 and "below" in factor.note
    assert cheap.offer_id == offer_set.offers[-1].offer_id
    assert any("demoted" in n for n in offer_set.notices)


# ---- case 16: discontinued with alternative ----------------------------------------------


def test_case_16_discontinued_part_lists_the_linked_replacement_separately(fetcher):
    offer_set = run(fetcher, query=normalize_query(sku="TEST-MV-3800"))
    assert offer_set.outcome == "found"
    assert [(o.sku, o.availability) for o in offer_set.offers] == [("TEST-MV-3800", "discontinued")]
    assert [(o.sku, o.availability) for o in offer_set.alternatives] == [("TEST-MV-3801", "in_stock")]
    assert offer_set.alternatives[0].match.evidence_quote == '"sku": "TEST-MV-3801"'
    assert any("discontinued" in n for n in offer_set.notices)


@pytest.mark.parametrize("raw, expected", [("https://schema.org/InStock", "in_stock"), ("http://schema.org/OutOfStock", "out_of_stock"),
                                           ("BackOrder", "backorder"), ("https://schema.org/PreOrder", "backorder"),
                                           ("https://schema.org/Discontinued", "discontinued"), (None, "unknown"), ("whatever", "unknown")])
def test_schema_org_availability_mapping(raw, expected):
    assert map_availability(raw) == expected


# ---- case 17: fuzzy only ------------------------------------------------------------------


def test_case_17_fuzzy_match_is_only_a_possible_match(fetcher):
    offer_set = run(fetcher)
    fuzzy = [o for o in offer_set.possible_matches if o.sku == "MV-3801-COMPAT"]
    assert len(fuzzy) == 1 and fuzzy[0].match.kind == "fuzzy" and fuzzy[0].match.confidence < 0.6
    assert fuzzy[0].evidence_level == "inferred" and fuzzy[0].match.evidence_quote is None
    assert all(o.sku != "MV-3801-COMPAT" for o in offer_set.offers)


def test_case_17b_fuzzy_only_result_is_not_found(fetcher):
    offer_set = run(fetcher, query=normalize_query(sku="TEST-MV-3801"), structured_providers=[],
                    search_provider=_StaticSearch(["https://bargain-bay.example/listing/77001"]))
    assert offer_set.outcome == "not_found" and offer_set.offers == [] and len(offer_set.possible_matches) == 1


class _StaticSearch:
    name = "static-search"
    disabled_reason = None

    def __init__(self, urls):
        self.urls = urls

    def search(self, query):
        return list(self.urls)


# ---- case 19: synthetic demo part --------------------------------------------------------


@pytest.mark.parametrize("mode", ["stub", "recorded", "live"])
def test_case_19_demo_part_is_refused_without_any_search(mode):
    class Explode:
        def fetch(self, url):
            raise AssertionError("a demo.* part must never be fetched")

    offer_set = find_offers(normalize_query(sku="DEMO-1", catalog_id="demo.tt_motor"), mode=mode, fetcher=Explode(), now=NOW)
    assert schema_errors(offer_set.to_wire()) == []
    assert offer_set.outcome == "refused" and offer_set.offers == [] and offer_set.notices == [REFUSED_NOTICE]
    assert offer_set.ledger[0].source == "catalog" and offer_set.ledger[0].status == "skipped"


def test_refused_fixture_matches_the_pipeline_shape():
    expected = json.loads((support.SHARED_FIXTURES / "offers" / "refused-synthetic-demo-part.json").read_text(encoding="utf-8"))
    actual = find_offers(normalize_query(catalog_id="demo.tt_motor"), mode="stub", now=datetime(2026, 10, 24, 12, tzinfo=timezone.utc)).to_wire()
    assert actual == expected


# ---- case 20 / 21 at the pipeline boundary ----------------------------------------------


def test_case_20_non_https_candidates_are_skipped_not_fetched(fetcher):
    offer_set = run(fetcher, candidate_urls=["javascript:alert(1)", "http://maker-shop.example/p/test-mv-3801"])
    skipped = [e for e in offer_set.ledger if e.status == "skipped" and "https" in e.reason]
    assert len(skipped) == 2 and all(e.url is None for e in skipped)
    assert all(o.url.startswith("https://") for o in offer_set.offers)


def test_case_21_whitespace_and_case_variants_give_the_same_set(fetcher):
    a = run(fetcher, query=normalize_query(sku=" test-mv-3801 ", mpn="mv3801", manufacturer="maker shop (test)"))
    b = run(fetcher)
    assert a.query.normalized_key == b.query.normalized_key
    assert [o.offer_id for o in a.offers] == [o.offer_id for o in b.offers]


def test_gtin_query_matches_on_the_jsonld_gtin13(fetcher):
    offer_set = run(fetcher, query=normalize_query(gtin="4006381333931"))
    assert [(o.vendor.id, o.match.kind) for o in offer_set.offers] == [("dist-one", "gtin")]


# ---- real recorded vendor pages match the reference fixtures ----------------------------


def test_adafruit_3801_recorded_matches_the_reference_fixture(fetcher):
    expected = json.loads((support.SHARED_FIXTURES / "offers" / "adafruit-3801.json").read_text(encoding="utf-8"))
    offer_set = run(fetcher, query=normalize_query(sku="3801", manufacturer="Adafruit", catalog_id="motor.adafruit_tt_bimetal_1to90_3801"))
    assert offer_set.outcome == "found"
    actual = offer_set.offers[0].to_wire()
    for key in ("offer_id", "sku", "vendor", "url", "price_amount", "currency", "availability", "pack", "rating", "match",
                "fetched_at", "evidence_level", "link_status", "status", "source_sha256"):
        assert actual[key] == expected["offers"][0][key], key
    assert actual["reliability"]["score"] == expected["offers"][0]["reliability"]["score"]


def test_sparkfun_13301_recorded_has_price_but_unknown_stock(fetcher):
    expected = json.loads((support.SHARED_FIXTURES / "offers" / "sparkfun-rob-13301.json").read_text(encoding="utf-8"))
    offer_set = run(fetcher, query=normalize_query(sku="ROB-13301", manufacturer="SparkFun"))
    actual = offer_set.offers[0].to_wire()
    for key in ("offer_id", "sku", "mpn", "price_amount", "currency", "availability", "match", "source_sha256"):
        assert actual[key] == expected["offers"][0][key], key
    assert "Stock status was not stated on the vendor page." in offer_set.notices


# ---- stub provider ------------------------------------------------------------------------


@pytest.mark.parametrize("path", sorted((support.SHARED_FIXTURES / "offers").glob("*.json")), ids=lambda p: p.name)
def test_stub_mode_returns_the_fixture_byte_equivalent(path):
    doc = json.loads(path.read_text(encoding="utf-8"))
    query = OfferSet.model_validate(doc).query
    assert find_offers(query, mode="stub").to_wire() == doc


def test_stub_mode_unknown_key_is_not_found_without_a_lookup():
    offer_set = find_offers(normalize_query(sku="NOT-IN-FIXTURES"), mode="stub", now=NOW)
    assert offer_set.outcome == "not_found" and offer_set.provider_mode == "stub" and offer_set.offers == []
    assert offer_set.ledger[0].status == "not_found" and schema_errors(offer_set.to_wire()) == []
    assert "3801|||adafruit" in StubOffersProvider().keys


# ---- weights ------------------------------------------------------------------------------


def test_weights_sum_to_one_and_cover_every_factor():
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9
    assert set(WEIGHTS) == {"vendor_tier", "match_exactness", "freshness", "link_status", "rating", "price_outlier"}
    assert load_weights() == WEIGHTS


def test_recorded_fetcher_alone_still_works_for_the_offer_pages():
    single = RecordedFetcher(RECORDED_OFFERS)
    offer_set = find_offers(normalize_query(**MV), mode="recorded", fetcher=single, now=NOW,
                            candidate_urls=["https://maker-shop.example/p/test-mv-3801"])
    assert [o.vendor.id for o in offer_set.offers] == ["maker-shop"]
    assert [e.source for e in offer_set.ledger if e.status == "skipped" and "recorded index" in e.reason] == ["brave-search"]


def _page(url: str, html: str) -> FetchResult:
    return FetchResult(url, 200, html, "2026-10-24T12:00:00Z", sha256_text(html))


@pytest.mark.parametrize(
    "url, html",
    [
        ("https://stores.bestbuy.example/or/salem/3801-center-st-ne-453.html",
         "<html><title>Best Buy in Salem, OR - 3801 Center St NE</title><body>Electronics, Appliances and More at 3801 Center St NE</body></html>"),
        ("https://www.walmart.example/ip/CSF-3801-radiator/961497011",
         "<html><title>CSF 3801 1 Row Plastic Tank Aluminum Core Radiator</title><body>CSF 3801 radiator. Buy now $129.00</body></html>"),
        ("https://www.eatonrealty.example/buy/99282/3801-bayshore-blvd",
         "<html><title>3801 bayshore blvd</title><body>Home Buying 3801 bayshore blvd Real Estate Simplified</body></html>"),
        ("https://scctelcom.example/product/bvmgl10hra",
         "<html><title>Buy or Repair Part # 170-3801-901-A</title><body>Part # 170-3801-901-A for sale</body></html>"),
    ],
)
def test_live_regression_bare_number_in_unrelated_text_is_not_an_offer(url, html):
    """Seen on the first live run: a street address, a radiator model and a listing id all contain 3801."""
    from rivet_engine.ecommerce.verify_offer import decide
    from rivet_engine.ecommerce.vendors import vendor_for_url

    decision = decide(normalize_query(sku="3801", manufacturer="Adafruit"), extract_page(_page(url, html)), _page(url, html), vendor_for_url(url))
    assert not decision.accepted, (url, decision.reason)


def test_text_only_page_is_a_possible_match_when_labelled_or_branded_never_a_ranked_offer():
    from rivet_engine.ecommerce.verify_offer import decide
    from rivet_engine.ecommerce.vendors import vendor_for_url

    labelled = _page("https://shop.example/p/3801", "<html><body>TT Gearmotor. SKU: 3801. $4.50</body></html>")
    branded = _page("https://shop.example/p/tt", "<html><body>Adafruit TT Gearmotor 3801, 4.50 USD</body></html>")
    bare = _page("https://shop.example/p/x", "<html><body>Gearmotor 3801</body></html>")
    q = normalize_query(sku="3801", manufacturer="Adafruit")
    for page in (labelled, branded):
        decision = decide(q, extract_page(page), page, vendor_for_url(page.url))
        assert decision.accepted and decision.kind == "fuzzy" and decision.evidence_quote
    assert not decide(q, extract_page(bare), bare, vendor_for_url(bare.url)).accepted


def test_live_regression_another_makers_sku_number_is_not_a_match():
    """Seen on the second live run: Adafruit product 2130 verified against a query for Pololu 2130."""
    from rivet_engine.ecommerce.verify_offer import decide
    from rivet_engine.ecommerce.vendors import vendor_for_url

    html = '<html><script type="application/ld+json">{"@type":"Product","name":"Something else","sku":2130,"offers":{"@type":"Offer","price":"3.95","priceCurrency":"USD"}}</script><body>Something else</body></html>'
    page = _page("https://www.adafruit.com/product/2130", html)
    decision = decide(normalize_query(sku="2130", manufacturer="Pololu"), extract_page(page), page, vendor_for_url(page.url))
    assert not decision.accepted and "Pololu" in decision.reason
    same_maker = decide(normalize_query(sku="2130", manufacturer="Adafruit"), extract_page(page), page, vendor_for_url(page.url))
    assert same_maker.accepted and same_maker.kind == "exact_sku"
    branded = '<html><script type="application/ld+json">{"@type":"Product","name":"DRV8833 carrier","sku":2130,"brand":{"@type":"Brand","name":"Pololu"}}</script><body>Pololu DRV8833</body></html>'
    dist = _page("https://www.digikey.com/en/products/detail/pololu/2130/1", branded)
    assert decide(normalize_query(sku="2130", manufacturer="Pololu"), extract_page(dist), dist, vendor_for_url(dist.url)).accepted
