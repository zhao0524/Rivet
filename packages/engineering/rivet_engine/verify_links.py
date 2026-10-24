"""Purchase-link checker (issue #68).

    python -m rivet_engine.verify_links            # check every catalog purchase link, print a table
    python -m rivet_engine.verify_links --write    # also save rivet_engine/data/link_checks.json

For each catalog entry with a purchase_url: one GET with a browser-like User-Agent, a 15 s
timeout and redirects followed, one request at a time with a short pause between them. A link
passes only when the final HTTP status is 200 and the page names the entry's SKU (labelled on the
page, e.g. "Product ID: 3521" or "SKU: ROB-13301", or as the schema.org Product sku).

- broken: HTTP 404/410, or a 200 page that no longer names the SKU (the listing changed)
- blocked: the vendor refused the checker (401/403/407/429/451 or a bot-challenge page)
- error: no verdict (timeout, connection or TLS failure, redirect loop, 5xx, other status)

Blocked and error are never passes. Price and stock are signals only: whether the catalog price
is the page's price, and which availability the page states. This tool reports evidence; it
never edits the catalog, prices, ratings or stock.

Exit codes: 0 no broken link, 1 at least one broken link, 2 catalog or report file unusable.
"""

from __future__ import annotations

import argparse
import html as html_lib
import http.client
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, TextIO

from rivet_engine.catalog import load_catalog
from rivet_engine.link_checks import GONE_STATUSES, LINK_CHECKS_PATH, LinkCheck, LinkReport, dump_report
from rivet_engine.models import CatalogComponent
from rivet_engine.ports import Catalog, EngineError

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
TIMEOUT_S = 15.0
DELAY_S = 1.0
MAX_BODY_BYTES = 4 * 1024 * 1024
REFUSED_STATUSES = frozenset({401, 403, 407, 429, 451})


@dataclass(frozen=True)
class FetchResult:
    """What one GET returned: the final status and URL after redirects, or why nothing arrived."""

    status: int | None
    final_url: str | None
    body: str = ""
    error: str | None = None


Fetcher = Callable[[str], FetchResult]


