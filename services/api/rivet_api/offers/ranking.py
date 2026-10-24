"""Deterministic server-side sort and filter for `OfferSet.offers` (contracts/api.md, Offers).

Unknown prices and ratings sort last in every direction, every order ends in `offer_id`, and
prices are only ever compared inside one currency: the requested one, else the majority
currency among priced offers. Pack prices are compared per unit when the page priced the pack.
"""

from collections import Counter
from datetime import datetime
from decimal import Decimal

from rivet_api.offers.models import Offer, OfferListParams, SortKey

RATING_SCALE = 5
_AVAILABILITY_ORDER = {"in_stock": 0, "backorder": 1, "out_of_stock": 2, "discontinued": 3, "unknown": 4}


def unit_price(offer: Offer) -> Decimal | None:
    if offer.price_amount is None:
        return None
    amount = Decimal(offer.price_amount)
    if offer.pack.unit_price_basis == "per_pack" and offer.pack.quantity > 1:
        return amount / offer.pack.quantity
    return amount


def rating_on_five(offer: Offer) -> float | None:
    if offer.rating is None:
        return None
    return offer.rating.value / offer.rating.scale * RATING_SCALE


def majority_currency(offers: list[Offer]) -> str | None:
    counts = Counter(o.currency for o in offers if o.price_amount is not None and o.currency)
    if not counts:
        return None
    return min(counts, key=lambda c: (-counts[c], c))


def comparison_currency(offers: list[Offer], requested: str | None) -> str | None:
    return requested or majority_currency(offers)


def filter_offers(offers: list[Offer], params: OfferListParams) -> list[Offer]:
    kept = list(offers)
    if params.vendor_tier:
        tiers = set(params.vendor_tier)
        kept = [o for o in kept if o.vendor.tier in tiers]
    if params.in_stock:
        kept = [o for o in kept if o.availability == "in_stock"]
    if params.min_rating is not None:
        kept = [o for o in kept if (r := rating_on_five(o)) is not None and r >= params.min_rating]
    if params.currency is not None:
        kept = [o for o in kept if o.currency == params.currency]
    if params.max_price is not None:
        currency = comparison_currency(kept, params.currency)
        ceiling = Decimal(params.max_price)
        kept = [o for o in kept if o.currency == currency and (p := unit_price(o)) is not None and p <= ceiling]
    return kept


def sort_offers(offers: list[Offer], sort: SortKey, currency: str | None = None) -> list[Offer]:
    by_id = sorted(offers, key=lambda o: o.offer_id)
    if sort in ("price_asc", "price_desc"):
        compare_in = comparison_currency(by_id, currency)
        priced = [o for o in by_id if o.price_amount is not None and o.currency == compare_in]
        other_currency = [o for o in by_id if o.price_amount is not None and o.currency != compare_in]
        unpriced = [o for o in by_id if o.price_amount is None]
        sign = 1 if sort == "price_asc" else -1
        priced.sort(key=lambda o: sign * unit_price(o))
        return priced + other_currency + unpriced
    if sort == "rating":
        rated = [o for o in by_id if o.rating is not None]
        rated.sort(key=lambda o: (-rating_on_five(o), -o.rating.count))
        return rated + [o for o in by_id if o.rating is None]
    if sort == "availability":
        return sorted(by_id, key=lambda o: (_AVAILABILITY_ORDER[o.availability], -o.reliability.score))
    if sort == "newest":
        return sorted(by_id, key=lambda o: -_epoch(o.fetched_at))
    return sorted(by_id, key=lambda o: -o.reliability.score)


def _epoch(timestamp: str) -> float:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()


def view(offers: list[Offer], params: OfferListParams) -> list[Offer]:
    return sort_offers(filter_offers(offers, params), params.sort, params.currency)
