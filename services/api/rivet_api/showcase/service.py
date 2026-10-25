"""Offers for a showcase part: the pre-collected set first, the configured provider otherwise.

Showcase parts are real (a fetched vendor page quotes every SKU), so this path never refuses
them as synthetic. A pre-collected set is served as `provider_mode: "recorded"`, never `live`,
because it was fetched ahead of time from direct vendors only. A live refresh keeps those
offers: discovery is seeded with the part's own vendor page and merged onto the set.
"""

from typing import Any

from rivet_api.offers.engine_provider import map_offers_error
from rivet_api.offers.models import OfferListParams, OfferQuery, OfferSet
from rivet_api.offers.service import build_query, lookup, render, run_as_job, validate_offer_set
from rivet_api.showcase.models import ShowcasePart
from rivet_api.showcase.store import ShowcaseStore

PRECOLLECTED_NOTICE = "Pre-collected offers from the part's direct vendors, fetched ahead of time; not a live lookup."
MORE_VENDORS_NOTICE = "More vendors may be available; search again with refresh=true to run a live search."
MERGED_NOTICE = "Live search results merged with the offers pre-collected from the part's direct vendors."


def part_query(part: ShowcasePart) -> OfferQuery:
    """The engine's `showcase.offers.part_query`, so the pre-collected set's key matches: a
    manufacturer-tier vendor stands in for the manufacturer when the page named no brand."""
    manufacturer = part.manufacturer or (part.vendor.name if part.vendor.tier == "manufacturer" else None)
    return build_query(sku=part.sku, mpn=part.mpn, manufacturer=manufacturer)


def part_offers(product_id: str, part_id: str, params: OfferListParams, refresh: bool, deps: Any) -> tuple[int, dict[str, Any]]:
    store: ShowcaseStore = deps.showcase
    _, part = store.part(product_id, part_id)
    query = part_query(part)
    live = deps.offers_provider.mode == "live"
    precollected = store.precollected(query.normalized_key)
    if precollected is None:
        return lookup(query, params, deps)
    if not (live and refresh):
        return 200, render(_recorded(precollected, query, live), params)
    # Its own cache key, so a plain search for the same identifiers never gets the merged set.
    cache_key = f"showcase:{query.normalized_key}"
    hit = deps.offer_sets.cached(cache_key)
    if hit is not None:
        return 200, render(hit[1], params)

    def work() -> tuple[str, OfferSet]:
        provider = deps.offers_provider
        try:
            raw = provider.find(query, candidate_urls=[str(part.url)])
        except Exception as exc:
            raise map_offers_error(exc) from None
        merged = _merged(precollected, validate_offer_set(raw, provider), query)
        return deps.offer_sets.put(merged, cache_key=cache_key), merged

    return run_as_job(deps, query.normalized_key, work)


def _recorded(offer_set: OfferSet, query: OfferQuery, live: bool) -> OfferSet:
    notices = [PRECOLLECTED_NOTICE, *([MORE_VENDORS_NOTICE] if live else []), *offer_set.notices]
    return offer_set.model_copy(update={"query": query, "provider_mode": "recorded", "notices": notices})


def _merged(precollected: OfferSet, found: OfferSet, query: OfferQuery) -> OfferSet:
    """`found` plus every pre-collected offer it does not already have (same offer id or page URL)."""

    def extend(mine: list, theirs: list) -> list:
        seen = {o.offer_id for o in mine} | {str(o.url) for o in mine}
        return [*mine, *(o for o in theirs if o.offer_id not in seen and str(o.url) not in seen)]

    offers = extend(found.offers, precollected.offers)
    return found.model_copy(
        update={
            "query": query,
            "outcome": found.outcome if found.offers or not offers else precollected.outcome,
            "offers": offers,
            "possible_matches": extend(found.possible_matches, precollected.possible_matches),
            "alternatives": extend(found.alternatives, precollected.alternatives),
            "ledger": [*found.ledger, *precollected.ledger],
            "notices": [MERGED_NOTICE, *found.notices],
        }
    )
