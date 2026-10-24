"""Read price, stock, rating and identifiers from one fetched page (plan 3.2 step 4).

Only two places may supply a price: the JSON-LD `offers.price` of a Product block or a literal
quote of the visible text. Anything else stays None. Page text is untrusted input: it is
matched and quoted, never interpreted as an instruction.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from rivet_engine.ecommerce.models import MONEY_PATTERN, Availability, Pack, Rating
from rivet_engine.sourcing.extract import _LD_BLOCK, find_quote, jsonld_products, page_text
from rivet_engine.sourcing.fetch import FetchResult

SCHEMA_AVAILABILITY: dict[str, Availability] = {
    "instock": "in_stock",
    "instoreonly": "in_stock",
    "onlineonly": "in_stock",
    "limitedavailability": "in_stock",
    "outofstock": "out_of_stock",
    "soldout": "out_of_stock",
    "backorder": "backorder",
    "preorder": "backorder",
    "presale": "backorder",
    "discontinued": "discontinued",
}

SOFT_404 = re.compile(
    r"\b(product (is )?unavailable|page not found|404 not found|item (is )?no longer available|"
    r"this product is not available|we couldn'?t find that page|product not found|"
    r"the page you requested (was|could) not (be )?found|sorry, this listing has ended)\b",
    re.I,
)
DISCONTINUED_TEXT = re.compile(r"\b(discontinued|no longer manufactured|end of life)\b", re.I)
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_PACK_PATTERNS = (
    re.compile(r"\bpack of (\d{1,3})\b", re.I),
    re.compile(r"\b(\d{1,3})[ -]?(?:pack|pk|pcs|pieces|count|ct)\b", re.I),
    re.compile(r"\(\s*(\d{1,3})\s*\)"),
    re.compile(r"(?:^|\s)[x×]\s?(\d{1,3})\b", re.I),
    re.compile(r"\b(\d{1,3})\s?[x×](?=\s|$)", re.I),
)


@dataclass(frozen=True)
class ExtractedPage:
    url: str
    fetched_at: str
    content_sha256: str
    text: str
    raw_jsonld: str
    product: dict[str, Any] | None
    name: str | None
    sku: str | None
    mpn: str | None
    gtin: str | None
    brand: str | None
    price: str | None
    currency: str | None
    availability: Availability
    availability_quote: str | None
    rating: Rating | None
    soft_404: bool
    related_urls: list[str] = field(default_factory=list)


def money_string(value: Any) -> str | None:
    """A JSON-LD or API price as the contract's Money string; zero, negative and junk are None."""
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip().replace(",", "")
    if text.startswith("-"):
        return None
    text = re.sub(r"^[^\d.]+|[^\d.]+$", "", text)
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return None
    if not amount.is_finite() or amount <= 0:
        return None
    rendered = f"{amount.quantize(Decimal('0.0001')).normalize():f}"
    if "." in rendered:
        whole, frac = rendered.split(".")
        rendered = f"{whole}.{frac.ljust(2, '0')}"
    else:
        rendered = f"{rendered}.00"
    return rendered if MONEY_PATTERN.match(rendered) else None


def map_availability(value: Any) -> Availability:
    if not isinstance(value, str):
        return "unknown"
    key = value.rsplit("/", 1)[-1].strip().casefold().replace(" ", "")
    return SCHEMA_AVAILABILITY.get(key, "unknown")


def _first(value: Any) -> Any:
    return value[0] if isinstance(value, list) and value else value


def _text(value: Any) -> str | None:
    if isinstance(value, dict):
        value = value.get("name")
    if value is None or isinstance(value, (dict, list, bool)):
        return None
    text = str(value).strip()
    return text or None


def _count(value: Any) -> int | None:
    try:
        count = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return count if count >= 1 else None


