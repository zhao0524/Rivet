"""Offer models mirror contracts/offer.schema.json; packaged fixtures mirror fixtures/offers/."""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from rivet_api.config import Settings
from rivet_api.offers.models import InvalidIdentifier, Offer, OfferQuery, OfferSearchRequest, OfferSet
from rivet_api.offers.stub import FIXTURE_DIR

REPO = Path(__file__).resolve().parents[3]
SHARED = REPO / "fixtures" / "offers"
SCHEMA = Draft202012Validator(json.loads((REPO / "contracts" / "offer.schema.json").read_text()))
FIXTURE_NAMES = sorted(p.name for p in SHARED.glob("*.json"))


def load(name: str) -> dict:
    return json.loads((SHARED / name).read_text())


def offer_dict() -> dict:
    return load("synthetic-multivendor.json")["offers"][0]


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_packaged_offer_fixture_matches_shared_fixture(name):
    assert json.loads((FIXTURE_DIR / name).read_text()) == load(name)


def test_five_fixtures_are_mirrored():
    assert FIXTURE_NAMES == sorted(p.name for p in FIXTURE_DIR.glob("*.json")) and len(FIXTURE_NAMES) == 5


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_fixture_round_trips_through_the_model_and_schema(name):
    data = load(name)
    SCHEMA.validate(data)
    assert OfferSet.model_validate(data).model_dump(mode="json") == data


@pytest.mark.parametrize(
    "patch",
    [
        {"price_amount": "4.50", "currency": None},
        {"price_amount": "0"},
        {"price_amount": "0.00"},
        {"price_amount": 4.5},
        {"url": "http://maker-shop.example/p/test-mv-3801"},
        {"url": "javascript:alert(1)"},
        {"match": {"kind": "exact_sku", "confidence": 1.0, "evidence_quote": None}},
        {"evidence_level": "verified", "match": {"kind": "fuzzy", "confidence": 0.5, "evidence_quote": None}},
        {"rating": {"value": 4.0, "count": 0, "scale": 5, "source": "jsonld_aggregate_rating"}},
        {"extra_field": True},
    ],
)
def test_offer_rejects_what_the_schema_rejects(patch):
    bad = {**offer_dict(), **patch}
    with pytest.raises(ValidationError):
        Offer.model_validate(bad)
    assert not SCHEMA.is_valid({**load("synthetic-multivendor.json"), "offers": [bad]})


def test_offer_set_rejects_fuzzy_match_in_ranked_offers():
    data = load("synthetic-multivendor.json")
    with pytest.raises(ValidationError):
        OfferSet.model_validate({**data, "offers": data["possible_matches"]})


def test_normalized_key_collapses_case_and_whitespace():
    q = OfferQuery.build(sku="  Test-MV-3801 ", mpn="mv3801\t", manufacturer="Maker   Shop (TEST)")
    assert q.normalized_key == "test-mv-3801|mv3801||maker shop (test)"
    assert q.sku == "Test-MV-3801"


def test_fullwidth_digits_normalise_to_the_same_key():
    assert OfferQuery.build(sku="３８０１").normalized_key == OfferQuery.build(sku="3801").normalized_key


@pytest.mark.parametrize("gtin", ["012345678905", "0 12345 67890 5", "4006381333931", "96385074", "00012345678905"])
def test_gtin_with_a_correct_check_digit_is_accepted(gtin):
    assert OfferQuery.build(gtin=gtin).gtin == gtin.replace(" ", "")


@pytest.mark.parametrize("gtin", ["012345678904", "4006381333932", "1234567", "abc", "   "])
def test_gtin_with_a_bad_check_digit_or_shape_is_rejected(gtin):
    with pytest.raises(InvalidIdentifier):
        OfferQuery.build(gtin=gtin)


@pytest.mark.parametrize("kwargs", [{"sku": "   "}, {"mpn": ""}, {"sku": "a|b"}])
def test_empty_or_separator_identifiers_are_rejected(kwargs):
    with pytest.raises(InvalidIdentifier):
        OfferQuery.build(**kwargs)


def test_search_request_needs_an_identifier():
    with pytest.raises(ValidationError):
        OfferSearchRequest(manufacturer="Adafruit")
    assert OfferSearchRequest(sku="3801").list_params().sort == "reliability"


def test_settings_reject_a_bad_offers_provider(monkeypatch):
    monkeypatch.setenv("RIVET_OFFERS_PROVIDER", "amazon")
    with pytest.raises(ValueError, match="RIVET_OFFERS_PROVIDER"):
        Settings.from_env()


@pytest.mark.parametrize("value", ["stub", "recorded", "live"])
def test_settings_accept_each_offers_provider(monkeypatch, value):
    monkeypatch.setenv("RIVET_OFFERS_PROVIDER", value)
    assert Settings.from_env().offers_provider == value
