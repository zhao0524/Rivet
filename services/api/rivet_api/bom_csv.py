"""BOM CSV export.

Values come straight from the stored plan: null prices and links stay empty cells, and
the subtotal is whatever the engine reported. The API never computes a total. The trailing
`sku`, `vendor` and `offer_url` columns come from the catalog entry (SKU, manufacturer or
purchase host, verified https purchase link) and stay empty when the catalog has none.
"""

import csv
import io
import re
from typing import Any
from urllib.parse import urlparse

from rivet_api.provenance import verified_purchase_url

HEADER = [
    "catalog_id",
    "quantity",
    "instance_ids",
    "unit_price_amount",
    "currency",
    "purchase_url",
    "link_status",
    "sku",
    "vendor",
    "offer_url",
]
_DECIMAL_RE = re.compile(r"^\d+(\.\d+)?$")
_FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def _cell(value: Any) -> str:
    """Render one cell; neutralize anything a spreadsheet could execute as a formula."""
    if value is None:
        return ""
    text = str(value)
    if text.startswith(_FORMULA_STARTS) and not _DECIMAL_RE.match(text):
        return "'" + text
    return text


def sourcing_columns(entry: dict[str, Any] | None) -> tuple[str | None, str | None, str | None]:
    if entry is None:
        return None, None, None
    identity = entry.get("identity") or {}
    offer_url = verified_purchase_url(entry)
    vendor = identity.get("manufacturer") or (urlparse(offer_url).hostname if offer_url else None)
    return identity.get("sku") or None, vendor or None, offer_url


def bom_to_csv(plan: dict[str, Any], catalog: list[dict[str, Any]] | None = None) -> str:
    bom = plan["bom"]
    by_id = {e["catalog_id"]: e for e in catalog or []}
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(HEADER)
    for item in bom["items"]:
        sku, vendor, offer_url = sourcing_columns(by_id.get(item["catalog_id"]))
        writer.writerow(
            [
                _cell(item["catalog_id"]),
                _cell(item["quantity"]),
                _cell(";".join(item["instance_ids"])),
                _cell(item.get("unit_price_amount")),
                _cell(bom["currency"]),
                _cell(item.get("purchase_url")),
                _cell(item["link_status"]),
                _cell(sku),
                _cell(vendor),
                _cell(offer_url),
            ]
        )
    writer.writerow(
        [
            "TOTAL",
            "",
            "",
            _cell(bom.get("known_subtotal_amount")),
            _cell(bom["currency"]),
            "",
            _cell(f"total_status:{bom['total_status']}"),
            "",
            "",
            "",
        ]
    )
    return out.getvalue()
