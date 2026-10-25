"""Orchestration for the offers routes: catalog lookup, provider call, validation, store, view.

The provider proposes an `OfferSet`; this layer re-validates it against the contract (so a
non-https link or a price without a currency is a 502, never a response), refuses synthetic
parts before any provider is called, and decides whether an answer is immediate or a job.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from rivet_api.errors import ApiError
from rivet_api.offers.engine_provider import map_offers_error
from rivet_api.offers.models import InvalidIdentifier, LedgerEntry, OfferListParams, OfferQuery, OfferSet
from rivet_api.offers.provider import OffersProvider
from rivet_api.offers.ranking import view
from rivet_api.offers.store import OfferSetStore
from rivet_api.orchestration.jobs import JobSnapshot
from rivet_api.provenance import is_synthetic_catalog_id

log = logging.getLogger("rivet_api")

OFFER_STAGES = ["catalog_selection", "complete"]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_query(**identifiers: str | None) -> OfferQuery:
    try:
        return OfferQuery.build(**identifiers)
    except InvalidIdentifier as exc:
        raise ApiError("INVALID_IDENTIFIER", str(exc), 400) from None


def part_query(catalog_id: str, catalog: list[dict[str, Any]]) -> OfferQuery:
    """Identifiers for a catalog part; 404 when unknown, 422 for synthetic demo parts."""
    entry = next((e for e in catalog if e.get("catalog_id") == catalog_id), None)
    if entry is None:
        raise ApiError("PART_NOT_FOUND", "No such catalog part", 404, {"catalog_id": catalog_id})
    identity = entry.get("identity") or {}
    if is_synthetic_catalog_id(catalog_id, catalog):
        raise ApiError(
            "EXPORT_REFUSED_SYNTHETIC",
            "Offers are not searched for a synthetic demo part; it has no real SKU and nothing to buy",
            422,
            {"catalog_id": catalog_id},
        )
    return build_query(sku=identity.get("sku") or None, manufacturer=identity.get("manufacturer") or None, catalog_id=catalog_id)


def refused_set(query: OfferQuery, mode: str, reason: str) -> OfferSet:
    now = _now()
    return OfferSet(
        schema_version="1.0",
        query=query,
        outcome="refused",
        provider_mode=mode,
        synthetic=False,
        generated_at=now,
        offers=[],
        possible_matches=[],
        alternatives=[],
        ledger=[LedgerEntry(source="rivet-api", url=None, status="skipped", reason=reason, checked_at=now)],
        notices=[reason],
    )


def validate_offer_set(raw: Any, provider: OffersProvider) -> OfferSet:
    try:
        offer_set = raw if isinstance(raw, OfferSet) else OfferSet.model_validate(raw)
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in e["loc"]) for e in exc.errors()})[:8]
        log.warning("offers provider %s returned a malformed offer set: %s", provider.name, fields)
        raise ApiError("PROVIDER_ERROR", "The offers provider returned a malformed offer set", 502, {"fields": fields}) from None
    if provider.mode == "live" and offer_set.synthetic:
        raise ApiError(
            "SYNTHETIC_OFFERS_IN_LIVE_SET",
            "A live offers lookup returned synthetic test vendors; only real fetched pages may be served as live",
            502,
        )
    return offer_set


def fetch_and_store(query: OfferQuery, provider: OffersProvider, store: OfferSetStore) -> tuple[str, OfferSet]:
    try:
        raw = provider.find(query)
    except Exception as exc:
        raise map_offers_error(exc) from None
    offer_set = validate_offer_set(raw, provider)
    return store.put(offer_set), offer_set


def run_as_job(deps: Any, label: str, work: Any) -> tuple[int, dict[str, Any]]:
    """Run `work() -> (offer_set_id, OfferSet)` as an offers job; 202 with the job id."""
    job = deps.jobs.create("offers", planned_stages=OFFER_STAGES)

    def run(snapshot: JobSnapshot) -> None:
        deps.jobs.emit(snapshot.job_id, "catalog_selection", "system", "running", f"Looking for offers for {label}")
        offer_set_id, offer_set = work()
        deps.jobs.emit(
            snapshot.job_id,
            "catalog_selection",
            "system",
            "ok" if offer_set.outcome in ("found", "partial") else "warning",
            f"{len(offer_set.offers)} verified offers, outcome {offer_set.outcome}",
        )
        deps.jobs.complete_offer_set(snapshot.job_id, offer_set_id)

    deps.jobs.run(job.job_id, run)
    return 202, {"job_id": job.job_id, "status": "queued", "offer_set_id": None}


def render(offer_set: OfferSet, params: OfferListParams | None = None) -> dict[str, Any]:
    if params is None:
        return offer_set.model_dump(mode="json")
    return offer_set.model_copy(update={"offers": view(offer_set.offers, params)}).model_dump(mode="json")


def lookup(query: OfferQuery, params: OfferListParams, deps: Any) -> tuple[int, dict[str, Any]]:
    """`(200, OfferSet)` from cache or a synchronous provider; `(202, job)` for a live miss."""
    provider: OffersProvider = deps.offers_provider
    store: OfferSetStore = deps.offer_sets
    if query.sku is None and query.mpn is None and query.gtin is None:
        return 200, render(refused_set(query, provider.mode, "The catalog has no SKU for this part, so no offers were searched."), params)
    hit = store.cached(query.normalized_key)
    if hit is not None:
        return 200, render(hit[1], params)
    if provider.mode != "live":
        _, offer_set = fetch_and_store(query, provider, store)
        return 200, render(offer_set, params)
    return run_as_job(deps, query.normalized_key, lambda: fetch_and_store(query, provider, store))
