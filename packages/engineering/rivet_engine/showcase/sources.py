"""Parts-list extractors for showcase source pages (plan-showcase.md 3.3).

Each extractor reads one fetched page and returns the parts it names: a `BomItem` when the
part links to a vendor product page (name, quantity, link, quoted text), an `UnsourcedPart`
otherwise. Nothing is guessed: a part without a vendor product link stays unsourced, and a
host without a dedicated extractor only yields rows that carry such a link.
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from rivet_engine.ecommerce.identifiers import InvalidUrl, canonical_url
from rivet_engine.ecommerce.vendors import vendor_for_url
from rivet_engine.showcase.models import UnsourcedPart
from rivet_engine.sourcing.evidence import host_of
from rivet_engine.sourcing.extract import included_items
from rivet_engine.sourcing.fetch import FetchResult

MAX_QUOTE = 400
MAX_NAME = 200
MAX_NOTE = 300

# Vendor product page paths; only links matching these count as sourced parts.
PRODUCT_PATHS: dict[str, re.Pattern[str]] = {
    "adafruit.com": re.compile(r"^/product/\d+$"),
    "sparkfun.com": re.compile(r"^/products/\d+$|^/[a-z0-9-]+\.html$"),
    "pololu.com": re.compile(r"^/product/\d+$"),
    "digikey.com": re.compile(r"^/en/products/detail/"),
    "mouser.com": re.compile(r"^/ProductDetail/"),
    "seeedstudio.com": re.compile(r"-p-\d+\.html$"),
    "dfrobot.com": re.compile(r"^/product-\d+\.html$"),
    "pimoroni.com": re.compile(r"^/products/[a-z0-9-]+$"),
    "thepihut.com": re.compile(r"^/products/[a-z0-9-]+$"),
}
# Vendor-run short links whose path is the product number itself.
SHORT_LINKS: dict[str, str] = {"adafru.it": "https://www.adafruit.com/product/{id}"}
CREDITS: dict[str, tuple[str, str]] = {
    "adafruit.com": ("Adafruit Industries", "CC BY-SA 3.0"),
    "sparkfun.com": ("SparkFun Electronics", "CC BY-SA 4.0"),
    "pololu.com": ("Pololu Corporation", "copyright Pololu; linked, not copied"),
}
UNKNOWN_LICENSE = "see source page"

_COMMENT = re.compile(r"<!--.*?-->", re.S)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_HREF = re.compile(r"""<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>""", re.S | re.I)
_HEADING = re.compile(r"<h([1-4])\b[^>]*>(.*?)</h\1>", re.S | re.I)
_LI = re.compile(r"<li\b[^>]*>(.*?)</li>", re.S | re.I)
_TABLE = re.compile(r"<table\b[^>]*>(.*?)</table>", re.S | re.I)
_TR = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<t([hd])\b[^>]*>(.*?)</t\1>", re.S | re.I)
_MONEY = re.compile(r"^[^\w]{0,3}\d[\d,]*(\.\d+)?\s*(usd|eur|gbp)?$", re.I)
_INTEGER = re.compile(r"^\d{1,4}$")
_NAME_COLUMN = re.compile(r"^(part|parts|name|item|component|description|product)s?\b", re.I)
_QTY_COLUMN = re.compile(r"^(qty|quantity|count|#|amount|no\.?)\b", re.I)
_MATERIALS_HEADING = re.compile(
    r"^(required |suggested |recommended |)?(materials|parts( list)?|hardware|bill of materials|bom|"
    r"what you('ll| will) need|you will need|components)\b",
    re.I,
)
_CONTENTS_HEADING = re.compile(r"(kit contents|what'?s included|included|contents|comes with|in the box)", re.I)
_QTY_PREFIX = re.compile(r"^(\d{1,4})\s*[x×]\s+", re.I)
_QTY_SUFFIX = re.compile(r"\s+[x×]\s*(\d{1,4})$|\s*\((\d{1,4})\)$", re.I)
_GENERIC_LABEL = re.compile(
    r"^(adafruit|sparkfun|pololu|amazon(\(\d+\))?|digi-?key|mouser|here|link|buy|shop|product page|view|details|\d+)$", re.I
)
_CC_LICENSE = re.compile(r"creativecommons\.org/licenses/([a-z-]+)/(\d\.\d)")
_META = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR = re.compile(r"""([a-z:-]+)=["']([^"']*)["']""", re.I)
_TITLE = re.compile(r"<title\b[^>]*>(.*?)</title>", re.S | re.I)
WORD_QUANTITIES = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "a pair of": 2, "pair of": 2, "a set of": 1,
}
_WORD_QTY = re.compile(r"^(" + "|".join(sorted(map(re.escape, WORD_QUANTITIES), key=len, reverse=True)) + r")\s+", re.I)


@dataclass(frozen=True)
class BomItem:
    name: str
    quantity: int
    url: str
    bom_quote: str


@dataclass(frozen=True)
class SourceMeta:
    title: str | None
    image_url: str | None
    credit: str
    license: str


def _clean(fragment: str) -> str:
    return _WS.sub(" ", html_lib.unescape(_TAG.sub(" ", fragment))).strip()


def vendor_product_url(href: str, base_url: str) -> str | None:
    """Canonical https URL when `href` points at a known vendor's product page; None otherwise."""
    target = urljoin(base_url, html_lib.unescape(href.strip()))
    parts = urlsplit(target)
    host = (parts.hostname or "").lower()
    short = next((template for domain, template in SHORT_LINKS.items() if host == domain or host.endswith("." + domain)), None)
    if short:
        m = re.match(r"^/(\d+)/?$", parts.path)
        return short.format(id=m.group(1)) if m else None
    if parts.scheme != "https" or not host:
        return None
    try:
        vendor = vendor_for_url(target)
    except ValueError:
        return None
    if vendor.tier not in ("manufacturer", "authorized_distributor"):
        return None
    pattern = PRODUCT_PATHS.get(vendor.domain)
    if pattern is None or not pattern.search(parts.path):
        return None
    try:
        return canonical_url(target)
    except InvalidUrl:
        return None


