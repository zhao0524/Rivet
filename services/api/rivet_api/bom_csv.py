"""BOM CSV export.

Values come straight from the stored plan: null prices and links stay empty cells, and
the subtotal is whatever the engine reported. The API never computes a total.
"""

import csv
import io
import re
from typing import Any

HEADER = [
    "catalog_id",
    "quantity",
    "instance_ids",
    "unit_price_amount",
    "currency",
    "purchase_url",
    "link_status",
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


def bom_to_csv(plan: dict[str, Any]) -> str:
    bom = plan["bom"]
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(HEADER)
    for item in bom["items"]:
        writer.writerow(
            [
                _cell(item["catalog_id"]),
                _cell(item["quantity"]),
                _cell(";".join(item["instance_ids"])),
                _cell(item.get("unit_price_amount")),
                _cell(bom["currency"]),
                _cell(item.get("purchase_url")),
                _cell(item["link_status"]),
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
        ]
    )
    return out.getvalue()
