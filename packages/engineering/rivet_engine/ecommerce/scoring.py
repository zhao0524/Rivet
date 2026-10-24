"""Transparent reliability score, deterministic ranking and filtering (plan 3.2 step 6, 3.3).

The six factors and their weights (`weights.json`) are returned with every offer so the UI can
show why a vendor ranks where it does. Nothing here changes a price or a stock value; it only
orders and labels what the pages said.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from statistics import median

from rivet_engine.ecommerce.models import (
    Availability,
    FactorKey,
    Offer,
    OfferLinkStatus,
    Reliability,
    ReliabilityFactor,
    SortKey,
    VendorTier,
)
from rivet_engine.sourcing.evidence import parse_utc

WEIGHTS_PATH = Path(__file__).resolve().parent / "weights.json"
STALE_AFTER_DAYS = 30
VERY_STALE_AFTER_DAYS = 180
RATING_PRIOR_COUNT = 10
OUTLIER_BELOW_MEDIAN_RATIO = Decimal("0.5")
SUSPICIOUS_BELOW_MEDIAN_RATIO = Decimal("0.75")
OVERPRICED_ABOVE_MEDIAN_RATIO = Decimal("3")

TIER_VALUE: dict[VendorTier, float] = {
    "manufacturer": 1.0,
    "authorized_distributor": 0.9,
    "reseller": 0.5,
    "marketplace": 0.3,
    "unknown": 0.2,
}
MATCH_VALUE = {"exact_sku": 1.0, "gtin": 1.0, "exact_mpn": 0.9, "fuzzy": 0.5}
LINK_VALUE: dict[OfferLinkStatus, float] = {"pass": 1.0, "unchecked": 0.7, "blocked": 0.5, "error": 0.5, "broken": 0.0}
AVAILABILITY_ORDER: dict[Availability, int] = {"in_stock": 0, "backorder": 1, "out_of_stock": 2, "discontinued": 3, "unknown": 4}
FACTOR_ORDER: tuple[FactorKey, ...] = ("vendor_tier", "match_exactness", "freshness", "link_status", "rating", "price_outlier")


def load_weights(path: Path = WEIGHTS_PATH) -> dict[FactorKey, float]:
    weights = json.loads(path.read_text(encoding="utf-8"))
    if set(weights) != set(FACTOR_ORDER):
        raise ValueError(f"weights.json must define exactly {FACTOR_ORDER}")
    if abs(sum(weights.values()) - 1.0) > 1e-9:
        raise ValueError("weights.json must sum to 1")
    return {key: float(weights[key]) for key in FACTOR_ORDER}


WEIGHTS = load_weights()


def unit_price(offer: Offer) -> Decimal | None:
    if offer.price_amount is None:
        return None
    amount = Decimal(offer.price_amount)
    if offer.pack.unit_price_basis == "per_pack" and offer.pack.quantity > 1:
        return amount / offer.pack.quantity
    return amount


def _age_days(fetched_at: str, now: datetime) -> int:
    return max(0, (now - parse_utc(fetched_at)).days)


def _clamp(value: float) -> float:
    return round(min(1.0, max(0.0, value)), 3)


def median_unit_prices(offers: Iterable[Offer]) -> dict[str, Decimal]:
    by_currency: dict[str, list[Decimal]] = {}
    for offer in offers:
        price = unit_price(offer)
        if price is not None and offer.currency:
            by_currency.setdefault(offer.currency, []).append(price)
    return {currency: Decimal(median(prices)) for currency, prices in by_currency.items()}


def _price_factor(offer: Offer, medians: dict[str, Decimal], counts: dict[str, int]) -> tuple[float, str, bool]:
    price = unit_price(offer)
    if price is None or not offer.currency or offer.currency not in medians:
        return 0.5, "no price: neutral", False
    if counts.get(offer.currency, 0) < 2:
        if len(medians) > 1:
            return 0.5, f"{offer.currency} not compared with other currencies", False
        return 1.0, "", False
    reference = medians[offer.currency]
    if reference <= 0:
        return 0.5, "no price: neutral", False
    ratio = price / reference
    per_unit = " per unit" if offer.pack.quantity > 1 else ""
    if ratio < OUTLIER_BELOW_MEDIAN_RATIO:
        below = int((1 - ratio) * 100)
        return 0.0, f"{price.normalize():f}{per_unit} is {below}% below the {reference.normalize():f} median", True
    if ratio < SUSPICIOUS_BELOW_MEDIAN_RATIO:
        return 0.5, f"{price.normalize():f}{per_unit} is well below the {reference.normalize():f} median", False
    if ratio > OVERPRICED_ABOVE_MEDIAN_RATIO:
        return 0.5, f"{price.normalize():f}{per_unit} is more than 3x the {reference.normalize():f} median", False
    return 1.0, (f"compared per unit ({price.normalize():f})" if offer.pack.quantity > 1 else ""), False


def _rating_factor(offer: Offer) -> tuple[float, str]:
    if offer.rating is None:
        return 0.0, "no rating on page"
    rating = offer.rating
    normalised = min(1.0, float(rating.value) / float(rating.scale))
    shrink = rating.count / (rating.count + RATING_PRIOR_COUNT)
    if rating.count == 1:
        note = f"{rating.value}/{rating.scale:g} from a single review carries little weight"
    else:
        note = f"{rating.value}/{rating.scale:g} from {rating.count} reviews"
    return _clamp(normalised * shrink), note


def score_offer(offer: Offer, *, now: datetime, medians: dict[str, Decimal], counts: dict[str, int]) -> Offer:
    """A copy of `offer` with `reliability`, `status` and a stale `evidence_level` filled in."""
    age = _age_days(offer.fetched_at, now)
    if age <= STALE_AFTER_DAYS:
        freshness, freshness_note = 1.0, ""
    elif age <= VERY_STALE_AFTER_DAYS:
        freshness, freshness_note = 0.2, f"checked {age} days ago"
    else:
        freshness, freshness_note = 0.0, f"checked {age} days ago"
    link_value = LINK_VALUE[offer.link_status]
    link_note = "" if offer.link_status == "pass" else f"last link check: {offer.link_status}"
    rating_value, rating_note = _rating_factor(offer)
    price_value, price_note, outlier = _price_factor(offer, medians, counts)
    match_value = _clamp(MATCH_VALUE[offer.match.kind] * float(offer.match.confidence))
    match_note = "" if offer.match.confidence >= 1 else f"{offer.match.kind} at confidence {offer.match.confidence}"
    values: dict[FactorKey, tuple[float, str]] = {
        "vendor_tier": (TIER_VALUE[offer.vendor.tier], "" if offer.vendor.tier != "unknown" else "vendor not in the registry"),
        "match_exactness": (match_value, match_note),
        "freshness": (freshness, freshness_note),
        "link_status": (link_value, link_note),
        "rating": (rating_value, rating_note),
        "price_outlier": (price_value, price_note),
    }
    factors = [ReliabilityFactor(key=key, weight=WEIGHTS[key], value=_clamp(values[key][0]), note=values[key][1][:200]) for key in FACTOR_ORDER]
    score = _clamp(sum(f.weight * f.value for f in factors))
    if offer.link_status == "broken" or outlier:
        status = "demoted"
    elif age > STALE_AFTER_DAYS:
        status = "stale"
    else:
        status = "ok"
    level = "stale" if age > STALE_AFTER_DAYS and offer.evidence_level == "verified" else offer.evidence_level
    return offer.model_copy(update={"reliability": Reliability(score=score, factors=factors), "status": status, "evidence_level": level})


def score_offers(offers: Sequence[Offer], *, now: datetime | None = None) -> list[Offer]:
    """Score each offer against the medians of the whole group (same currency, per unit)."""
    now = now or datetime.now(timezone.utc)
    medians = median_unit_prices(offers)
    counts: dict[str, int] = {}
    for offer in offers:
        if unit_price(offer) is not None and offer.currency:
            counts[offer.currency] = counts.get(offer.currency, 0) + 1
    return [score_offer(offer, now=now, medians=medians, counts=counts) for offer in offers]


def majority_currency(offers: Sequence[Offer]) -> str | None:
    counts: dict[str, int] = {}
    for offer in offers:
        if offer.currency and offer.price_amount is not None:
            counts[offer.currency] = counts.get(offer.currency, 0) + 1
    if not counts:
        return None
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def rank(offers: Sequence[Offer], sort: SortKey = "reliability", *, currency: str | None = None) -> list[Offer]:
    """Deterministic order: unknowns last in every direction, ties broken on offer_id.

    Price sorts compare only offers in `currency` (default: the majority currency); other
    currencies follow in offer_id order and offers without a price come last."""
    if sort == "reliability":
        return sorted(offers, key=lambda o: (-float(o.reliability.score), o.offer_id))
    if sort in ("price_asc", "price_desc"):
        chosen = currency or majority_currency(offers)
        priced = [o for o in offers if o.currency == chosen and unit_price(o) is not None]
        other_currency = [o for o in offers if o.currency != chosen and unit_price(o) is not None]
        unpriced = [o for o in offers if unit_price(o) is None]
        sign = 1 if sort == "price_asc" else -1
        priced.sort(key=lambda o: (sign * unit_price(o), o.offer_id))
        return priced + sorted(other_currency, key=lambda o: o.offer_id) + sorted(unpriced, key=lambda o: o.offer_id)
    if sort == "rating":
        rated = [o for o in offers if o.rating is not None]
        unrated = [o for o in offers if o.rating is None]
        rated.sort(key=lambda o: (-float(o.rating.value) / float(o.rating.scale), -o.rating.count, o.offer_id))
        return rated + sorted(unrated, key=lambda o: o.offer_id)
    if sort == "availability":
        return sorted(offers, key=lambda o: (AVAILABILITY_ORDER[o.availability], -float(o.reliability.score), o.offer_id))
    if sort == "newest":
        return sorted(offers, key=lambda o: (-parse_utc(o.fetched_at).timestamp(), o.offer_id))
    raise ValueError(f"unknown sort {sort!r}")


def filter_offers(
    offers: Sequence[Offer],
    *,
    vendor_tier: str | Iterable[str] | None = None,
    in_stock: bool | None = None,
    min_rating: float | None = None,
    max_price: str | Decimal | None = None,
    currency: str | None = None,
) -> list[Offer]:
    """Server-side filters from contracts/api.md. `max_price` applies only within `currency`
    (or the majority currency when none is given); there is no conversion."""
    tiers = {vendor_tier} if isinstance(vendor_tier, str) else (set(vendor_tier) if vendor_tier else None)
    price_currency = currency or (majority_currency(offers) if max_price is not None else None)
    ceiling = Decimal(str(max_price)) if max_price is not None else None
    out: list[Offer] = []
    for offer in offers:
        if tiers is not None and offer.vendor.tier not in tiers:
            continue
        if in_stock and offer.availability != "in_stock":
            continue
        if min_rating is not None and (offer.rating is None or float(offer.rating.value) < float(min_rating)):
            continue
        if currency is not None and offer.currency != currency:
            continue
        if ceiling is not None:
            price = unit_price(offer)
            if price is None or offer.currency != price_currency or price > ceiling:
                continue
        out.append(offer)
    return out


__all__ = [
    "AVAILABILITY_ORDER",
    "FACTOR_ORDER",
    "LINK_VALUE",
    "MATCH_VALUE",
    "RATING_PRIOR_COUNT",
    "STALE_AFTER_DAYS",
    "TIER_VALUE",
    "WEIGHTS",
    "WEIGHTS_PATH",
    "filter_offers",
    "load_weights",
    "majority_currency",
    "median_unit_prices",
    "rank",
    "score_offer",
    "score_offers",
    "unit_price",
]