def _read_text(response: Any) -> str:
    raw = response.read(MAX_BODY_BYTES)
    charset = response.headers.get_content_charset() or "utf-8"
    try:
        return raw.decode(charset, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def _describe(exc: BaseException) -> str:
    reason = getattr(exc, "reason", None) or exc
    text = str(reason).strip()
    return f"{type(reason).__name__}: {text}" if text else type(reason).__name__


def fetch_url(url: str, timeout: float = TIMEOUT_S, user_agent: str = USER_AGENT) -> FetchResult:
    """Default fetcher: stdlib urllib, redirects followed (urllib allows up to 10)."""
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return FetchResult(response.status, response.geturl(), _read_text(response))
    except urllib.error.HTTPError as exc:
        try:
            body = _read_text(exc)
        except (OSError, http.client.HTTPException, ValueError, AttributeError):
            body = ""
        return FetchResult(exc.code, exc.geturl() or url, body)
    except (OSError, http.client.HTTPException, ValueError) as exc:  # URLError, timeouts, TLS, bad URL
        return FetchResult(None, None, error=_describe(exc))


# --- reading a product page ---------------------------------------------------------------

_SKU_LABEL = r"(?:product\s*id|sku|pid|mpn|part\s*(?:no\.?|number|#)|item\s*(?:no\.?|number|#)|model\s*(?:no\.?|number))"
_CHALLENGE = re.compile(
    r"cf-chl|/cdn-cgi/challenge-platform|<title>\s*just a moment|attention required! \| cloudflare"
    r"|px-captcha|captcha-delivery\.com|<title>\s*access denied\s*</title>",
    re.IGNORECASE,
)
_SCHEMA_AVAILABILITY = {
    "instock": "in_stock",
    "limitedavailability": "in_stock",
    "onlineonly": "in_stock",
    "instoreonly": "in_stock",
    "outofstock": "out_of_stock",
    "soldout": "out_of_stock",
    "discontinued": "discontinued",
    "backorder": "backorder",
    "preorder": "backorder",
    "presale": "backorder",
}


def visible_text(page: str) -> str:
    """Page text a reader sees: no scripts, styles or comments; entities decoded; spaces collapsed."""
    page = re.sub(r"(?is)<(script|style|noscript|template)\b[^>]*>.*?</\1\s*>", " ", page)
    page = re.sub(r"(?s)<!--.*?-->", " ", page)
    text = html_lib.unescape(re.sub(r"(?s)<[^>]+>", " ", page))
    return re.sub(r"\s+", " ", text).strip()


def json_ld_products(page: str) -> list[dict[str, Any]]:
    """schema.org Product objects from the page's JSON-LD blocks (unparseable blocks are skipped)."""
    products: list[dict[str, Any]] = []
    for block in re.findall(r"(?is)<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", page):
        try:
            stack: list[Any] = [json.loads(block.strip(), strict=False)]
        except ValueError:
            continue
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                kinds = node.get("@type")
                if "Product" in (kinds if isinstance(kinds, list) else [kinds]):
                    products.append(node)
                if "@graph" in node:
                    stack.append(node["@graph"])
    return products


def _offers(product: dict[str, Any]) -> list[dict[str, Any]]:
    offers = product.get("offers")
    offers = offers if isinstance(offers, list) else [offers]
    return [o for o in offers if isinstance(o, dict)]


def sku_named(text: str, products: Iterable[dict[str, Any]], sku: str) -> bool:
    """The SKU appears labelled in the page text, or as the schema.org Product sku/mpn/productID."""
    labelled = re.compile(rf"(?<![\w-]){_SKU_LABEL}\s*[:#]?\s*{re.escape(sku)}(?![\w-])", re.IGNORECASE)
    if labelled.search(text):
        return True
    want = sku.strip().lower()
    return any(str(p.get(key, "")).strip().lower() == want for p in products for key in ("sku", "mpn", "productID"))


def _decimal(value: Any) -> Decimal | None:
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() else None


def _meta_contents(page: str, attribute: str, name: str) -> list[str]:
    out = []
    for tag in re.findall(rf"(?is)<[^>]*{attribute}=[\"']{re.escape(name)}[\"'][^>]*>", page):
        match = re.search(r"(?is)content=[\"']([^\"']*)[\"']", tag)
        if match:
            out.append(match.group(1))
    return out


def price_signal(page: str, text: str, products: list[dict[str, Any]], price: str | None, currency: str | None) -> bool | None:
    """Is the catalog price the page's product price? None when the catalog has no price.

    The first source that states a price decides: JSON-LD offers, then Open Graph
    product:price:amount, then microdata itemprop=price; otherwise "$X.XX" in the page text (USD).
    """
    want = _decimal(price) if price is not None else None
    if want is None:
        return None
    sources = [
        [o.get("price") for p in products for o in _offers(p) if o.get("priceCurrency") in (None, currency)],
        _meta_contents(page, "property", "product:price:amount"),
        _meta_contents(page, "itemprop", "price"),
    ]
    for values in sources:
        found = [d for d in (_decimal(v) for v in values) if d is not None]
        if found:
            return want in found
    if currency == "USD":
        return f"${want:.2f}" in text
    return None


def _phrase_stock(text: str) -> set[str]:
    found = set()
    if re.search(r"\bout of stock\b|\bsold out\b", text, re.IGNORECASE):
        found.add("out_of_stock")
    if re.search(r"(?<!back )\bin stock\b", text, re.IGNORECASE):
        found.add("in_stock")
    if re.search(r"\bback-?order(?:ed)?\b|\bpre-?order\b", text, re.IGNORECASE):
        found.add("backorder")
    if re.search(r"\bdiscontinued\b", text, re.IGNORECASE):
        found.add("discontinued")
    return found


def stock_signal(page: str, text: str, products: list[dict[str, Any]]) -> str:
    """Availability the page states for its product: the first source that states one decides
    (schema.org offers, microdata itemprop=availability, the Magento product stock block, then
    page text). Several different values give "mixed"; none gives "none"."""
    schema = {
        _SCHEMA_AVAILABILITY.get(str(o.get("availability", "")).rstrip("/").rsplit("/", 1)[-1].lower())
        for p in products
        for o in _offers(p)
    } - {None}
    microdata: set[str] = set()
    for tag, inner in re.findall(r"(?is)(<[^>]*itemprop=[\"']availability[\"'][^>]*>)([^<]*)", page):
        content = re.search(r"(?is)(?:content|href)=[\"']([^\"']*)[\"']", tag)
        value = content.group(1) if content else inner
        schema_value = _SCHEMA_AVAILABILITY.get(value.rstrip("/").rsplit("/", 1)[-1].strip().lower())
        microdata |= {schema_value} if schema_value else _phrase_stock(value)
    magento = re.search(r"(?is)class=[\"']product-info-stock-sku[\"'](.{0,800})", page)
    block = _phrase_stock(visible_text(magento.group(1))) if magento else set()
    for values in (schema, microdata, block, _phrase_stock(text)):
        if values:
            return values.pop() if len(values) == 1 else "mixed"
    return "none"


def _flags(component: CatalogComponent, final_url: str | None, price_found: bool | None, stock: str | None) -> list[str]:
    flags = []
    if final_url is not None and final_url != component.sourcing.purchase_url:
        flags.append("redirected")
    if price_found is False:
        flags.append("price_differs")
    page = {"backorder": "out_of_stock"}.get(stock or "", stock)
    catalog = component.sourcing.availability_status
    definite = ("in_stock", "out_of_stock", "discontinued")
    if page in definite and catalog in definite and page != catalog:
        flags.append("stock_differs")
    return sorted(flags)


def check_link(component: CatalogComponent, fetch: Fetcher, today: date) -> LinkCheck:
    """Fetch one purchase link and classify it. Only HTTP 200 with the SKU on the page passes."""
    url, sku = component.sourcing.purchase_url, component.identity.sku
    if url is None:
        raise ValueError(f"{component.catalog_id} has no purchase_url")
    got = fetch(url)
    record: dict[str, Any] = {
        "catalog_id": component.catalog_id,
        "sku": sku,
        "purchase_url": url,
        "http_status": got.status,
        "final_url": got.final_url,
        "checked_at": today.isoformat(),
        "sku_found": None,
        "catalog_price_found": None,
        "stock_text": None,
    }
    challenge = bool(_CHALLENGE.search(got.body))
    if got.status is None:
        return LinkCheck(**record, status="error", flags=[], detail=f"no response: {got.error or 'unknown error'}")
    flags = _flags(component, got.final_url, None, None)
    if got.status in GONE_STATUSES:
        return LinkCheck(**record, status="broken", flags=flags, detail=f"HTTP {got.status}: the page is gone")
    if got.status in REFUSED_STATUSES:
        return LinkCheck(**record, status="blocked", flags=flags, detail=f"HTTP {got.status}: the vendor refused the request")
    if got.status != 200:
        if challenge:
            return LinkCheck(**record, status="blocked", flags=flags, detail=f"HTTP {got.status}: bot-challenge page")
        kind = "redirect loop" if 300 <= got.status < 400 else "no verdict"
        return LinkCheck(**record, status="error", flags=flags, detail=f"HTTP {got.status} ({kind})")

    text, products = visible_text(got.body), json_ld_products(got.body)
    price = component.sourcing.price_amount
    record["catalog_price_found"] = price_signal(got.body, text, products, price, component.sourcing.price_currency)
    record["stock_text"] = stock_signal(got.body, text, products)
    flags = _flags(component, got.final_url, record["catalog_price_found"], record["stock_text"])
    if sku is None:
        return LinkCheck(**record, status="error", flags=flags, detail="the catalog has no SKU to look for on the page")
    record["sku_found"] = sku_named(text, products, sku)
    if record["sku_found"]:
        return LinkCheck(**record, status="pass", flags=flags, detail="HTTP 200 and the page names the SKU")
    if challenge:
        record["sku_found"] = None
        return LinkCheck(**record, status="blocked", flags=flags, detail="HTTP 200 but a bot-challenge page, not the product page")
    moved = f"; it redirected to {got.final_url}" if "redirected" in flags else ""
    return LinkCheck(**record, status="broken", flags=flags, detail=f"HTTP 200 but the page does not name SKU {sku}{moved}")


def run_checks(
    catalog: Catalog,
    fetch: Fetcher | None = None,
    *,
    today: date | None = None,
    delay_s: float = DELAY_S,
    sleep: Callable[[float], None] = time.sleep,
) -> LinkReport:
    """Check every catalog entry with a purchase_url, one at a time, in catalog_id order."""
    fetch = fetch or fetch_url
    today = today or datetime.now(timezone.utc).date()
    results = []
    for index, component in enumerate(c for c in catalog.components if c.sourcing.purchase_url):
        if index and delay_s > 0:
            sleep(delay_s)
        results.append(check_link(component, fetch, today))
    return LinkReport(schema_version="1.0", catalog_version=catalog.version, results=results)


def _yes_no(value: bool | None) -> str:
    return "-" if value is None else "yes" if value else "no"


def render_table(report: LinkReport, skipped: Iterable[str] = ()) -> str:
    """Pass/fail table plus a summary; notes explain every result that is not a plain pass."""
    header = ("catalog_id", "sku", "result", "http", "sku found", "price", "stock", "flags")
    rows = [
        (
            r.catalog_id,
            r.sku or "-",
            r.status.upper(),
            str(r.http_status) if r.http_status is not None else "-",
            _yes_no(r.sku_found),
            _yes_no(r.catalog_price_found),
            r.stock_text or "-",
            ",".join(r.flags) or "-",
        )
        for r in report.results
    ]
    widths = [max(len(row[i]) for row in [header, *rows]) for i in range(len(header))]
    lines = ["  ".join(cell.ljust(w) for cell, w in zip(row, widths)).rstrip() for row in [header, *rows]]
    counts = {s: sum(1 for r in report.results if r.status == s) for s in ("pass", "broken", "blocked", "error")}
    dates = sorted({r.checked_at for r in report.results})
    lines.append("")
    lines.append(
        f"{len(report.results)} linked catalog entries checked"
        + (f" on {', '.join(dates)} (UTC)" if dates else "")
        + ": " + ", ".join(f"{n} {s}" for s, n in counts.items())
    )
    skipped = sorted(skipped)
    if skipped:
        lines.append(f"{len(skipped)} catalog entries have no purchase link and were not checked: {', '.join(skipped)}")
    if counts["blocked"] or counts["error"]:
        lines.append("Blocked and error results are not passes: those links keep only their catalog verification date.")
    notes = [
        f"  {r.catalog_id}: {r.status} - {r.detail}" + (f" (final URL {r.final_url})" if "redirected" in r.flags else "")
        for r in report.results
        if r.status != "pass" or r.flags
    ]
    if notes:
        lines.append("Notes:")
        lines.extend(notes)
    return "\n".join(lines) + "\n"


def main(
    argv: list[str] | None = None,
    *,
    fetch: Fetcher | None = None,
    catalog: Catalog | None = None,
    today: date | None = None,
    sleep: Callable[[float], None] = time.sleep,
    out: TextIO | None = None,
) -> int:
    out = out or sys.stdout
    parser = argparse.ArgumentParser(prog="python -m rivet_engine.verify_links", description=__doc__.split("\n")[0])
    parser.add_argument("--write", action="store_true", help="save the JSON report (default: the packaged data/link_checks.json)")
    parser.add_argument("--output", type=Path, help="where --write saves the report")
    parser.add_argument("--delay", type=float, default=DELAY_S, help=f"seconds between requests (default {DELAY_S})")
    parser.add_argument("--timeout", type=float, default=TIMEOUT_S, help=f"seconds per request (default {TIMEOUT_S})")
    args = parser.parse_args(argv)
    if args.output is not None and not args.write:
        parser.error("--output needs --write")
    if args.delay < 0 or args.timeout <= 0:
        parser.error("--delay must be >= 0 and --timeout > 0")

    try:
        catalog = catalog if catalog is not None else load_catalog()
    except EngineError as err:
        print(f"error: cannot load the catalog: {err.message}", file=sys.stderr)
        return 2
    if fetch is None:
        timeout = args.timeout

        def fetch(url: str) -> FetchResult:
            return fetch_url(url, timeout=timeout)

    report = run_checks(catalog, fetch, today=today, delay_s=args.delay, sleep=sleep)
    skipped = [c.catalog_id for c in catalog.components if not c.sourcing.purchase_url]
    out.write(render_table(report, skipped))
    if args.write:
        target = args.output or LINK_CHECKS_PATH
        try:
            target.write_text(dump_report(report), encoding="utf-8")
        except OSError as exc:
            print(f"error: cannot write {target}: {exc.strerror or exc}", file=sys.stderr)
            return 2
        out.write(f"wrote {target}\n")
    return 1 if any(r.status == "broken" for r in report.results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
