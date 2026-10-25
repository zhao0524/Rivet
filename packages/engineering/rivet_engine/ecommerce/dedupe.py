"""Collapse candidate URLs that lead to the same vendor page (plan 3.2 step 5)."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TypeVar

from rivet_engine.ecommerce.identifiers import InvalidUrl, dedupe_key
from rivet_engine.ecommerce.models import LedgerEntry, Offer

T = TypeVar("T")


def unique_candidate_urls(urls: Iterable[str]) -> tuple[list[str], list[LedgerEntry]]:
    """First URL per canonical page wins; later spellings (tracking params, fragments, www.) are
    reported as `duplicate` and non-https URLs as `skipped` so nothing disappears silently."""
    seen: dict[str, str] = {}
    kept: list[str] = []
    ledger: list[LedgerEntry] = []
    for url in urls:
        try:
            key = dedupe_key(url)
        except InvalidUrl as exc:
            ledger.append(LedgerEntry(source="candidates", url=None, status="skipped", reason=str(exc)[:300], checked_at=None))
            continue
        if key in seen:
            ledger.append(LedgerEntry(source="candidates", url=url if url.startswith("https://") else None, status="duplicate",
                                      reason="same canonical URL after dropping tracking params", checked_at=None))
            continue
        seen[key] = url
        kept.append(url)
    return kept, ledger


def dedupe_offers(offers: Sequence[Offer]) -> tuple[list[Offer], list[LedgerEntry]]:
    """One offer per (vendor id, canonical URL); the first occurrence is kept."""
    seen: set[tuple[str, str]] = set()
    kept: list[Offer] = []
    ledger: list[LedgerEntry] = []
    for offer in offers:
        key = (offer.vendor.id, dedupe_key(offer.url))
        if key in seen:
            ledger.append(LedgerEntry(source=offer.vendor.id, url=offer.url, status="duplicate",
                                      reason="same vendor and canonical URL as an earlier offer", checked_at=offer.fetched_at))
            continue
        seen.add(key)
        kept.append(offer)
    return kept, ledger


__all__ = ["dedupe_offers", "unique_candidate_urls"]
