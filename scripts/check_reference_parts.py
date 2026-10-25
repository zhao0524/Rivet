"""Re-check the suggested real parts in `rivet_api/concept/reference_parts.py` and the demo
tables in `rivet_api/concept/demo/parts/*.json` against their pages.

For each entry: fetch the product page, read its SKU and price (Shopify product JSON for
Shopify shops, JSON-LD Product otherwise) and report whether the SKU still matches and the
price moved. Network access is needed; exits 1 when any page is gone or names another SKU.

    services/api/.venv/bin/python scripts/check_reference_parts.py
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "api"))

from rivet_api.concept.reference_parts import ALL_PARTS, ReferencePart, demo_part_keys, demo_parts  # noqa: E402

# Some shops (LCSC, Horizon Hobby) refuse unknown agents, so this reads as a desktop browser.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
_LD = re.compile(r"<script[^>]*ld\+json[^>]*>(.*?)</script>", re.S)


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", "replace")


def page_offers(url: str) -> list[tuple[str, str | None]]:
    """(SKU, price) for each variant on the page: Shopify product JSON, else JSON-LD Product."""
    if "/products/" in url:  # Shopify shops (RaceDayQuads, Hiwonder, Unitree)
        data = json.loads(_get(url + ".js"))
        return [(str(v.get("sku") or ""), f"{v['price'] / 100:.2f}") for v in data["variants"]]
    for block in _LD.findall(_get(url)):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        for node in data if isinstance(data, list) else data.get("@graph", [data]):
            if isinstance(node, dict) and node.get("@type") == "Product":
                offer = node.get("offers")
                offer = offer[0] if isinstance(offer, list) else offer or {}
                price = offer.get("price")
                return [(str(node.get("sku")), f"{float(price):.2f}" if price is not None else None)]
    return []


def check(label: str, part: ReferencePart) -> bool:
    """Print one line for the part; False when its page is gone or no longer names its SKU."""
    try:
        offers = page_offers(part.url)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
        print(f"FAIL  {label:30} {part.url}  ({exc})")
        return False
    match = next((o for o in offers if o[0] == part.sku), None) if part.sku else (offers[0] if offers else None)
    if match is None:
        print(f"FAIL  {label:30} {part.url}  page SKUs {[o[0] for o in offers]!r} lack {part.sku!r}")
        return False
    price = match[1]
    if part.price is not None and price is not None and abs(float(price) - float(part.price)) > 0.011:  # LCSC parts cost fractions of a cent
        print(f"PRICE {label:30} {part.url}  now {price}, table {part.price}")
    else:
        print(f"ok    {label:30} {part.sku or '-'}  {price}")
    return True


def main() -> int:
    failed = 0
    for part in ALL_PARTS:
        failed += not check(part.role, part)
    # Demo tables name the same product on many lines; check each product page once.
    seen: set[tuple[str, str]] = set()
    for key in demo_part_keys():
        for part in demo_parts(key).values():
            if (part.url, part.sku) in seen:
                continue
            seen.add((part.url, part.sku))
            failed += not check(f"{key}: {part.role}", part)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