def split_quantity(text: str) -> tuple[int | None, str]:
    """Quantity stated in a line ("2x Motor", "Motor (2)", "Two gearmotors", "A pair of wheels") and the rest."""
    text = text.strip(" ,.;:")
    m = _QTY_PREFIX.match(text)
    if m:
        return int(m.group(1)), text[m.end():].strip(" ,.;:")
    m = _QTY_SUFFIX.search(text)
    if m:
        return int(m.group(1) or m.group(2)), text[: m.start()].strip(" ,.;:")
    m = _WORD_QTY.match(text)
    if m:
        return WORD_QUANTITIES[m.group(1).lower()], text[m.end():].strip(" ,.;:")
    return None, text


def _links(fragment: str, base_url: str) -> list[tuple[str, str]]:
    """(label, raw href) pairs in order."""
    return [(_clean(label), href) for href, label in _HREF.findall(fragment)]


def _first_product_link(fragment: str, base_url: str) -> tuple[str, str] | None:
    for label, href in _links(fragment, base_url):
        url = vendor_product_url(href, base_url)
        if url:
            return label, url
    return None


def _link_hosts(fragment: str, base_url: str) -> list[str]:
    hosts: list[str] = []
    for _, href in _links(fragment, base_url):
        host = host_of(urljoin(base_url, href)) if "://" in href or href.startswith("//") else ""
        if host and host not in hosts:
            hosts.append(host)
    return hosts


def _unsourced_note(fragment: str, base_url: str) -> str:
    hosts = _link_hosts(fragment, base_url)
    if hosts:
        return f"linked to {', '.join(hosts[:3])}, not a vendor product page"[:MAX_NOTE]
    return "named on the source page without a vendor link"


def _item_name(label: str | None, line: str) -> str:
    """The link's own label when it names the part; the surrounding line otherwise."""
    if label:
        _, label = split_quantity(label)
    if label and len(label) >= 3 and not _GENERIC_LABEL.match(label):
        return label[:MAX_NAME]
    return line[:MAX_NAME]


def _section(html: str, heading: re.Pattern[str]) -> str | None:
    """HTML between the first heading matching `heading` and the next heading of the same or a higher level."""
    for m in _HEADING.finditer(html):
        level, text = int(m.group(1)), _clean(m.group(2))
        if not heading.search(text):
            continue
        rest = html[m.end():]
        stop = re.search(r"<h[1-%d]\b" % level, rest, re.I)
        return rest[: stop.start()] if stop else rest
    return None


def _li_items(fragment: str, base_url: str, *, keep_unsourced: bool) -> tuple[list[BomItem], list[UnsourcedPart]]:
    items: list[BomItem] = []
    unsourced: list[UnsourcedPart] = []
    for li in _LI.findall(fragment):
        line = _clean(li)
        if not line or len(line) > MAX_QUOTE:
            continue
        quantity, rest = split_quantity(line)
        link = _first_product_link(li, base_url)
        if link:
            label, url = link
            items.append(BomItem(_item_name(label, rest), quantity or 1, url, line[:MAX_QUOTE]))
        elif keep_unsourced and len(rest) <= MAX_NAME:
            unsourced.append(UnsourcedPart(name=rest, quantity=quantity, note=_unsourced_note(li, base_url)))
    return items, unsourced


