"""Pydantic mirror of contracts/offer.schema.json plus the request shapes for the offers routes.

Every constraint here exists in the JSON schema; the cross-field rules the schema states with
`allOf`/`if` are enforced by model validators so a provider cannot hand back a price without a
currency, an exact match without a quote, or a non-https link.
"""

import re
import unicodedata
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

SCHEMA_VERSION = "1.0"

Timestamp = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")]
HttpsUrl = Annotated[str, StringConstraints(pattern=r"^https://[^\s/?#]+[^\s]*$", max_length=2048)]
Money = Annotated[
    str,
    StringConstraints(pattern=r"^([1-9][0-9]*(\.[0-9]{1,4})?|0\.[0-9]{0,3}[1-9][0-9]{0,3})$", max_length=24),
]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
Gtin = Annotated[str, StringConstraints(pattern=r"^[0-9]{8}$|^[0-9]{12,14}$")]
Identifier = Annotated[str, StringConstraints(min_length=1, max_length=64)]

VendorTier = Literal["manufacturer", "authorized_distributor", "marketplace", "reseller", "unknown"]
Availability = Literal["in_stock", "out_of_stock", "backorder", "discontinued", "unknown"]
MatchKind = Literal["exact_sku", "exact_mpn", "gtin", "fuzzy"]
EvidenceLevel = Literal["verified", "inferred", "stale", "conflict", "not_found"]
LinkStatus = Literal["pass", "broken", "blocked", "error", "unchecked"]
OfferStatus = Literal["ok", "stale", "demoted"]
Outcome = Literal["found", "partial", "not_found", "refused"]
ProviderMode = Literal["stub", "recorded", "live"]
SortKey = Literal["reliability", "price_asc", "price_desc", "rating", "availability", "newest"]
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
FactorKey = Literal["vendor_tier", "match_exactness", "freshness", "link_status", "rating", "price_outlier"]

VENDOR_TIERS: tuple[str, ...] = ("manufacturer", "authorized_distributor", "marketplace", "reseller", "unknown")
SORT_KEYS: tuple[str, ...] = ("reliability", "price_asc", "price_desc", "rating", "availability", "newest")


