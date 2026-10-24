"""Sort and filter rules from contracts/api.md (Offers), on the synthetic multi-vendor fixture."""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from rivet_api.offers.models import Offer, OfferListParams, OfferSet
from rivet_api.offers.ranking import filter_offers, majority_currency, sort_offers, unit_price, view

SHARED = Path(__file__).resolve().parents[3] / "fixtures" / "offers"


@pytest.fixture
def offers() -> list[Offer]:
    return OfferSet.model_validate(json.loads((SHARED / "synthetic-multivendor.json").read_text())).offers


def ids(items: list[Offer]) -> list[str]:
    return [o.offer_id for o in items]


def test_price_asc_puts_null_price_last_and_compares_packs_per_unit(offers):
    out = sort_offers(offers, "price_asc")
    assert out[-1].price_amount is None
    prices = [unit_price(o) for o in out if o.currency == "USD" and o.price_amount is not None]
    assert prices == sorted(prices)
    three_pack = next(o for o in out if o.pack.quantity == 3)
    assert unit_price(three_pack) == Decimal("4.00") and three_pack.price_amount == "12.00"


def test_price_desc_also_puts_null_price_last_and_never_treats_it_as_zero(offers):
    out = sort_offers(offers, "price_desc")
    assert out[-1].price_amount is None
    priced_usd = [o for o in out if o.currency == "USD" and o.price_amount is not None]
    assert ids(out[: len(priced_usd)]) == ids(priced_usd)
    assert [unit_price(o) for o in priced_usd] == sorted((unit_price(o) for o in priced_usd), reverse=True)


def test_price_sort_keeps_other_currencies_after_the_majority_currency_unconverted(offers):
    assert majority_currency(offers) == "USD"
    out = sort_offers(offers, "price_asc")
    eur = [o for o in out if o.currency == "EUR"]
    assert eur and out.index(eur[0]) > max(out.index(o) for o in out if o.currency == "USD" and o.price_amount is not None)
    assert out.index(eur[0]) < out.index(next(o for o in out if o.price_amount is None))


def test_price_sort_in_a_requested_currency_ranks_that_currency_first(offers):
    out = sort_offers(offers, "price_asc", currency="EUR")
    assert out[0].currency == "EUR"


def test_price_ties_break_on_offer_id(offers):
    out = sort_offers(offers, "price_asc")
    tied = [o for o in out if o.price_amount == "4.50" and o.currency == "USD"]
    assert len(tied) == 2 and ids(tied) == sorted(ids(tied))


def test_rating_sort_puts_unrated_last_and_higher_count_first_on_equal_value(offers):
    out = sort_offers(offers, "rating")
    rated = [o for o in out if o.rating is not None]
    assert ids(out[: len(rated)]) == ids(rated) and all(o.rating is None for o in out[len(rated) :])
    assert rated[0].rating.value == 5.0 and rated[1].rating.value == 4.6


def test_availability_sort_puts_unknown_last(offers):
    out = sort_offers(offers, "availability")
    assert out[0].availability == "in_stock" and out[-1].availability == "unknown"


def test_newest_sort_puts_the_stale_offer_last(offers):
    out = sort_offers(offers, "newest")
    assert out[-1].status == "stale" and out[-1].fetched_at == "2026-08-20T12:00:00Z"


def test_default_reliability_sort_is_descending_then_offer_id(offers):
    out = sort_offers(offers, "reliability")
    assert [o.reliability.score for o in out] == sorted((o.reliability.score for o in out), reverse=True)


def test_currency_filter_keeps_only_that_currency(offers):
    out = filter_offers(offers, OfferListParams(currency="EUR"))
    assert len(out) == 1 and out[0].currency == "EUR" and out[0].price_amount == "4.20"


def test_max_price_compares_within_one_currency_per_unit(offers):
    out = filter_offers(offers, OfferListParams(max_price="4.00"))
    assert {o.currency for o in out} == {"USD"}
    assert all(unit_price(o) <= Decimal("4.00") for o in out)
    assert any(o.pack.quantity == 3 for o in out)
    assert all(o.price_amount is not None for o in out)


def test_max_price_with_currency_filter_does_not_convert(offers):
    assert ids(filter_offers(offers, OfferListParams(currency="EUR", max_price="4.00"))) == []
    assert len(filter_offers(offers, OfferListParams(currency="EUR", max_price="4.20"))) == 1


def test_min_rating_excludes_null_ratings(offers):
    out = filter_offers(offers, OfferListParams(min_rating=4.0))
    assert out and all(o.rating is not None and o.rating.value >= 4.0 for o in out)
    assert ids(filter_offers(offers, OfferListParams(min_rating=0))) == ids([o for o in offers if o.rating is not None])


def test_in_stock_and_vendor_tier_filters(offers):
    assert all(o.availability == "in_stock" for o in filter_offers(offers, OfferListParams(in_stock=True)))
    assert ids(filter_offers(offers, OfferListParams(in_stock=False))) == ids(offers)
    tiers = filter_offers(offers, OfferListParams(vendor_tier=["marketplace", "reseller"]))
    assert {o.vendor.tier for o in tiers} == {"marketplace", "reseller"}


def test_stale_and_demoted_offers_survive_sorting_and_filtering(offers):
    out = view(offers, OfferListParams(sort="price_asc", currency="USD"))
    assert {o.status for o in out} >= {"stale", "demoted"}


@pytest.mark.parametrize("sort", ["reliability", "price_asc", "price_desc", "rating", "availability", "newest"])
def test_every_sort_is_deterministic_regardless_of_input_order(offers, sort):
    forward = ids(sort_offers(offers, sort))
    assert ids(sort_offers(list(reversed(offers)), sort)) == forward
    assert sorted(forward) == sorted(ids(offers))
