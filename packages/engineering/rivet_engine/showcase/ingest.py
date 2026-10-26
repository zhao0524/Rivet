"""Turn one manifest candidate into a `ShowcaseProduct` or a `Rejection` (plan-showcase.md 3.3).

The source page is fetched and its parts list extracted; every linked part's vendor page is
fetched and must state the SKU in its structured data (`verify_offer.decide` with an exact
match). Price, currency and availability are read from that page or stay None. The gate: at
least four verified parts, every linked part verified, and no more unsourced than sourced parts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from rivet_engine.ecommerce.extract_offer import ExtractedPage, extract_page, money_string
from rivet_engine.ecommerce.identifiers import InvalidIdentifier, canonical_url, normalize_query
from rivet_engine.ecommerce.models import Vendor
from rivet_engine.ecommerce.vendors import vendor_for_url
from rivet_engine.ecommerce.verify_offer import decide
from rivet_engine.showcase.models import (
    Image,
    ManifestEntry,
    Rejection,
    ShowcasePart,
    ShowcaseProduct,
    Source,
    Totals,
)
from rivet_engine.showcase.sources import BomItem, SourceMeta, extract_parts
from rivet_engine.sourcing.evidence import parse_utc, tier_for_url
from rivet_engine.sourcing.fetch import FetchResult, Fetcher

MIN_VERIFIED_PARTS = 4
STALE_AFTER = timedelta(days=30)
EXACT_KINDS = frozenset({"exact_sku", "exact_mpn", "gtin"})
_SKU_IN_PATH = re.compile(r"/products?/(\d+)(?:$|[/?#])")
_SLUG = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Unverified:
    item: BomItem
    reason: str


def timestamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def part_id(vendor: Vendor, sku: str) -> str:
    return _SLUG.sub("-", f"{vendor.id}-{sku}".lower()).strip("-")[:80]


def _fetch_problem(result: FetchResult) -> str | None:
    if result.blocked:
        return result.error or "blocked"
    if result.error:
        return result.error
    if result.status != 200:
        return f"HTTP {result.status}"
    return None


def sku_from_url(url: str) -> str | None:
    m = _SKU_IN_PATH.search(url)
    return m.group(1) if m else None


def claimed_sku(url: str, page: ExtractedPage) -> str | None:
    """The SKU a part page is checked against, and so the one saved for it: the URL's, else the page's."""
    return sku_from_url(url) or page.sku


def verify_part(item: BomItem, fetcher: Fetcher) -> tuple[FetchResult, ExtractedPage, Vendor, object] | Unverified:
    """Fetch the part page and require its structured data to state the SKU named by its URL or itself."""
    result = fetcher.fetch(item.url)
    problem = _fetch_problem(result)
    if problem:
        return Unverified(item, problem)
    page = extract_page(result)
    if page.soft_404:
        return Unverified(item, "page reads as unavailable or not found")
    sku = claimed_sku(item.url, page)
    if not sku:
        return Unverified(item, "page states no SKU")
    try:
        query = normalize_query(sku=sku)
    except InvalidIdentifier as exc:
        return Unverified(item, str(exc))
    vendor = vendor_for_url(item.url)
    decision = decide(query, page, result, vendor)
    if not decision.accepted or decision.kind not in EXACT_KINDS or not decision.evidence_quote:
        return Unverified(item, decision.reason if not decision.accepted else f"only a {decision.kind} match: {decision.reason}")
    return result, page, vendor, decision


def _part(item: BomItem, result: FetchResult, page: ExtractedPage, vendor: Vendor, decision, now: datetime) -> ShowcasePart:
    sku = claimed_sku(item.url, page) or ""
    level = decision.evidence_level if decision.evidence_level in ("verified", "inferred") else "inferred"
    if parse_utc(result.fetched_at) + STALE_AFTER < now:
        level = "stale"
    return ShowcasePart(
        part_id=part_id(vendor, sku),
        name=item.name,
        quantity=item.quantity,
        sku=sku[:64],
        mpn=page.mpn[:64] if page.mpn else None,
        manufacturer=page.brand[:120] if page.brand else None,
        vendor=vendor,
        url=canonical_url(item.url),
        price_amount=page.price,
        currency=page.currency,
        availability=page.availability,
        fetched_at=result.fetched_at,
        source_sha256=result.content_sha256,
        evidence_level=level,
        evidence_quote=decision.evidence_quote,
        bom_quote=item.bom_quote,
    )


def _merge_same_part(parts: list[ShowcasePart]) -> list[ShowcasePart]:
    merged: dict[str, ShowcasePart] = {}
    for part in parts:
        seen = merged.get(part.part_id)
        merged[part.part_id] = seen.model_copy(update={"quantity": seen.quantity + part.quantity}) if seen else part
    return list(merged.values())


def price_total(parts: list[ShowcasePart]) -> tuple[str | None, str | None]:
    """Sum of quantity x price when every part has a price in one currency; (None, None) otherwise."""
    if not parts or any(p.price_amount is None for p in parts):
        return None, None
    currencies = {p.currency for p in parts}
    if len(currencies) != 1:
        return None, None
    total = sum(Decimal(p.price_amount) * p.quantity for p in parts if p.price_amount)
    return money_string(str(total)), currencies.pop()


def _image(entry: ManifestEntry, meta: SourceMeta) -> Image | None:
    url = entry.image_url or meta.image_url
    return Image(url=url, credit=meta.credit, license=meta.license) if url else None


def _summary(entry: ManifestEntry, meta: SourceMeta, items: int, unsourced: int) -> str:
    base = entry.notes or meta.title or entry.name
    text = f"{base}. {items} linked part{'s' if items != 1 else ''} verified on vendor pages"
    if unsourced:
        text += f"; {unsourced} named without a vendor link"
    return (text + ".")[:600]


def ingest(entry: ManifestEntry, fetcher: Fetcher, *, now: datetime | None = None) -> ShowcaseProduct | Rejection:
    """Fetch, extract, verify and gate one candidate.

    `now` defaults to the latest `fetched_at` among the pages used, so a replay over recorded
    pages reproduces the same document."""
    source = fetcher.fetch(entry.source_url)
    problem = _fetch_problem(source)
    if problem:
        return Rejection(product_id=entry.product_id, reason="source_unavailable", details=f"{entry.source_url}: {problem}")
    items, unsourced, meta = extract_parts(source)
    if len(items) < MIN_VERIFIED_PARTS:
        return Rejection(product_id=entry.product_id, reason="too_few_parts",
                         details=f"{len(items)} linked part(s) on the source page; {MIN_VERIFIED_PARTS} needed")
    if len(unsourced) > len(items):
        return Rejection(product_id=entry.product_id, reason="mostly_unsourced",
                         details=f"{len(unsourced)} parts without a vendor link vs {len(items)} linked")
    image = _image(entry, meta)
    if image is None:
        return Rejection(product_id=entry.product_id, reason="no_image", details="source page has no og:image and the manifest gives no image_url")

    verified: list[tuple[BomItem, FetchResult, ExtractedPage, Vendor, object]] = []
    failed: list[Unverified] = []
    for item in items:
        outcome = verify_part(item, fetcher)
        if isinstance(outcome, Unverified):
            failed.append(outcome)
        else:
            verified.append((item, *outcome))
    if failed:
        named = "; ".join(f"{f.item.name} ({f.item.url}): {f.reason}" for f in failed)
        return Rejection(product_id=entry.product_id, reason="unverified_part", details=named[:1000])

    moment = now or max(parse_utc(ts) for ts in [source.fetched_at] + [r.fetched_at for _, r, _, _, _ in verified])
    parts = _merge_same_part([_part(item, result, page, vendor, decision, moment) for item, result, page, vendor, decision in verified])
    total, currency = price_total(parts)
    return ShowcaseProduct(
        product_id=entry.product_id,
        name=entry.name,
        category=entry.category,
        summary=_summary(entry, meta, len(parts), len(unsourced)),
        image=image,
        source=Source(
            url=entry.source_url,
            host_tier=tier_for_url(entry.source_url) or "community",
            title=(meta.title or entry.name)[:200],
            fetched_at=source.fetched_at,
            content_sha256=source.content_sha256,
        ),
        parts=parts,
        unsourced_parts=unsourced,
        totals=Totals(parts_total=len(parts) + len(unsourced), parts_verified=len(parts), price_total_amount=total, currency=currency),
        status="complete" if not unsourced else "partial",
        generated_at=timestamp(moment),
    )


__all__ = ["MIN_VERIFIED_PARTS", "STALE_AFTER", "Unverified", "ingest", "part_id", "price_total", "sku_from_url", "verify_part"]