class InvalidIdentifier(ValueError):
    """A SKU/MPN/GTIN that cannot be searched for (empty, contains the key separator, bad GTIN)."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OfferQuery(_Strict):
    sku: Identifier | None
    mpn: Identifier | None
    gtin: Gtin | None
    manufacturer: Annotated[str, StringConstraints(min_length=1, max_length=120)] | None
    catalog_id: Annotated[str, StringConstraints(min_length=1)] | None
    normalized_key: Annotated[str, StringConstraints(pattern=r"^[^|]*\|[^|]*\|[^|]*\|[^|]*$")]

    @classmethod
    def build(
        cls,
        *,
        sku: str | None = None,
        mpn: str | None = None,
        gtin: str | None = None,
        manufacturer: str | None = None,
        catalog_id: str | None = None,
    ) -> "OfferQuery":
        sku, mpn, manufacturer = (_clean(v, name) for v, name in ((sku, "sku"), (mpn, "mpn"), (manufacturer, "manufacturer")))
        gtin = _clean_gtin(gtin)
        return cls(
            sku=sku,
            mpn=mpn,
            gtin=gtin,
            manufacturer=manufacturer,
            catalog_id=catalog_id,
            normalized_key=normalized_key(sku, mpn, gtin, manufacturer),
        )


def _clean(value: str | None, name: str) -> str | None:
    if value is None:
        return None
    text = " ".join(unicodedata.normalize("NFKC", value).split())
    if not text:
        raise InvalidIdentifier(f"{name} is empty")
    if "|" in text:
        raise InvalidIdentifier(f"{name} may not contain '|'")
    return text


def _clean_gtin(value: str | None) -> str | None:
    if value is None:
        return None
    digits = re.sub(r"[\s-]", "", unicodedata.normalize("NFKC", value))
    if not digits:
        raise InvalidIdentifier("gtin is empty")
    if not digits.isdigit() or len(digits) not in (8, 12, 13, 14):
        raise InvalidIdentifier("gtin must be 8, 12, 13 or 14 digits")
    if not gtin_check_digit_ok(digits):
        raise InvalidIdentifier("gtin check digit does not match")
    return digits


def gtin_check_digit_ok(digits: str) -> bool:
    body, check = digits[:-1], int(digits[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def normalized_key(sku: str | None, mpn: str | None, gtin: str | None, manufacturer: str | None) -> str:
    return "|".join(" ".join((part or "").split()).lower() for part in (sku, mpn, gtin, manufacturer))


class Vendor(_Strict):
    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_.-]{0,62}$")]
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    tier: VendorTier
    domain: Annotated[str, StringConstraints(pattern=r"^[a-z0-9.-]+\.[a-z]{2,}$")]


class Rating(_Strict):
    value: Annotated[float, Field(ge=0)]
    count: Annotated[int, Field(ge=1)]
    scale: Annotated[float, Field(gt=0)] = 5
    source: Literal["jsonld_aggregate_rating", "vendor_api"]


class Match(_Strict):
    kind: MatchKind
    confidence: Annotated[float, Field(ge=0, le=1)]
    evidence_quote: Annotated[str, StringConstraints(min_length=1, max_length=400)] | None


class ReliabilityFactor(_Strict):
    key: FactorKey
    weight: Annotated[float, Field(ge=0, le=1)]
    value: Annotated[float, Field(ge=0, le=1)]
    note: Annotated[str, StringConstraints(max_length=200)]


class Reliability(_Strict):
    score: Annotated[float, Field(ge=0, le=1)]
    factors: list[ReliabilityFactor]


class Shipping(_Strict):
    amount: Money | None
    currency: Currency
    note: Annotated[str, StringConstraints(max_length=200)] | None


class Pack(_Strict):
    quantity: Annotated[int, Field(ge=1)]
    unit_price_basis: Literal["per_pack", "per_unit"]


class Offer(_Strict):
    offer_id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_.-]{0,62}:[0-9a-f]{16}$")]
    sku: Identifier | None
    mpn: Identifier | None
    gtin: Gtin | None
    vendor: Vendor
    url: HttpsUrl
    price_amount: Money | None
    currency: Currency | None
    availability: Availability
    min_order_qty: Annotated[int, Field(ge=1)] | None
    pack: Pack
    shipping: Shipping | None
    rating: Rating | None
    match: Match
    fetched_at: Timestamp
    evidence_level: EvidenceLevel
    link_status: LinkStatus
    reliability: Reliability
    status: OfferStatus
    source_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]

    @model_validator(mode="after")
    def _cross_field_rules(self) -> "Offer":
        if self.price_amount is not None and self.currency is None:
            raise ValueError("price_amount needs a currency")
        if self.match.kind != "fuzzy" and self.match.evidence_quote is None:
            raise ValueError("a non-fuzzy match needs an evidence_quote")
        if self.evidence_level == "verified" and self.match.kind == "fuzzy":
            raise ValueError("a verified offer cannot be a fuzzy match")
        return self


class LedgerEntry(_Strict):
    source: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    url: HttpsUrl | None
    status: LedgerStatus
    reason: Annotated[str, StringConstraints(max_length=300)]
    checked_at: Timestamp | None


class OfferSet(_Strict):
    schema_version: Literal["1.0"]
    query: OfferQuery
    outcome: Outcome
    provider_mode: ProviderMode
    synthetic: bool
    generated_at: Timestamp
    offers: list[Offer]
    possible_matches: list[Offer]
    alternatives: list[Offer]
    ledger: list[LedgerEntry]
    notices: list[Annotated[str, StringConstraints(min_length=1, max_length=300)]]

    @model_validator(mode="after")
    def _no_fuzzy_in_ranked_list(self) -> "OfferSet":
        if any(o.match.kind == "fuzzy" for o in self.offers):
            raise ValueError("fuzzy matches belong in possible_matches, not offers")
        return self


class OfferListParams(_Strict):
    sort: SortKey = "reliability"
    vendor_tier: list[VendorTier] = Field(default_factory=list)
    in_stock: bool | None = None
    min_rating: Annotated[float, Field(ge=0, le=5)] | None = None
    max_price: Money | None = None
    currency: Currency | None = None


class OfferSearchRequest(OfferListParams):
    sku: Annotated[str, StringConstraints(max_length=64)] | None = None
    mpn: Annotated[str, StringConstraints(max_length=64)] | None = None
    gtin: Annotated[str, StringConstraints(max_length=32)] | None = None
    manufacturer: Annotated[str, StringConstraints(max_length=120)] | None = None

    @model_validator(mode="after")
    def _needs_an_identifier(self) -> "OfferSearchRequest":
        if not any((self.sku, self.mpn, self.gtin)):
            raise ValueError("at least one of sku, mpn or gtin is required")
        return self

    def list_params(self) -> OfferListParams:
        return OfferListParams(**{k: getattr(self, k) for k in OfferListParams.model_fields})
