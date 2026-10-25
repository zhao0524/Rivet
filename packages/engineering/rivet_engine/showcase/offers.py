"""Pre-collected offers for a showcase part from direct vendors only (plan-showcase.md 3.2).

The part's own vendor page plus the URL adapters (Adafruit, SparkFun, Pololu, Mouser and
Digi-Key when keyed) are consulted; web search is disabled, so the ledger shows `brave-search
skipped` and no Brave request is ever spent on the catalogue.
"""

from __future__ import annotations

from datetime import datetime

from rivet_engine.ecommerce.identifiers import normalize_query
from rivet_engine.ecommerce.models import OfferQuery, OfferSet
from rivet_engine.ecommerce.pipeline import find_offers
from rivet_engine.ecommerce.providers import AdapterProvider, DisabledSearchProvider
from rivet_engine.showcase.models import ShowcasePart
from rivet_engine.sourcing.fetch import Fetcher

DIRECT_ONLY_REASON = "showcase catalogue: direct vendors only, no web search"


def part_query(part: ShowcasePart) -> OfferQuery:
    """The part's identifiers with a manufacturer, so another shop's product with the same number is
    rejected by `verify_offer`; a manufacturer-tier vendor stands in when the page named no brand."""
    manufacturer = part.manufacturer or (part.vendor.name if part.vendor.tier == "manufacturer" else None)
    return normalize_query(sku=part.sku, mpn=part.mpn, manufacturer=manufacturer)


def direct_offers(part: ShowcasePart, fetcher: Fetcher, now: datetime) -> OfferSet:
    """`OfferSet` for `part` keyed by `query.normalized_key`, from the part page and URL adapters only."""
    return find_offers(
        part_query(part),
        mode="live",
        fetcher=fetcher,
        now=now,
        search_provider=DisabledSearchProvider(DIRECT_ONLY_REASON),
        structured_providers=[AdapterProvider()],
        candidate_urls=[part.url],
    )


__all__ = ["DIRECT_ONLY_REASON", "direct_offers", "part_query"]
