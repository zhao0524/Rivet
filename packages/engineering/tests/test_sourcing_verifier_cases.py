"""Verification edge cases from PR #89, ported onto the lane B verifier in `sourcing/evidence.py`.

Offline and pure: each record carries its own quote (`matched_text`); nothing is fetched.
The rules here are also enforced by the API (`rivet_api/resolution/evidence.py:assess`) and the
web UI (`src/lib/resolve/verify.ts`), so the engine must agree with them.
"""

from datetime import datetime, timedelta, timezone

import pytest

from rivet_engine.sourcing import Evidence, tier_for_url, verify, verify_product

NOW = datetime(2026, 10, 24, 18, 0, 0, tzinfo=timezone.utc)
FETCHED = "2026-10-24T12:00:00Z"
SHA = "a" * 64
SKU = "DJI-MINI4-FMC"
MFR = "https://www.dji.com/mini-4/specs"
DIST = "https://www.digikey.com/en/products/detail/dji-mini4-fmc"
DIST2 = "https://www.mouser.com/ProductDetail/DJI-MINI4-FMC"
TEARDOWN = "https://www.ifixit.com/Teardown/DJI+Mini+4"
COMMUNITY = "https://www.reddit.com/r/dji/comments/abc"


def ev(url, tier, matched, *, claim="sku", value=SKU, extractor="jsonld", fetched=FETCHED, ttl=14):
    return Evidence(
        claim=claim,
        value=value,
        source_url=url,
        source_host_tier=tier,
        fetched_at=fetched,
        content_sha256=SHA,
        extractor=extractor,
        matched_text=matched,
        ttl_days=ttl,
    )


def mfr(**kw):
    return ev(MFR, "manufacturer", f"SKU: {SKU}", **kw)


@pytest.mark.parametrize(
    ("url", "tier"),
    [
        (MFR, "manufacturer"),
        (DIST, "distributor"),
        ("https://api.mouser.com/api/v1/search", "distributor"),
        (TEARDOWN, "teardown"),
        (COMMUNITY, "community"),
        ("https://forum.arduino.cc/t/123", "community"),  # longest suffix wins over arduino.cc
        ("https://store.arduino.cc/products/uno", "manufacturer"),
    ],
)
def test_allowlist_tiers(url, tier):
    assert tier_for_url(url) == tier


@pytest.mark.parametrize(
    "url",
    [
        "http://www.dji.com/mini-4",  # not https
        "https://dji.com.evil.example/mini-4",  # lookalike suffix
        "https://evildji.com/mini-4",  # lookalike prefix
        "https://user:pass@example.com/x",  # unlisted host behind credentials
        "https://unknown-shop.example/item",
    ],
)
def test_allowlist_rejects_lookalikes_and_non_https(url):
    assert tier_for_url(url) is None


def test_manufacturer_and_distributor_pages_with_the_exact_sku_verify():
    assert verify("sku", [mfr()], now=NOW).status == "verified"
    assert verify("sku", [ev(DIST, "distributor", f"Mfr part # {SKU}")], now=NOW).status == "verified"


def test_two_agreeing_sources_stay_verified_and_other_claims_are_ignored():
    records = [mfr(), ev(DIST, "distributor", SKU), ev(DIST, "distributor", "$129.00", claim="price", value="$129.00")]
    v = verify("sku", records, now=NOW)
    assert v.status == "verified" and len(v.evidence) == 2


def test_fabricated_sku_on_an_unlisted_host_is_never_verified():
    fake = ev("https://dji-deals.example/x", "manufacturer", f"SKU: {SKU}")
    assert verify("sku", [fake], now=NOW).status == "not_found"


def test_page_that_does_not_quote_the_sku_is_not_found():
    assert verify("sku", [ev(MFR, "manufacturer", "DJI Mini 4 Pro, Fly More Combo")], now=NOW).status == "not_found"
    assert verify("sku", [ev(MFR, "manufacturer", None)], now=NOW).status == "not_found"


