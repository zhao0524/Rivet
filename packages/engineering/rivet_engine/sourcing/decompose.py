"""Product decomposition and category fallbacks (docs/plan-verified-parts.md 5 steps 4-6, 5.3).

`decompose` turns a verified product page into parts with evidence: the page's own "includes"
list (manufacturer/distributor tier) names the parts; parts the page links to are looked up and
their SKUs verified from their own pages. A part without evidence is `not_found`, never guessed.
Materials are reported only where a page states them.

`reference_architecture` and `typical_parts` provide the labelled fallback: sourced reference
entries per category ranked deterministically by how many verified products use them.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib import resources
from typing import Any, Literal

from rivet_engine.sourcing.adapters import ManufacturerPageAdapter, _from_fetch
from rivet_engine.sourcing.evidence import Evidence, Verdict, tier_for_url, verify
from rivet_engine.sourcing.extract import (
    DEFAULT_TTL_DAYS,
    evidence_from_jsonld,
    find_quote,
    included_items,
    page_text,
)
from rivet_engine.sourcing.fetch import FetchResult, Fetcher

PartStatus = Literal["verified", "inferred", "not_found"]
Outcome = Literal["exact_match", "partial_match", "no_match_with_alternatives", "unsupported"]

_MATERIAL = re.compile(r"\b(material|made of|made from|constructed (?:of|from))\b\s*:?\s*([A-Za-z][A-Za-z0-9 ,/\-]{2,40})", re.I)
_PART_PAGE = re.compile(r"https://www\.(adafruit\.com/products?/\d+|sparkfun\.com/(?:products/\d+|[a-z0-9-]+\.html))$")


@dataclass
class Part:
    name: str
    quantity: int
    status: PartStatus
    sku: Verdict | None
    name_evidence: list[Evidence]
    material: Verdict | None = None
    price: Verdict | None = None
    purchase_url: Verdict | None = None
    source_url: str | None = None
    reason: str = ""


@dataclass
class Decomposition:
    product_url: str
    parts: list[Part]
    outcome: Outcome
    reason: str
    fetch_errors: list[str] = field(default_factory=list)

    @property
    def counts(self) -> dict[str, int]:
        out = {"verified": 0, "inferred": 0, "not_found": 0}
        for p in self.parts:
            out[p.status] += 1
        return out


def _part_from_page(name: str, quantity: int, quote_ev: Evidence, link: str, fetcher: Fetcher, now: datetime) -> Part:
    result = fetcher.fetch(link)
    early = _from_fetch("part-page", name, result)
    if early:
        return Part(name, quantity, "not_found", None, [quote_ev], source_url=link, reason=f"part page: {early.reason}")
    records = evidence_from_jsonld(result)
    sku = verify("sku", records, now=now)
    if sku.status != "verified":
        return Part(name, quantity, "not_found", sku, [quote_ev], source_url=link, reason=f"part page has no verifiable SKU ({sku.reason or sku.status})")
    material = _material_from_page(result)
    return Part(
        name,
        quantity,
        "verified",
        sku,
        [quote_ev],
        material=verify("material", [material], now=now) if material else None,
        price=verify("price", records, now=now),
        purchase_url=verify("purchase_url", records, now=now),
        source_url=link,
    )


def _material_from_page(result: FetchResult) -> Evidence | None:
    text = page_text(result.body)
    m = _MATERIAL.search(text)
    if not m or tier_for_url(result.url) is None:
        return None
    value = m.group(2).strip(" ,.;")
    return Evidence(
        claim="material",
        value=value,
        source_url=result.url,
        source_host_tier=tier_for_url(result.url),  # type: ignore[arg-type]
        fetched_at=result.fetched_at,
        content_sha256=result.content_sha256,
        extractor="page-text",
        matched_text=find_quote(text, value),
        ttl_days=DEFAULT_TTL_DAYS,
    )


def decompose(product_url: str, fetcher: Fetcher, *, now: datetime | None = None) -> Decomposition:
    """Parts of the product at `product_url` with evidence; outcome per plan section 4."""
    now = now or datetime.now(timezone.utc)
    result = fetcher.fetch(product_url)
    early = _from_fetch("product-page", product_url, result)
    if early:
        outcome: Outcome = "no_match_with_alternatives" if early.status == "not_found" else "unsupported"
        return Decomposition(product_url, [], outcome, f"product page: {early.reason}", fetch_errors=[early.reason])
    tier = tier_for_url(product_url)
    records = evidence_from_jsonld(result)
    product_sku = verify("sku", records, now=now)
    if product_sku.status != "verified" or tier is None:
        return Decomposition(product_url, [], "no_match_with_alternatives", f"product SKU not verifiable: {product_sku.reason or product_sku.status}")

    parts: list[Part] = []
    errors: list[str] = []
    for item in included_items(result):
        quote_ev = Evidence(
            claim="part",
            value=item.name,
            source_url=product_url,
            source_host_tier=tier,
            fetched_at=result.fetched_at,
            content_sha256=result.content_sha256,
            extractor="page-text",
            matched_text=item.quote,
            ttl_days=DEFAULT_TTL_DAYS,
        )
        if item.link and _PART_PAGE.match(item.link):
            part = _part_from_page(item.name, item.quantity, quote_ev, item.link, fetcher, now)
            if part.status == "not_found":
                errors.append(part.reason)
        else:
            # The official page names the part but gives it no SKU or page: it exists, but is not a buyable item.
            part = Part(item.name, item.quantity, "not_found", None, [quote_ev], source_url=product_url, reason="named on the product page but no SKU or part page is published")
        parts.append(part)

    if not parts:
        # A leaf product (a motor, a sensor) is its own bill of materials: one verified part.
        name = verify("name", records, now=now)
        material = _material_from_page(result)
        self_part = Part(
            name.value or product_sku.value or product_url,
            1,
            "verified",
            product_sku,
            name.evidence,
            material=verify("material", [material], now=now) if material else None,
            price=verify("price", records, now=now),
            purchase_url=verify("purchase_url", records, now=now),
            source_url=product_url,
        )
        return Decomposition(product_url, [self_part], "exact_match", "the product is a single part with a verified SKU", fetch_errors=errors)
    counts = {p.status for p in parts}
    if counts == {"verified"}:
        return Decomposition(product_url, parts, "exact_match", "every listed part has a verified SKU", fetch_errors=errors)
    missing = sum(1 for p in parts if p.status != "verified")
    return Decomposition(product_url, parts, "partial_match", f"could not confirm {missing} of {len(parts)} parts", fetch_errors=errors)


# --- reference architectures (5.3) -------------------------------------------------


@dataclass(frozen=True)
class ReferenceEntry:
    category: str
    role: str
    name: str
    sku: str
    vendor: str
    source_url: str
    spec: dict[str, Any]
    used_by: tuple[str, ...]  # verified products known to use this part (or a part of this class)


def load_reference_architectures() -> dict[str, dict[str, Any]]:
    path = resources.files("rivet_engine").joinpath("data/sourcing/reference_architectures.json")
    return json.loads(path.read_text(encoding="utf-8"))


def reference_architecture(category: str) -> dict[str, Any] | None:
    return load_reference_architectures().get(category)


def _entries(category: str) -> list[ReferenceEntry]:
    arch = reference_architecture(category) or {}
    out: list[ReferenceEntry] = []
    for role in arch.get("roles", []):
        for part in role.get("typical_parts", []):
            out.append(
                ReferenceEntry(
                    category, role["role"], part["name"], part["sku"], part["vendor"], part["source_url"],
                    part.get("spec", {}), tuple(part.get("used_by", [])),
                )
            )
    return out


@dataclass
class TypicalPart:
    role: str
    entry: ReferenceEntry | None
    sku: Verdict | None
    label: str  # always "typical for category"
    reason: str


def typical_parts(category: str, fetcher: Fetcher, *, roles: list[str] | None = None, now: datetime | None = None) -> list[TypicalPart]:
    """Fallback suggestions, ranked by how many verified products use each entry; SKUs re-verified."""
    now = now or datetime.now(timezone.utc)
    arch = reference_architecture(category)
    if arch is None:
        return []
    wanted = roles if roles is not None else [r["role"] for r in arch["roles"]]
    comparable = len(arch.get("comparable_products", []))
    entries = _entries(category)
    out: list[TypicalPart] = []
    for role in wanted:
        candidates = sorted((e for e in entries if e.role == role), key=lambda e: (-len(e.used_by), e.sku))
        if not candidates:
            out.append(TypicalPart(role, None, None, "typical for category", "no sourced reference part yet"))
            continue
        best = candidates[0]
        lookup = ManufacturerPageAdapter(best.source_url).lookup(best.sku, fetcher)
        # Reference entries store the SKU exactly as the vendor's JSON-LD prints it (e.g. "3801", "ROB-13301").
        sku = verify("sku", lookup.evidence, now=now, expected_value=best.sku)
        reason = (
            f"{len(best.used_by)} of {comparable} comparable {category.replace('_', ' ')}s include a part in this class"
            if comparable
            else "reference part for this role; no comparable products recorded yet"
        )
        if sku.status != "verified":
            reason += f"; SKU could not be re-verified ({lookup.reason or sku.status})"
        out.append(TypicalPart(role, best, sku, "typical for category", reason))
    return out


__all__ = [
    "Decomposition",
    "Outcome",
    "Part",
    "PartStatus",
    "ReferenceEntry",
    "TypicalPart",
    "decompose",
    "load_reference_architectures",
    "reference_architecture",
    "typical_parts",
]
