"""Deterministic extractors: JSON-LD products, quoted page text, and "kit includes" lists.

Every extractor returns Evidence whose `matched_text` is a literal quote from the fetched page,
so the verifier can re-check the value against the text (gate 3 in the plan, section 6).
"""

from __future__ import annotations

import html as html_lib
import json
import re
from dataclasses import dataclass
from typing import Any

from rivet_engine.sourcing.evidence import Evidence, HostTier, tier_for_url
from rivet_engine.sourcing.fetch import FetchResult

DEFAULT_TTL_DAYS = 14
_LD_BLOCK = re.compile(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def page_text(html: str) -> str:
    """Visible text of a page: tags removed, entities decoded, whitespace collapsed."""
    text = re.sub(r"<(script|style|svg|noscript)\b.*?</\1>", " ", html, flags=re.S | re.I)
    text = _TAG.sub(" ", text)
    return _WS.sub(" ", html_lib.unescape(text)).strip()


def jsonld_products(html: str) -> list[dict[str, Any]]:
    """All schema.org Product objects in the page (top-level, lists and @graph)."""
    products: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            kind = node.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            if "Product" in kinds:
                products.append(node)
            if "@graph" in node:
                walk(node["@graph"])

    for block in _LD_BLOCK.findall(html):
        for candidate in (block, html_lib.unescape(block)):
            try:
                walk(json.loads(candidate))
                break
            except json.JSONDecodeError:
                continue
    return products


def _quote(block: str, key: str, value: str) -> str | None:
    """The `"key": value` snippet from the raw JSON-LD text, so matched_text is a real quote."""
    pattern = re.compile(r'"' + re.escape(key) + r'"\s*:\s*"?' + re.escape(value) + r'"?', re.I)
    for m in pattern.finditer(block):
        return m.group(0)
    return None


def _first(value: Any) -> Any:
    return value[0] if isinstance(value, list) and value else value


def _ev(result: FetchResult, tier: HostTier, claim: str, value: str, extractor: str, matched: str | None) -> Evidence:
    return Evidence(
        claim=claim,  # type: ignore[arg-type]
        value=value,
        source_url=result.url,
        source_host_tier=tier,
        fetched_at=result.fetched_at,
        content_sha256=result.content_sha256,
        extractor=extractor,  # type: ignore[arg-type]
        matched_text=matched,
        ttl_days=DEFAULT_TTL_DAYS,
    )


def evidence_from_jsonld(result: FetchResult) -> list[Evidence]:
    """Evidence for sku, mpn, gtin, brand, name, price, availability and purchase_url from JSON-LD."""
    tier = tier_for_url(result.url)
    if tier is None or not result.ok:
        return []
    raw_blocks = "\n".join(_LD_BLOCK.findall(result.body))
    out: list[Evidence] = []
    for product in jsonld_products(result.body):
        fields: dict[str, Any] = {
            "sku": product.get("sku"),
            "mpn": product.get("mpn"),
            "gtin": product.get("gtin13") or product.get("gtin") or product.get("gtin12"),
            "name": product.get("name"),
        }
        brand = product.get("brand")
        fields["brand"] = brand.get("name") if isinstance(brand, dict) else brand
        offer = _first(product.get("offers")) or {}
        if isinstance(offer, dict):
            fields["price"] = offer.get("price")
            availability = offer.get("availability")
            fields["availability"] = availability.rsplit("/", 1)[-1] if isinstance(availability, str) else None
            fields["purchase_url"] = offer.get("url") or product.get("url")
        for claim, value in fields.items():
            if value is None or value == "":
                continue
            text = str(value)
            key = {"gtin": "gtin13", "price": "price", "purchase_url": "url", "brand": "name", "availability": "availability"}.get(claim, claim)
            quote = _quote(raw_blocks, key, text) or (_quote(raw_blocks, "gtin", text) if claim == "gtin" else None)
            if quote is None and claim == "availability":
                m = re.search(r'"availability"\s*:\s*"[^"]*' + re.escape(text) + '"', raw_blocks)
                quote = m.group(0) if m else None
            out.append(_ev(result, tier, claim, text, "jsonld", quote))
    return out


def find_quote(text: str, value: str, *, context: int = 60) -> str | None:
    """A snippet of visible page text around the first case-insensitive match of `value`."""
    idx = text.casefold().find(value.casefold())
    if idx < 0:
        return None
    return text[max(0, idx - context) : idx + len(value) + context]


def evidence_from_text(result: FetchResult, claim: str, value: str, *, extractor: str = "page-text") -> Evidence | None:
    """Evidence that the visible page text states `value` (datasheet pages use extractor="datasheet")."""
    tier = tier_for_url(result.url)
    if tier is None or not result.ok:
        return None
    quote = find_quote(page_text(result.body), value)
    return _ev(result, tier, claim, value, extractor, quote) if quote else None


@dataclass(frozen=True)
class IncludedItem:
    quantity: int
    name: str
    link: str | None  # product page of the included part when the page links it
    quote: str  # literal page text for this line


_INCLUDES_HEAD = re.compile(r"(kit includes|includes|comes with|in the box|what'?s included)\s*:?", re.I)
_QTY_ITEM = re.compile(r"(\d+)\s*[x×]\s+(.+?)(?=\s+\d+\s*[x×]\s|$)", re.I)
_STOP = re.compile(r"\b(Documents|Technical Details|Features|Specs|Dimensions|Play video|Learn|Recommended Products|Note:|Please note)\b")


def included_items(result: FetchResult) -> list[IncludedItem]:
    """Parse a "Kit includes: 2x Wheels 1x Chassis ..." list, keeping links to part pages when present."""
    body = result.body
    m = _INCLUDES_HEAD.search(page_text(body))
    if not m:
        return []
    text = page_text(body)
    segment = text[m.end() : m.end() + 2500]
    stop = _STOP.search(segment)
    if stop:
        segment = segment[: stop.start()]
    # Links near the includes heading in the raw HTML, keyed by their visible label.
    raw_idx = re.search(_INCLUDES_HEAD, _TAG.sub(" ", body))
    links: dict[str, str] = {}
    if raw_idx:
        head_pos = body.casefold().find(m.group(0).split()[0].casefold())
        window = body[head_pos : head_pos + 20000] if head_pos >= 0 else body
        for href, label in re.findall(r'href="(https?://[^"]+)"[^>]*>\s*([^<]{3,120}?)\s*<', window):
            links.setdefault(_WS.sub(" ", html_lib.unescape(label)).strip().casefold(), href)
    items: list[IncludedItem] = []
    if not _QTY_ITEM.search(segment):
        # Bulleted includes list: one <li><a>Part</a></li> per part, quantity 1 unless stated.
        head_pos = body.casefold().find(m.group(0).split()[0].casefold())
        window = body[head_pos : head_pos + 20000] if head_pos >= 0 else body
        for li in re.findall(r"<li[^>]*>(.*?)</li>", window, re.S)[:60]:
            link = re.search(r'href="(https?://[^"]+)"', li)
            label = _WS.sub(" ", html_lib.unescape(_TAG.sub(" ", li))).strip()
            if not link or not label or len(label) > 120 or re.search(r"\.(css|js|png|jpg|svg)(\?|$)|/static/", link.group(1)):
                continue
            qty = re.match(r"(\d+)\s*[x×]\s+(.+)", label)
            items.append(IncludedItem(int(qty.group(1)) if qty else 1, (qty.group(2) if qty else label).strip(" ,.;"), link.group(1), label))
        return items
    for qty, name in _QTY_ITEM.findall(segment):
        clean = name.strip(" ,.;")
        link = next((href for label, href in links.items() if label and (label in clean.casefold() or clean.casefold() in label)), None)
        items.append(IncludedItem(int(qty), clean, link, f"{qty}x {clean}"))
    return items


__all__ = [
    "DEFAULT_TTL_DAYS",
    "IncludedItem",
    "evidence_from_jsonld",
    "evidence_from_text",
    "find_quote",
    "included_items",
    "jsonld_products",
    "page_text",
]
