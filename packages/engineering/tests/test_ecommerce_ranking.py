"""rivet_engine.ecommerce.scoring: deterministic sort and filter (contracts/api.md Offers, plan case 18)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from rivet_engine.ecommerce import OfferSet, filter_offers, rank, score_offers
from rivet_engine.ecommerce.scoring import majority_currency, unit_price
from tests import support

NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def offers():
    doc = json.loads((support.SHARED_FIXTURES / "offers" / "synthetic-multivendor.json").read_text(encoding="utf-8"))
    return OfferSet.model_validate(doc).offers


def ids(items):
    return [o.offer_id for o in items]


def test_reliability_sort_is_score_desc_then_offer_id(offers):
    ranked = rank(offers, "reliability")
    keys = [(-float(o.reliability.score), o.offer_id) for o in ranked]
    assert keys == sorted(keys)


def test_price_asc_compares_per_unit_within_majority_currency_and_puts_unknowns_last(offers):
    ranked = rank(offers, "price_asc")
    assert majority_currency(offers) == "USD"
    usd = [o for o in ranked if o.currency == "USD" and o.price_amount]
    assert [str(unit_price(o)) for o in usd] == sorted((str(unit_price(o)) for o in usd), key=float)
    assert str(unit_price(usd[-1])) == "4.95" and ranked[0].price_amount == "0.99"
    assert ranked[-1].price_amount is None
    eur_index = ranked.index(next(o for o in ranked if o.currency == "EUR"))
    assert eur_index > ranked.index(usd[-1])


def test_price_desc_still_puts_missing_price_last(offers):
    ranked = rank(offers, "price_desc")
    assert ranked[0].price_amount == "4.95" and ranked[-1].price_amount is None


def test_price_sort_can_target_another_currency(offers):
    ranked = rank(offers, "price_asc", currency="EUR")
    assert ranked[0].currency == "EUR"


def test_rating_sort_puts_unrated_last_in_offer_id_order(offers):
    ranked = rank(offers, "rating")
    assert ranked[0].rating.value == 5.0 and ranked[0].rating.count == 1 and ranked[1].rating.count == 128
    unrated = [o for o in ranked if o.rating is None]
    assert ids(unrated) == sorted(ids(unrated))


def test_availability_sort_groups_in_stock_first_and_unknown_last(offers):
    order = [o.availability for o in rank(offers, "availability")]
    assert order == sorted(order, key=["in_stock", "backorder", "out_of_stock", "discontinued", "unknown"].index)


def test_newest_sort_puts_stale_last(offers):
    ranked = rank(offers, "newest")
    assert ranked[-1].fetched_at == "2026-08-20T12:00:00Z"


def test_unknown_sort_key_is_an_error(offers):
    with pytest.raises(ValueError):
        rank(offers, "cheapest")  # type: ignore[arg-type]


def test_every_sort_is_a_permutation_and_stable(offers):
    for sort in ("reliability", "price_asc", "price_desc", "rating", "availability", "newest"):
        once = ids(rank(offers, sort))
        assert sorted(once) == sorted(ids(offers)) and once == ids(rank(list(reversed(offers)), sort))


def test_filters_combine_and_can_leave_an_empty_result(offers):
    assert {o.vendor.tier for o in filter_offers(offers, vendor_tier="marketplace")} == {"marketplace"}
    assert {o.vendor.tier for o in filter_offers(offers, vendor_tier=["manufacturer", "reseller"])} == {"manufacturer", "reseller"}
    assert all(o.availability == "in_stock" for o in filter_offers(offers, in_stock=True))
    assert all(o.rating and o.rating.value >= 4.5 for o in filter_offers(offers, min_rating=4.5))
    assert filter_offers(offers, vendor_tier="unknown") == []
    assert filter_offers(offers, in_stock=True, min_rating=4.9, vendor_tier="manufacturer") == []


def test_max_price_applies_only_within_one_currency(offers):
    cheap_usd = filter_offers(offers, max_price="4.60", currency="USD")
    assert all(o.currency == "USD" and unit_price(o) <= 4.60 for o in cheap_usd)
    assert all(o.price_amount is not None for o in cheap_usd)
    assert {o.currency for o in filter_offers(offers, currency="EUR")} == {"EUR"}
    assert filter_offers(offers, max_price="100", currency="EUR")[0].price_amount == "4.20"
    assert all(o.currency == "USD" for o in filter_offers(offers, max_price="100"))


def test_scoring_is_deterministic_and_bounded(offers):
    first = score_offers(offers, now=NOW)
    second = score_offers(offers, now=NOW)
    assert [o.reliability for o in first] == [o.reliability for o in second]
    for offer in first:
        assert 0 <= float(offer.reliability.score) <= 1
        assert abs(sum(f.weight for f in offer.reliability.factors) - 1) < 1e-9
        assert all(0 <= float(f.value) <= 1 for f in offer.reliability.factors)
