"""Offer wire models mirroring contracts/offer.schema.json (docs/e-commerce-layer/plan.md 3.1).

Every field of an offer is read from a fetched page and carries that page's timestamp and
hash. Unknown values are None, never 0 or an empty string; a zero price is rejected so a
missing price can never be rendered as free.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field, StrictBool, StrictInt, model_validator

from rivet_engine.models import SCHEMA_VERSION, Number, UtcTimestamp, WireModel

VendorTier = Literal["manufacturer", "authorized_distributor", "marketplace", "reseller", "unknown"]
Availability = Literal["in_stock", "out_of_stock", "backorder", "discontinued", "unknown"]
MatchKind = Literal["exact_sku", "exact_mpn", "gtin", "fuzzy"]
OfferEvidenceLevel = Literal["verified", "inferred", "stale", "conflict", "not_found"]
OfferLinkStatus = Literal["pass", "broken", "blocked", "error", "unchecked"]
OfferStatus = Literal["ok", "stale", "demoted"]
Outcome = Literal["found", "partial", "not_found", "refused"]
ProviderMode = Literal["stub", "recorded", "live"]
RatingSource = Literal["jsonld_aggregate_rating", "vendor_api"]
UnitPriceBasis = Literal["per_pack", "per_unit"]
FactorKey = Literal["vendor_tier", "match_exactness", "freshness", "link_status", "rating", "price_outlier"]
LedgerStatus = Literal[
    "offer",
    "possible_match",
    "dropped_no_identifier",
    "dropped_soft_404",
    "dropped_unavailable",
    "dropped_denylisted",
    "duplicate",
    "not_found",
    "blocked",
    "error",
    "needs_api_key",
    "skipped",
]
SortKey = Literal["reliability", "price_asc", "price_desc", "rating", "availability", "newest"]

MONEY_PATTERN = re.compile(r"^([1-9][0-9]*(\.[0-9]{1,4})?|0\.[0-9]{0,3}[1-9][0-9]{0,3})$")
HTTPS_URL_PATTERN = re.compile(r"^https://[^\s/?#]+[^\s]*$")
VENDOR_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,62}$")
DOMAIN_PATTERN = re.compile(r"^[a-z0-9.-]+\.[a-z]{2,}$")
GTIN_PATTERN = re.compile(r"^[0-9]{8}$|^[0-9]{12,14}$")
OFFER_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,62}:[0-9a-f]{16}$")
NORMALIZED_KEY_PATTERN = re.compile(r"^[^|]*\|[^|]*\|[^|]*\|[^|]*$")


def _money(value: str) -> str:
    if len(value) > 24 or not MONEY_PATTERN.match(value):
        raise ValueError(f"money must be a positive decimal string with up to 4 fractional digits, got {value!r}")
    return value


def _https_url(value: str) -> str:
    if len(value) > 2048 or not HTTPS_URL_PATTERN.match(value):
        raise ValueError(f"only https URLs are allowed, got {value[:60]!r}")
    return value


Money = Annotated[str, AfterValidator(_money)]
HttpsUrl = Annotated[str, AfterValidator(_https_url)]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
Gtin = Annotated[str, Field(pattern=r"^[0-9]{8}$|^[0-9]{12,14}$")]
Identifier = Annotated[str, Field(min_length=1, max_length=64)]
UnitInterval = Annotated[Number, Field(ge=0, le=1)]


class OfferQuery(WireModel):
    sku: Identifier | None
    mpn: Identifier | None
    gtin: Gtin | None
    manufacturer: Annotated[str, Field(min_length=1, max_length=120)] | None
    catalog_id: Annotated[str, Field(min_length=1)] | None
    normalized_key: Annotated[str, Field(pattern=NORMALIZED_KEY_PATTERN.pattern)]


class Vendor(WireModel):
    id: Annotated[str, Field(pattern=VENDOR_ID_PATTERN.pattern)]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    tier: VendorTier
    domain: Annotated[str, Field(pattern=DOMAIN_PATTERN.pattern)]


class Rating(WireModel):
    value: Annotated[Number, Field(ge=0)]
    count: Annotated[StrictInt, Field(ge=1)]
    scale: Annotated[Number, Field(gt=0)] = 5
    source: RatingSource


class Match(WireModel):
    kind: MatchKind
    confidence: UnitInterval
    evidence_quote: Annotated[str, Field(min_length=1, max_length=400)] | None

    @model_validator(mode="after")
    def _non_fuzzy_needs_quote(self) -> Match:
        if self.kind != "fuzzy" and self.evidence_quote is None:
            raise ValueError(f"a {self.kind} match needs an evidence_quote from the fetched page")
        return self


class ReliabilityFactor(WireModel):
    key: FactorKey
    weight: UnitInterval
    value: UnitInterval
    note: Annotated[str, Field(max_length=200)]


class Reliability(WireModel):
    score: UnitInterval
    factors: list[ReliabilityFactor]


class Shipping(WireModel):
    amount: Money | None
    currency: Currency
    note: Annotated[str, Field(max_length=200)] | None


class Pack(WireModel):
    quantity: Annotated[StrictInt, Field(ge=1)]
    unit_price_basis: UnitPriceBasis


class Offer(WireModel):
    offer_id: Annotated[str, Field(pattern=OFFER_ID_PATTERN.pattern)]
    sku: Identifier | None
    mpn: Identifier | None
    gtin: Gtin | None
    vendor: Vendor
    url: HttpsUrl
    price_amount: Money | None
    currency: Currency | None
    availability: Availability
    min_order_qty: Annotated[StrictInt, Field(ge=1)] | None
    pack: Pack
    shipping: Shipping | None
    rating: Rating | None
    match: Match
    fetched_at: UtcTimestamp
    evidence_level: OfferEvidenceLevel
    link_status: OfferLinkStatus
    reliability: Reliability
    status: OfferStatus
    source_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]

    @model_validator(mode="after")
    def _cross_field_rules(self) -> Offer:
        if self.price_amount is not None and self.currency is None:
            raise ValueError("a price needs a currency")
        if self.evidence_level == "verified" and self.match.kind == "fuzzy":
            raise ValueError("a verified offer is never a fuzzy match")
        if not self.offer_id.startswith(self.vendor.id + ":"):
            raise ValueError("offer_id must start with the vendor id")
        return self


class LedgerEntry(WireModel):
    source: Annotated[str, Field(min_length=1, max_length=64)]
    url: HttpsUrl | None
    status: LedgerStatus
    reason: Annotated[str, Field(max_length=300)]
    checked_at: UtcTimestamp | None


class OfferSet(WireModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    query: OfferQuery
    outcome: Outcome
    provider_mode: ProviderMode
    synthetic: StrictBool
    generated_at: UtcTimestamp
    offers: list[Offer]
    possible_matches: list[Offer]
    alternatives: list[Offer]
    ledger: list[LedgerEntry]
    notices: list[Annotated[str, Field(min_length=1, max_length=300)]]

    @model_validator(mode="after")
    def _lists_respect_match_kinds(self) -> OfferSet:
        if any(o.match.kind == "fuzzy" for o in self.offers):
            raise ValueError("fuzzy matches belong in possible_matches, never in offers")
        if any(o.match.kind != "fuzzy" for o in self.possible_matches):
            raise ValueError("possible_matches holds fuzzy matches only")
        return self


def offer_set_from_dict(doc: dict[str, Any]) -> OfferSet:
    return OfferSet.model_validate(doc)


def to_dict(model: WireModel) -> dict[str, Any]:
    return model.to_wire()


__all__ = [
    "Availability",
    "Currency",
    "FactorKey",
    "Gtin",
    "HttpsUrl",
    "LedgerEntry",
    "LedgerStatus",
    "Match",
    "MatchKind",
    "Money",
    "Offer",
    "OfferEvidenceLevel",
    "OfferLinkStatus",
    "OfferQuery",
    "OfferSet",
    "OfferStatus",
    "Outcome",
    "Pack",
    "ProviderMode",
    "Rating",
    "RatingSource",
    "Reliability",
    "ReliabilityFactor",
    "Shipping",
    "SortKey",
    "UnitPriceBasis",
    "Vendor",
    "VendorTier",
    "offer_set_from_dict",
    "to_dict",
]
