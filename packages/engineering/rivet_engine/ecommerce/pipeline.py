"""Offer discovery pipeline (docs/e-commerce-layer/plan.md 3.2 steps 1 to 6).

`find_offers` turns a normalised query into an `OfferSet` with an explicit outcome. Every
source consulted lands in the ledger, including the ones that produced nothing, and every
offer field comes from a fetched page with its timestamp and hash. Synthetic `demo.*` parts are
refused before any lookup.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Literal

from rivet_engine.ecommerce.dedupe import dedupe_offers
from rivet_engine.ecommerce.extract_offer import ExtractedPage, detect_pack, extract_page
from rivet_engine.ecommerce.identifiers import InvalidUrl, canonical_url, dedupe_key, is_synthetic_catalog_id, offer_id
from rivet_engine.ecommerce.models import (
    GTIN_PATTERN,
    LedgerEntry,
    Offer,
    OfferLinkStatus,
    OfferQuery,
    OfferSet,
    Outcome,
    ProviderMode,
    Reliability,
    Vendor,
)
from rivet_engine.ecommerce.providers import (
    BraveSearchProvider,
    DisabledSearchProvider,
    OffersProviderError,
    RecordedSearchProvider,
    SearchProvider,
    StructuredApiProvider,
    StubOffersProvider,
    default_fetcher,
    default_structured_providers,
    ledger_source,
)
from rivet_engine.ecommerce.scoring import rank, score_offers
from rivet_engine.ecommerce.vendors import is_denylisted, is_synthetic_vendor, vendor_for_url
from rivet_engine.ecommerce.verify_offer import Decision, decide
from rivet_engine.sourcing.adapters import LookupResult
from rivet_engine.sourcing.fetch import FetchResult, Fetcher

HONESTY_NOTICE = "Prices and stock are as of the check time and may have changed. Rivet does not sell parts."
NOT_FOUND_NOTICE = "No vendor page quoting this SKU was found. No link is shown because none was verified."
SYNTHETIC_NOTICE = "SYNTHETIC TEST-ONLY offers: vendors on *.example hosts were never fetched."
REFUSED_NOTICE = "This part is a synthetic placeholder. There is nothing to buy."
STOCK_UNKNOWN_NOTICE = "Stock status was not stated on the vendor page."
CURRENCY_NOTICE = "Offers in {currencies} are listed separately; Rivet does not convert currencies."
STALE_NOTICE = "Some offers were checked more than 30 days ago and are marked stale."
DEMOTED_NOTICE = "Some offers are demoted (broken link or price far below the median); check them carefully."
DISCONTINUED_NOTICE = "The vendor page marks this part discontinued; alternatives, when linked, are listed separately."
PARTIAL_NOTICE = "{count} source{s} could not be checked ({statuses}); results are partial."
NEEDS_KEY_REASON = {"mouser-api": "MOUSER_API_KEY not set", "digikey-api": "DIGIKEY_CLIENT_ID not set"}
BLOCKED_HTTP = frozenset({401, 403, 429, 451})
GONE_HTTP = frozenset({404, 410})

LinkChecks = Mapping[str, str] | Callable[[str], str | None]
Mode = Literal["stub", "recorded", "live"]


def _timestamp(now: datetime) -> str:
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entry(source: str, url: str | None, status: str, reason: str, checked_at: str | None) -> LedgerEntry:
    safe_url = url if url and url.startswith("https://") else None
    return LedgerEntry(source=source[:64], url=safe_url, status=status, reason=reason[:300], checked_at=checked_at)


def _refused(query: OfferQuery, mode: ProviderMode, now: datetime, reason: str, notice: str) -> OfferSet:
    return OfferSet(
        query=query,
        outcome="refused",
        provider_mode=mode,
        synthetic=False,
        generated_at=_timestamp(now),
        offers=[],
        possible_matches=[],
        alternatives=[],
        ledger=[_entry("catalog", None, "skipped", reason, None)],
        notices=[notice],
    )


def _fetch_problem(source: str, result: FetchResult) -> LedgerEntry | None:
    """Ledger entry for a fetch that yielded no readable page; None when the page can be read."""
    if result.blocked:
        return _entry(source, result.url, "blocked", result.error or "blocked", result.fetched_at)
    if result.error and result.error.startswith("not recorded"):
        return _entry(source, result.url, "skipped", result.error, None)
    if result.error:
        return _entry(source, result.url, "error", result.error, result.fetched_at)
    if result.status in GONE_HTTP:
        return _entry(source, result.url, "not_found", f"HTTP {result.status}", result.fetched_at)
    if result.status in BLOCKED_HTTP:
        return _entry(source, result.url, "blocked", f"HTTP {result.status}", result.fetched_at)
    if result.status != 200:
        return _entry(source, result.url, "error", f"HTTP {result.status}", result.fetched_at)
    return None


def _link_status(url: str, link_checks: LinkChecks | None) -> OfferLinkStatus:
    if link_checks is None:
        return "pass"
    if callable(link_checks):
        found = link_checks(url)
    else:
        found = link_checks.get(url) or link_checks.get(canonical_url(url))
    return found if found in ("pass", "broken", "blocked", "error", "unchecked") else "pass"


def _lookup_page_url(result: LookupResult) -> str | None:
    """Product page for a found lookup: the page itself, or the purchase URL an API response quoted."""
    if result.url and not result.url.startswith("https://api."):
        return result.url
    for ev in result.evidence:
        if ev.claim == "purchase_url" and ev.value.startswith("https://"):
            return ev.value
    return None


def _build_offer(page: ExtractedPage, vendor: Vendor, decision: Decision, *, link_status: OfferLinkStatus,
                 query: OfferQuery) -> Offer:
    gtin = page.gtin if page.gtin and GTIN_PATTERN.match(page.gtin) else None
    sku = page.sku or (query.sku if decision.kind == "exact_sku" else None)
    mpn = page.mpn or (query.mpn if decision.kind == "exact_mpn" else None)
    return Offer(
        offer_id=offer_id(vendor.id, page.url),
        sku=sku[:64] if sku else None,
        mpn=mpn[:64] if mpn else None,
        gtin=gtin,
        vendor=vendor,
        url=canonical_url(page.url),
        price_amount=page.price,
        currency=page.currency,
        availability=page.availability,
        min_order_qty=1 if page.price is not None else None,
        pack=detect_pack(page.name, page.sku),
        shipping=None,
        rating=page.rating,
        match=decision.match,
        fetched_at=page.fetched_at,
        evidence_level=decision.evidence_level,
        link_status=link_status,
        reliability=Reliability(score=0, factors=[]),
        status="ok",
        source_sha256=page.content_sha256,
    )


def _offer_reason(page: ExtractedPage, decision: Decision) -> str:
    price = f"price {page.price} {page.currency}" if page.price else ("no price on page" if page.currency is None else f"no price; currency {page.currency}")
    stock = page.availability if page.availability != "unknown" else "no availability field"
    return f"{decision.reason}; {price}; {stock}"


class _Run:
    def __init__(self, query: OfferQuery, mode: ProviderMode, fetcher: Fetcher, now: datetime, link_checks: LinkChecks | None):
        self.query = query
        self.mode = mode
        self.fetcher = fetcher
        self.now = now
        self.link_checks = link_checks
        self.ledger: list[LedgerEntry] = []
        self.offers: list[Offer] = []
        self.possible: list[Offer] = []
        self.alternatives: list[Offer] = []
        self.provider_errors: list[OffersProviderError] = []
        self.candidates: dict[str, tuple[str, str]] = {}

    def add_candidate(self, source: str, url: str) -> None:
        try:
            key = dedupe_key(url)
        except InvalidUrl as exc:
            self.ledger.append(_entry(source, None, "skipped", str(exc), None))
            return
        if key in self.candidates:
            self.ledger.append(_entry(source, url, "duplicate", "same canonical URL after dropping tracking params", None))
            return
        self.candidates[key] = (source, url)

    def consult_structured(self, providers: Sequence[StructuredApiProvider]) -> None:
        for provider in providers:
            for result in provider.lookup(self.query, self.fetcher):
                source = ledger_source(result)
                if result.status == "found":
                    page_url = _lookup_page_url(result)
                    if page_url:
                        self.add_candidate(source, page_url)
                    else:
                        self.ledger.append(_entry(source, result.url, "skipped", "API response quoted no product page URL", None))
                elif result.status == "needs_api_key":
                    self.ledger.append(_entry(source, None, "needs_api_key", NEEDS_KEY_REASON.get(source, result.reason), None))
                elif result.status == "unsupported":
                    self.ledger.append(_entry(source, None, "skipped", result.reason, None))
                elif result.reason.startswith("not recorded"):
                    self.ledger.append(_entry(source, result.url, "skipped", result.reason, None))
                else:
                    checked = self.fetcher.fetch(result.url).fetched_at if result.url else None
                    reason = "HTTP 404" if result.reason == "page returned 404" else result.reason
                    self.ledger.append(_entry(source, result.url, result.status, reason, checked))

    def consult_search(self, provider: SearchProvider) -> None:
        if provider.disabled_reason:
            self.ledger.append(_entry(provider.name, None, "skipped", provider.disabled_reason, None))
            return
        try:
            urls = provider.search(self.query)
        except OffersProviderError as exc:
            self.provider_errors.append(exc)
            self.ledger.append(_entry(exc.provider, None, "error", f"{exc.code}: {exc.message}", _timestamp(self.now)))
            return
        if not urls:
            self.ledger.append(_entry(provider.name, None, "not_found", "no results for the identifiers", _timestamp(self.now)))
        for url in urls:
            self.add_candidate(provider.name, url)

    def visit(self, source: str, url: str) -> None:
        if is_denylisted(url):
            self.ledger.append(_entry(source, url, "dropped_denylisted", "price aggregator or affiliate domain", None))
            return
        result = self.fetcher.fetch(url)
        problem = _fetch_problem(source, result)
        if problem:
            self.ledger.append(problem)
            return
        vendor = vendor_for_url(url)
        page = extract_page(result)
        decision = decide(self.query, page, result, vendor)
        if page.soft_404:
            status = "dropped_unavailable" if decision.accepted else "dropped_soft_404"
            self.ledger.append(_entry(vendor.id, url, status, f"200 page reads as unavailable or not found; {decision.reason}", result.fetched_at))
            return
        if not decision.accepted:
            self.ledger.append(_entry(vendor.id, url, "dropped_no_identifier", decision.reason, result.fetched_at))
            return
        offer = _build_offer(page, vendor, decision, link_status=_link_status(url, self.link_checks), query=self.query)
        if decision.kind == "fuzzy":
            self.possible.append(offer)
            self.ledger.append(_entry(vendor.id, url, "possible_match", _offer_reason(page, decision), result.fetched_at))
            return
        self.offers.append(offer)
        self.ledger.append(_entry(vendor.id, url, "offer", _offer_reason(page, decision), result.fetched_at))
        if page.availability == "discontinued":
            for related in page.related_urls:
                self.visit_alternative(vendor.id, related)

    def visit_alternative(self, source: str, url: str) -> None:
        """A page the discontinued product's page links as its replacement, verified on its own SKU."""
        if is_denylisted(url):
            return
        result = self.fetcher.fetch(url)
        problem = _fetch_problem(source, result)
        if problem:
            self.ledger.append(problem)
            return
        page = extract_page(result)
        if not (page.sku or page.mpn) or page.soft_404:
            self.ledger.append(_entry(source, url, "dropped_no_identifier", "linked replacement page states no SKU", result.fetched_at))
            return
        own = OfferQuery(sku=page.sku, mpn=page.mpn, gtin=None, manufacturer=None, catalog_id=None,
                         normalized_key=f"{(page.sku or '').casefold()}|{(page.mpn or '').casefold()}||")
        vendor = vendor_for_url(url)
        decision = decide(own, page, result, vendor)
        if not decision.accepted or decision.kind == "fuzzy":
            self.ledger.append(_entry(source, url, "dropped_no_identifier", decision.reason, result.fetched_at))
            return
        self.alternatives.append(_build_offer(page, vendor, decision, link_status=_link_status(url, self.link_checks), query=own))
        self.ledger.append(_entry(vendor.id, url, "offer", f"alternative linked from a discontinued page; {_offer_reason(page, decision)}", result.fetched_at))

    def finish(self) -> OfferSet:
        offers, dup = dedupe_offers(self.offers)
        possible, dup_possible = dedupe_offers(self.possible)
        alternatives, dup_alt = dedupe_offers(self.alternatives)
        self.ledger.extend(dup + dup_possible + dup_alt)
        offers = rank(score_offers(offers, now=self.now))
        possible = rank(score_offers(possible, now=self.now))
        alternatives = rank(score_offers(alternatives, now=self.now))
        if not offers and not possible and self.provider_errors:
            raise self.provider_errors[0]
        failed = [e for e in self.ledger if e.status in ("blocked", "error")]
        outcome: Outcome = ("partial" if failed else "found") if offers else "not_found"
        everything = offers + possible + alternatives
        notices: list[str] = []
        if any(is_synthetic_vendor(o.vendor) for o in everything):
            notices.append(SYNTHETIC_NOTICE)
        if failed:
            statuses = ", ".join(sorted({e.status for e in failed}))
            notices.append(PARTIAL_NOTICE.format(count=len(failed), s="" if len(failed) == 1 else "s", statuses=statuses))
        for exc in self.provider_errors:
            notices.append(f"{exc.provider} failed ({exc.code}); other sources were still checked.")
        currencies = sorted({o.currency for o in offers if o.currency and o.price_amount})
        if len(currencies) > 1:
            notices.append(CURRENCY_NOTICE.format(currencies=", ".join(currencies)))
        if any(o.status == "stale" for o in offers):
            notices.append(STALE_NOTICE)
        if any(o.status == "demoted" for o in offers):
            notices.append(DEMOTED_NOTICE)
        if any(o.availability == "discontinued" for o in offers):
            notices.append(DISCONTINUED_NOTICE)
        if offers and any(o.availability == "unknown" for o in offers):
            notices.append(STOCK_UNKNOWN_NOTICE)
        notices.append(HONESTY_NOTICE if offers else NOT_FOUND_NOTICE)
        return OfferSet(
            query=self.query,
            outcome=outcome,
            provider_mode=self.mode,
            synthetic=any(is_synthetic_vendor(o.vendor) for o in everything),
            generated_at=_timestamp(self.now),
            offers=offers,
            possible_matches=possible,
            alternatives=alternatives,
            ledger=self.ledger,
            notices=notices,
        )