def test_sku_that_is_only_part_of_a_longer_page_sku_is_not_found():
    # "AB-12" must not be found inside "AB-123" (whole token, as the API and UI require).
    v = verify("sku", [ev(MFR, "manufacturer", "SKU: AB-123", value="AB-12")], now=NOW)
    assert v.status == "not_found"
    assert verify("sku", [ev(MFR, "manufacturer", "SKU: AB-12 (black)", value="AB-12")], now=NOW).status == "verified"


def test_brand_mismatch_is_not_found():
    records = [mfr(), ev(MFR, "manufacturer", "Brand: Autel", claim="brand", value="Autel")]
    assert verify_product(records, sku=SKU, brand="DJI", now=NOW)["sku"].status == "not_found"


def test_declared_tier_must_match_the_allowlist():
    lying = ev(TEARDOWN, "manufacturer", f"SKU: {SKU}")
    assert verify("sku", [lying], now=NOW).status == "not_found"


def test_llm_extract_alone_is_inferred_but_with_a_deterministic_extractor_verifies():
    llm = mfr(extractor="llm-extract")
    assert verify("sku", [llm], now=NOW).status == "inferred"
    assert verify("sku", [llm, mfr()], now=NOW).status == "verified"


def test_page_text_extractor_verifies_like_jsonld():
    assert verify("sku", [mfr(extractor="page-text")], now=NOW).status == "verified"


def test_teardown_is_inferred_only_and_community_never_supports_a_claim():
    assert verify("sku", [ev(TEARDOWN, "teardown", f"Model {SKU}")], now=NOW).status == "inferred"
    assert verify("sku", [ev(COMMUNITY, "community", f"I bought {SKU}")], now=NOW).status == "not_found"


def test_expired_evidence_is_stale():
    old = mfr(fetched="2026-09-01T00:00:00Z", ttl=14)
    assert verify("sku", [old], now=NOW).status == "stale"


def test_evidence_exactly_at_its_ttl_is_still_fresh_and_one_second_later_is_stale():
    # Same boundary as the API (`now - fetched > ttl` is stale).
    fetched = datetime(2026, 10, 10, 18, 0, 0, tzinfo=timezone.utc)
    record = mfr(fetched=fetched.strftime("%Y-%m-%dT%H:%M:%SZ"), ttl=14)
    assert verify("sku", [record], now=fetched + timedelta(days=14)).status == "verified"
    assert verify("sku", [record], now=fetched + timedelta(days=14, seconds=1)).status == "stale"


def test_fresh_evidence_wins_over_stale_evidence_for_the_same_value():
    assert verify("sku", [mfr(fetched="2026-01-01T00:00:00Z"), mfr()], now=NOW).status == "verified"


def test_disagreeing_prices_are_a_conflict_and_never_averaged():
    a = ev(DIST, "distributor", "Price $129.00", claim="price", value="$129.00")
    b = ev(DIST2, "distributor", "Price $139.00", claim="price", value="$139.00")
    v = verify("price", [a, b], now=NOW)
    assert v.status == "conflict" and v.value is None


def test_teardown_disagreeing_with_the_manufacturer_is_a_conflict():
    other = ev(TEARDOWN, "teardown", "Model DJI-MINI4-STD", value="DJI-MINI4-STD")
    assert verify("sku", [mfr(), other], now=NOW).status == "conflict"


def test_unusable_disagreeing_source_does_not_create_a_conflict():
    unlisted = ev("https://dji-deals.example/x", "distributor", "SKU: DJI-OTHER", value="DJI-OTHER")
    assert verify("sku", [mfr(), unlisted], now=NOW).status == "verified"


def test_verdict_serializes_to_json():
    dumped = verify("sku", [mfr()], now=NOW).model_dump(mode="json")
    assert dumped["status"] == "verified" and dumped["evidence"][0]["source_url"] == MFR
