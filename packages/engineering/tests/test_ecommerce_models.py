"""rivet_engine.ecommerce models, identifiers and vendors against contracts/offer.schema.json
(docs/e-commerce-layer/plan.md 3.1, test plan cases 9, 10, 19, 20, 21)."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from rivet_engine.ecommerce import InvalidIdentifier, Offer, OfferSet, canonical_url, normalize_query, offer_id, vendor_for_url
from rivet_engine.ecommerce.identifiers import InvalidUrl, dedupe_key, is_synthetic_catalog_id, validate_gtin
from rivet_engine.ecommerce.models import Match, Rating
from rivet_engine.ecommerce.vendors import is_denylisted
from tests import support

OFFER_FIXTURES = sorted((support.SHARED_FIXTURES / "offers").glob("*.json"))


@cache
def offer_validator() -> Draft202012Validator:
    schema = json.loads((support.REPO_ROOT / "contracts" / "offer.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def schema_errors(doc: dict) -> list[str]:
    wire = json.loads(json.dumps(doc))
    return [f"{e.json_path}: {e.message}" for e in sorted(offer_validator().iter_errors(wire), key=lambda e: e.json_path)]


def fixture_offer(name: str = "adafruit-3801.json") -> dict:
    return json.loads((support.SHARED_FIXTURES / "offers" / name).read_text(encoding="utf-8"))["offers"][0]


# ---- models mirror the contract -----------------------------------------------------------


@pytest.mark.parametrize("path", OFFER_FIXTURES, ids=lambda p: p.name)
def test_reference_fixtures_round_trip_byte_equivalent(path: Path):
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert schema_errors(doc) == []
    wire = OfferSet.model_validate(doc).to_wire()
    assert wire == doc
    assert json.dumps(wire, sort_keys=True) == json.dumps(doc, sort_keys=True)


@pytest.mark.parametrize("mutate, message", [
    (lambda o: o.update(url="javascript:alert(1)"), "https"),
    (lambda o: o.update(url="http://www.adafruit.com/product/3801"), "https"),
    (lambda o: o.update(price_amount="0"), "positive decimal"),
    (lambda o: o.update(price_amount="0.00"), "positive decimal"),
    (lambda o: o.update(price_amount="-4.50"), "positive decimal"),
    (lambda o: o.update(price_amount="4.50", currency=None), "needs a currency"),
    (lambda o: o["match"].update(kind="fuzzy"), "never a fuzzy"),
    (lambda o: o["match"].update(evidence_quote=None), "needs an evidence_quote"),
    (lambda o: o.update(rating={"value": 5.0, "count": 0, "scale": 5, "source": "jsonld_aggregate_rating"}), "count"),
    (lambda o: o.update(availability="plenty"), "availability"),
    (lambda o: o.update(fetched_at="2026-10-24 18:48"), "fetched_at"),
    (lambda o: o.update(source_sha256="abc"), "source_sha256"),
    (lambda o: o.update(extra="x"), "extra"),
], ids=["javascript-url", "http-url", "zero-price", "zero-decimal-price", "negative-price", "price-without-currency",
        "verified-fuzzy", "exact-without-quote", "rating-count-0", "bad-availability",
        "bad-timestamp", "bad-sha", "extra-key"])
def test_offer_model_rejects_what_the_schema_rejects(mutate, message):
    doc = fixture_offer()
    mutate(doc)
    with pytest.raises(ValidationError) as caught:
        Offer.model_validate(doc)
    assert message.lower() in str(caught.value).lower()
    assert schema_errors({**json.loads((OFFER_FIXTURES[0]).read_text()), "offers": [doc]}) != []


def test_offer_id_must_start_with_the_vendor_id():
    with pytest.raises(ValidationError, match="start with the vendor id"):
        Offer.model_validate({**fixture_offer(), "offer_id": "sparkfun:1e23de30a1c22803"})


def test_fuzzy_match_may_lack_a_quote_but_exact_may_not():
    assert Match(kind="fuzzy", confidence=0.4, evidence_quote=None).evidence_quote is None
    with pytest.raises(ValidationError):
        Match(kind="exact_mpn", confidence=1.0, evidence_quote=None)


def test_offer_set_keeps_fuzzy_matches_out_of_the_ranked_list():
    doc = json.loads(OFFER_FIXTURES[0].read_text(encoding="utf-8"))
    fuzzy = {**doc["offers"][0], "match": {"kind": "fuzzy", "confidence": 0.3, "evidence_quote": None}, "evidence_level": "inferred"}
    with pytest.raises(ValidationError):
        OfferSet.model_validate({**doc, "offers": [fuzzy]})


def test_rating_scale_defaults_to_five():
    assert Rating(value=4.5, count=3, source="vendor_api").scale == 5


# ---- identifiers (case 21) ----------------------------------------------------------------


def test_normalize_query_folds_unicode_whitespace_and_case():
    query = normalize_query(sku="  ＲＯＢ-13301 ", mpn="rob\u00a013301", manufacturer="SparkFun\t Electronics")
    assert query.sku == "ROB-13301"
    assert query.mpn == "rob 13301"
    assert query.manufacturer == "SparkFun Electronics"
    assert query.normalized_key == "rob-13301|rob 13301||sparkfun electronics"


def test_normalized_key_matches_the_reference_fixtures():
    assert normalize_query(sku="3801", manufacturer="Adafruit").normalized_key == "3801|||adafruit"
    assert normalize_query(sku="TEST-MV-3801", mpn="MV3801", manufacturer="Maker Shop (TEST)").normalized_key == "test-mv-3801|mv3801||maker shop (test)"
    assert normalize_query(catalog_id="demo.tt_motor").normalized_key == "|||"


@pytest.mark.parametrize("gtin", ["4006381333931", "012345678905", "96385074", "00012345678905", "4006381-333931"])
def test_valid_gtins_pass_the_check_digit(gtin):
    assert validate_gtin(gtin) == gtin.replace("-", "")


@pytest.mark.parametrize("gtin", ["4006381333932", "012345678901", "1234567", "abc", "123456789"])
def test_invalid_gtins_are_rejected(gtin):
    with pytest.raises(InvalidIdentifier) as caught:
        normalize_query(gtin=gtin)
    assert caught.value.code == "INVALID_IDENTIFIER"


def test_empty_query_without_catalog_id_is_invalid():
    with pytest.raises(InvalidIdentifier):
        normalize_query(sku="   ")


def test_identifier_with_pipe_or_too_long_is_invalid():
    with pytest.raises(InvalidIdentifier):
        normalize_query(sku="a|b")
    with pytest.raises(InvalidIdentifier):
        normalize_query(sku="x" * 65)


def test_synthetic_catalog_ids_are_recognised():
    assert is_synthetic_catalog_id("demo.tt_motor") and is_synthetic_catalog_id("synthetic.motor_eur")
    assert not is_synthetic_catalog_id("motor.adafruit_tt_bimetal_1to90_3801") and not is_synthetic_catalog_id(None)


# ---- canonical URLs (cases 9, 20) ---------------------------------------------------------


def test_canonical_url_drops_tracking_fragments_and_sorts_the_rest():
    url = "https://Dist-One.example/item/test-mv-3801/?utm_source=x&b=2&a=1&fbclid=abc&ref=aff#top"
    assert canonical_url(url) == "https://dist-one.example/item/test-mv-3801?a=1&b=2"


def test_canonical_url_keeps_www_so_offer_ids_match_the_fixtures():
    assert offer_id("adafruit", "https://www.adafruit.com/product/3801?utm_source=x") == "adafruit:1e23de30a1c22803"
    assert offer_id("sparkfun", "https://www.sparkfun.com/products/13301") == "sparkfun:6393a5ed7848e5b9"
    assert dedupe_key("https://www.adafruit.com/product/3801") == dedupe_key("https://adafruit.com/product/3801/")


@pytest.mark.parametrize("bad", ["javascript:alert(1)", "http://www.adafruit.com/product/3801", "data:text/html,x", "https:///nohost", "ftp://x.example/a"])
def test_non_https_urls_are_rejected(bad):
    with pytest.raises(InvalidUrl):
        canonical_url(bad)


# ---- vendors --------------------------------------------------------------------------------


@pytest.mark.parametrize("url, vendor_id, tier", [
    ("https://www.adafruit.com/product/3801", "adafruit", "manufacturer"),
    ("https://www.digikey.com/en/products/detail/x", "digikey", "authorized_distributor"),
    ("https://www.amazon.com/dp/B000", "amazon", "marketplace"),
    ("https://www.ebay.co.uk/itm/1", "ebay", "marketplace"),
    ("https://bargain-bay.example/listing/1", "bargain-bay", "marketplace"),
    ("https://shop.unknown-vendor.co.uk/p/1", "unknown-vendor.co.uk", "unknown"),
    ("https://www.ti.com/product/DRV8833", "ti.com", "manufacturer"),
])
def test_vendor_registry_and_unknown_hosts(url, vendor_id, tier):
    vendor = vendor_for_url(url)
    assert (vendor.id, vendor.tier) == (vendor_id, tier)


def test_denylist_drops_aggregators_and_affiliate_hosts():
    assert is_denylisted("https://www.octopart.com/x") and is_denylisted("https://affiliate-spam.example/best-price")
    assert not is_denylisted("https://www.adafruit.com/product/3801")
