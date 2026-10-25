"""Re-check the suggested real parts in `rivet_api/concept/reference_parts.py` against their pages.

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

from rivet_api.concept.reference_parts import ALL_PARTS, ReferencePart  # noqa: E402

UA = "Mozilla/5.0 (compatible; RivetPartCheck/1.0)"
_LD = re.compile(r"<script[^>]*ld\+json[^>]*>(.*?)</script>", re.S)


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", "replace")


def page_sku_and_price(part: ReferencePart) -> tuple[str | None, str | None]:
    if "/products/" in part.url and "racedayquads" in part.url:
        data = json.loads(_get(part.url + ".js"))
        variant = data["variants"][0]
        return str(variant.get("sku") or ""), f"{variant['price'] / 100:.2f}"
    for block in _LD.findall(_get(part.url)):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        for node in data if isinstance(data, list) else data.get("@graph", [data]):
            if isinstance(node, dict) and node.get("@type") == "Product":
                offer = node.get("offers")
                offer = offer[0] if isinstance(offer, list) else offer or {}
                price = offer.get("price")
                return str(node.get("sku")), f"{float(price):.2f}" if price is not None else None
    return None, None


def main() -> int:
    failed = 0
    for part in ALL_PARTS:
        try:
            sku, price = page_sku_and_price(part)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
            print(f"FAIL  {part.role:18} {part.url}  ({exc})")
            failed += 1
            continue
        if sku != part.sku:
            print(f"FAIL  {part.role:18} {part.url}  page SKU {sku!r} != {part.sku!r}")
            failed += 1
        elif price != f"{float(part.price):.2f}":
            print(f"PRICE {part.role:18} {part.url}  now {price}, table {part.price}")
        else:
            print(f"ok    {part.role:18} {part.sku}  {price}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
