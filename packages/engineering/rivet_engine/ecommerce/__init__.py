"""E-commerce layer: find, verify, dedupe, score and rank where a verified part can be bought
(docs/e-commerce-layer/plan.md). Offline except `find_offers(mode="live")`."""

from rivet_engine.ecommerce.identifiers import InvalidIdentifier, InvalidUrl, canonical_url, normalize_query, offer_id
from rivet_engine.ecommerce.models import (
    LedgerEntry,
    Match,
    Offer,
    OfferQuery,
    OfferSet,
    Pack,
    Rating,
    Reliability,
    ReliabilityFactor,
    Shipping,
    Vendor,
    offer_set_from_dict,
    to_dict,
)
from rivet_engine.ecommerce.pipeline import find_offers
from rivet_engine.ecommerce.providers import (
    BraveSearchProvider,
    MultiRecordedFetcher,
    OffersProviderError,
    ProviderAuth,
    ProviderQuota,
    ProviderUnavailable,
    RecordedSearchProvider,
    SearchProvider,
    StructuredApiProvider,
    StubOffersProvider,
)
from rivet_engine.ecommerce.scoring import filter_offers, rank, score_offers
from rivet_engine.ecommerce.vendors import vendor_for_url

__all__ = [
    "BraveSearchProvider",
    "InvalidIdentifier",
    "InvalidUrl",
    "LedgerEntry",
    "Match",
    "MultiRecordedFetcher",
    "Offer",
    "OfferQuery",
    "OfferSet",
    "OffersProviderError",
    "Pack",
    "ProviderAuth",
    "ProviderQuota",
    "ProviderUnavailable",
    "Rating",
    "RecordedSearchProvider",
    "Reliability",
    "ReliabilityFactor",
    "SearchProvider",
    "Shipping",
    "StructuredApiProvider",
    "StubOffersProvider",
    "Vendor",
    "canonical_url",
    "filter_offers",
    "find_offers",
    "normalize_query",
    "offer_id",
    "offer_set_from_dict",
    "rank",
    "score_offers",
    "to_dict",
    "vendor_for_url",
]