def rating_from_product(product: dict[str, Any]) -> Rating | None:
    """`aggregateRating` with at least one review; anything less is None, never 0."""
    aggregate = _first(product.get("aggregateRating"))
    if not isinstance(aggregate, dict):
        return None
    count = _count(aggregate.get("ratingCount")) or _count(aggregate.get("reviewCount"))
    try:
        value = float(str(aggregate.get("ratingValue")).strip())
        scale = float(str(aggregate.get("bestRating", 5)).strip())
    except (TypeError, ValueError):
        return None
    if count is None or value < 0 or scale <= 0 or value != value:
        return None
    return Rating(value=value, count=count, scale=int(scale) if scale.is_integer() else scale, source="jsonld_aggregate_rating")


def detect_pack(*texts: str | None) -> Pack:
    for text in texts:
        if not text:
            continue
        for pattern in _PACK_PATTERNS:
            m = pattern.search(text)
            if m and int(m.group(1)) > 1:
                return Pack(quantity=int(m.group(1)), unit_price_basis="per_pack")
    return Pack(quantity=1, unit_price_basis="per_unit")


def _related_urls(html: str) -> list[str]:
    urls: list[str] = []
    for m in re.finditer(r'href="(https://[^"]+)"[^>]*>\s*[^<]{1,160}?\s*<', html, re.I):
        context = html[max(0, m.start() - 80) : m.end()]
        if re.search(r"\b(replaced by|replacement|successor|use instead|alternative)\b", context, re.I) and m.group(1) not in urls:
            urls.append(m.group(1))
    return urls


def extract_page(result: FetchResult) -> ExtractedPage:
    """Everything an offer may quote from this page. Soft-404 pages keep `availability` away from in_stock."""
    body = result.body
    text = page_text(body)
    raw_jsonld = "\n".join(_LD_BLOCK.findall(body))
    products = jsonld_products(body)
    product = products[0] if products else None
    name = sku = mpn = gtin = brand = price = currency = None
    availability: Availability = "unknown"
    availability_quote = None
    rating = None
    if product is not None:
        name = _text(product.get("name"))
        sku = _text(product.get("sku"))
        mpn = _text(product.get("mpn"))
        gtin = _text(product.get("gtin13") or product.get("gtin") or product.get("gtin12") or product.get("gtin14") or product.get("gtin8"))
        brand = _text(product.get("brand"))
        offer = _first(product.get("offers"))
        if isinstance(offer, dict):
            price = money_string(offer.get("price"))
            raw_currency = _text(offer.get("priceCurrency"))
            currency = raw_currency.upper() if raw_currency and _CURRENCY.match(raw_currency.upper()) else None
            availability = map_availability(offer.get("availability"))
            if availability != "unknown":
                m = re.search(r'"availability"\s*:\s*"[^"]*"', raw_jsonld)
                availability_quote = m.group(0) if m else None
        rating = rating_from_product(product)
    soft_404 = bool(SOFT_404.search(text))
    if soft_404 and availability == "in_stock":
        availability = "unknown"
    if availability == "unknown" and DISCONTINUED_TEXT.search(text) and sku:
        availability = "discontinued"
        availability_quote = find_quote(text, DISCONTINUED_TEXT.search(text).group(0), context=40)
    return ExtractedPage(
        url=result.url,
        fetched_at=result.fetched_at,
        content_sha256=result.content_sha256,
        text=text,
        raw_jsonld=raw_jsonld,
        product=product,
        name=name,
        sku=sku,
        mpn=mpn,
        gtin=gtin,
        brand=brand,
        price=price if currency else None,
        currency=currency,
        availability=availability,
        availability_quote=availability_quote,
        rating=rating,
        soft_404=soft_404,
        related_urls=_related_urls(body),
    )


def jsonld_quote(raw_jsonld: str, key: str, value: str) -> str | None:
    """The literal `"key": value` snippet from the page's JSON-LD, so the quote is real page text."""
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*"?' + re.escape(value) + r'"?', raw_jsonld, re.I)
    return m.group(0) if m else None


__all__ = [
    "DISCONTINUED_TEXT",
    "ExtractedPage",
    "SCHEMA_AVAILABILITY",
    "SOFT_404",
    "detect_pack",
    "extract_page",
    "jsonld_quote",
    "map_availability",
    "money_string",
    "rating_from_product",
]