def _header_columns(rows: list[str]) -> tuple[int | None, int | None, int]:
    """(name column, quantity column, first body row index) from a header row when the table has one."""
    for index, row in enumerate(rows[:2]):
        cells = _CELL.findall(row)
        if not cells or not all(kind.lower() == "h" for kind, _ in cells):
            continue
        texts = [_clean(c) for _, c in cells]
        name = next((i for i, t in enumerate(texts) if _NAME_COLUMN.match(t)), None)
        qty = next((i for i, t in enumerate(texts) if _QTY_COLUMN.match(t)), None)
        return name, qty, index + 1
    return None, None, 0


def _table_items(fragment: str, base_url: str, *, keep_unsourced: bool) -> tuple[list[BomItem], list[UnsourcedPart]]:
    items: list[BomItem] = []
    unsourced: list[UnsourcedPart] = []
    for table in _TABLE.findall(fragment):
        rows = _TR.findall(table)
        name_col, qty_col, start = _header_columns(rows)
        body = rows[start:]
        if name_col is None and not any(_first_product_link(row, base_url) for row in body):
            continue
        for row in body:
            cells = [_clean(c) for _, c in _CELL.findall(row)]
            if not cells:
                continue
            name = cells[name_col] if name_col is not None and name_col < len(cells) else next(
                (c for c in cells if len(c) >= 3 and not _MONEY.match(c) and not _GENERIC_LABEL.match(c)), "")
            if not name:
                continue
            quantity_text = cells[qty_col] if qty_col is not None and qty_col < len(cells) else next(
                (c for c in cells if _INTEGER.match(c)), "")
            quantity = int(quantity_text) if _INTEGER.match(quantity_text) and int(quantity_text) >= 1 else None
            inline_quantity, name = split_quantity(name)
            quantity = quantity or inline_quantity
            line = " | ".join(c for c in cells if c)[:MAX_QUOTE]
            link = _first_product_link(row, base_url)
            if link:
                items.append(BomItem(name[:MAX_NAME], quantity or 1, link[1], line))
            elif keep_unsourced and name_col is not None and len(name) <= MAX_NAME:
                unsourced.append(UnsourcedPart(name=name, quantity=quantity, note=_unsourced_note(row, base_url)))
    return items, unsourced


def adafruit_learn_parts(html: str, base_url: str) -> list[BomItem]:
    """Product cards of an Adafruit Learn guide: `<li class="small-product-content-card">` with a title link and data-qty."""
    items: list[BomItem] = []
    for card in re.findall(r'<li\b[^>]*class="[^"]*small-product-content-card[^"]*"[^>]*>(.*?)</li>', html, re.S | re.I):
        title = re.search(r'<a\b[^>]*class="[^"]*product-title[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', card, re.S | re.I)
        if not title:
            continue
        url = vendor_product_url(title.group(1), base_url)
        if not url:
            continue
        name = _clean(title.group(2))
        qty = re.search(r'data-qty="(\d+)"', card)
        details = re.search(r'<div\b[^>]*class="product-details"[^>]*>(.*)', card, re.S | re.I)
        quote = _clean(details.group(1)) if details else name
        items.append(BomItem(name[:MAX_NAME], int(qty.group(1)) if qty and int(qty.group(1)) >= 1 else 1, url, quote[:MAX_QUOTE]))
    return items


def sparkfun_tiles(html: str, base_url: str) -> list[BomItem]:
    """SparkFun Learn product tiles: `data-id="product-<n>"` with a title link and a `sku` span."""
    items: list[BomItem] = []
    positions = [m.start() for m in re.finditer(r'data-id="product-\d+"', html)]
    for i, start in enumerate(positions):
        window = html[start : positions[i + 1] if i + 1 < len(positions) else start + 4000]
        title = re.search(r'<h\d\b[^>]*class="title"[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', window, re.S | re.I)
        if not title:
            continue
        url = vendor_product_url(title.group(1), base_url)
        if not url:
            continue
        name = _clean(title.group(2))
        sku = re.search(r'<span\b[^>]*class="sku"[^>]*>(.*?)</span>', window, re.S | re.I)
        quote = f"{name} {_clean(sku.group(1))}" if sku else name
        items.append(BomItem(name[:MAX_NAME], 1, url, quote[:MAX_QUOTE]))
    return items


def sparkfun_tutorial_parts(html: str, base_url: str) -> tuple[list[BomItem], list[UnsourcedPart]]:
    """Materials section of a SparkFun tutorial (tables, bullets and product tiles); tiles only when it has none."""
    section = _section(html, _MATERIALS_HEADING)
    if section is None:
        return sparkfun_tiles(html, base_url), []
    table_items, table_unsourced = _table_items(section, base_url, keep_unsourced=True)
    li_items, li_unsourced = _li_items(section, base_url, keep_unsourced=False)
    return table_items + li_items + sparkfun_tiles(section, base_url), table_unsourced + li_unsourced