def find_offers(
    query: OfferQuery,
    *,
    mode: Mode = "stub",
    fetcher: Fetcher | None = None,
    now: datetime | None = None,
    link_checks: LinkChecks | None = None,
    search_provider: SearchProvider | None = None,
    structured_providers: Sequence[StructuredApiProvider] | None = None,
    candidate_urls: Sequence[str] = (),
    stub_provider: StubOffersProvider | None = None,
) -> OfferSet:
    """Find, verify, dedupe, score and rank offers for `query`.

    `stub` answers only from `fixtures/offers`; `recorded` replays saved pages (search is a lookup
    of the recorded index); `live` fetches politely and searches with Brave when a key is set.
    `link_checks` maps a URL to its last link-check status; `candidate_urls` are extra pages to
    verify. Raises `OffersProviderError` only when a live provider failed and nothing else answered.
    """
    now = now or datetime.now(timezone.utc)
    if mode == "stub":
        found = (stub_provider or StubOffersProvider()).find(query)
        if found is not None:
            return found
    if is_synthetic_catalog_id(query.catalog_id):
        return _refused(query, mode, now, f"{query.catalog_id} is a synthetic placeholder with no SKU; nothing to search", REFUSED_NOTICE)
    if not (query.sku or query.mpn or query.gtin):
        return _refused(query, mode, now, "query has no SKU, MPN or GTIN; nothing to search", "No identifier was given, so no vendor was searched.")
    if mode == "stub":
        return OfferSet(
            query=query,
            outcome="not_found",
            provider_mode="stub",
            synthetic=False,
            generated_at=_timestamp(now),
            offers=[],
            possible_matches=[],
            alternatives=[],
            ledger=[_entry("stub", None, "not_found", "no fixture for this normalised key; stub mode never searches", None)],
            notices=[NOT_FOUND_NOTICE],
        )
    if mode not in ("recorded", "live"):
        raise ValueError(f"unknown offers mode {mode!r}")
    fetcher = fetcher or default_fetcher(mode)
    run = _Run(query, mode, fetcher, now, link_checks)
    run.consult_structured(structured_providers if structured_providers is not None else default_structured_providers())
    if search_provider is None:
        if mode == "recorded":
            run.ledger.append(_entry("brave-search", None, "skipped", "recorded mode: no web search", None))
            indexes = getattr(fetcher, "indexes", None)
            search_provider = RecordedSearchProvider(indexes) if indexes else DisabledSearchProvider("fetcher has no recorded index")
        else:
            search_provider = BraveSearchProvider()
    run.consult_search(search_provider)
    for url in candidate_urls:
        run.add_candidate("caller", url)
    for source, url in list(run.candidates.values()):
        run.visit(source, url)
    return run.finish()


__all__ = [
    "HONESTY_NOTICE",
    "NOT_FOUND_NOTICE",
    "REFUSED_NOTICE",
    "SYNTHETIC_NOTICE",
    "find_offers",
]