def pololu_parts(html: str, base_url: str) -> tuple[list[BomItem], list[UnsourcedPart]]:
    """Only the "Kit contents" block of a Pololu product page; related products are never parts."""
    section = _section(html, _CONTENTS_HEADING)
    if section is None:
        return [], []
    return _li_items(section, base_url, keep_unsourced=True)


def generic_parts(html: str, base_url: str) -> tuple[list[BomItem], list[UnsourcedPart]]:
    """BOM tables (rows naming a part, a quantity and a link) plus bullets that link a vendor product page."""
    section = _section(html, _MATERIALS_HEADING)
    scope = section if section is not None else html
    table_items, table_unsourced = _table_items(scope, base_url, keep_unsourced=True)
    li_items, li_unsourced = _li_items(scope, base_url, keep_unsourced=section is not None)
    return table_items + li_items, table_unsourced + li_unsourced


def sparkfun_product_parts(result: FetchResult) -> tuple[list[BomItem], list[UnsourcedPart]]:
    items: list[BomItem] = []
    unsourced: list[UnsourcedPart] = []
    for included in included_items(result):
        url = vendor_product_url(included.link, result.url) if included.link else None
        if url:
            items.append(BomItem(included.name[:MAX_NAME], included.quantity, url, included.quote[:MAX_QUOTE]))
        else:
            unsourced.append(UnsourcedPart(name=included.name[:MAX_NAME], quantity=included.quantity,
                                           note="listed in the kit contents without a product link"))
    return items, unsourced


def dedupe_items(items: list[BomItem]) -> list[BomItem]:
    """One item per canonical URL; quantities add up, the first name and quote are kept."""
    merged: dict[str, BomItem] = {}
    for item in items:
        key = item.url.replace("https://www.", "https://", 1)
        seen = merged.get(key)
        merged[key] = BomItem(seen.name, seen.quantity + item.quantity, seen.url, seen.bom_quote) if seen else item
    return list(merged.values())


def _meta_content(html: str, *names: str) -> str | None:
    for tag in _META.findall(html):
        attrs = {k.lower(): html_lib.unescape(v) for k, v in _ATTR.findall(tag)}
        if (attrs.get("property") or attrs.get("name")) in names and attrs.get("content", "").strip():
            return attrs["content"].strip()
    return None


def page_meta(result: FetchResult) -> SourceMeta:
    """Title (`og:title`, then `<title>`), `og:image`, and the credit/license for the host."""
    html = result.body
    title = _meta_content(html, "og:title")
    if not title:
        m = _TITLE.search(html)
        title = _clean(m.group(1)) if m else None
    image = _meta_content(html, "og:image", "twitter:image")
    if image and not image.startswith("https://"):
        image = None
    host = host_of(result.url)
    credit, default_license = next(
        ((c, l) for domain, (c, l) in CREDITS.items() if host == domain or host.endswith("." + domain)),
        (host or "source page", UNKNOWN_LICENSE),
    )
    licenses = {f"CC {code.upper()} {version}" for code, version in _CC_LICENSE.findall(html)}
    license_text = licenses.pop() if len(licenses) == 1 else default_license
    return SourceMeta(title=title[:200] if title else None, image_url=image, credit=credit, license=license_text)


def extract_parts(result: FetchResult) -> tuple[list[BomItem], list[UnsourcedPart], SourceMeta]:
    """Parts named by a source page, dispatched on its host, plus the page's title and image."""
    html = _COMMENT.sub("", result.body)
    host = host_of(result.url)
    base = result.url
    if host == "learn.adafruit.com":
        items, unsourced = adafruit_learn_parts(html, base), []
    elif host == "learn.sparkfun.com":
        items, unsourced = sparkfun_tutorial_parts(html, base)
    elif host.endswith("sparkfun.com"):
        items, unsourced = sparkfun_product_parts(result)
    elif host.endswith("pololu.com"):
        items, unsourced = pololu_parts(html, base)
    else:
        items, unsourced = generic_parts(html, base)
    return dedupe_items(items), unsourced, page_meta(result)


__all__ = [
    "BomItem",
    "CREDITS",
    "PRODUCT_PATHS",
    "SourceMeta",
    "adafruit_learn_parts",
    "dedupe_items",
    "extract_parts",
    "generic_parts",
    "page_meta",
    "pololu_parts",
    "sparkfun_tiles",
    "sparkfun_tutorial_parts",
    "split_quantity",
    "vendor_product_url",
]
