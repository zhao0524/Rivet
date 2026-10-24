"""Real-product checks for BuildPlans.

The engine owns hardware truth; this module only refuses to *relay* sourcing claims the
catalog cannot back. A BOM row may say `verified_product` only if the catalog entry has a
verified https purchase link and a SKU, and a plan built from SYNTHETIC parts is flagged
so exports and the UI never present it as a real, buyable design.
"""

from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse

from rivet_api.errors import ApiError

_SYNTHETIC_ID_PREFIXES = ("demo.", "synthetic.")


def _entry_synthetic(entry: dict[str, Any]) -> bool:
    manufacturer = str(entry.get("identity", {}).get("manufacturer") or "")
    return entry["catalog_id"].startswith(_SYNTHETIC_ID_PREFIXES) or "SYNTHETIC" in manufacturer.upper()


def is_synthetic_catalog_id(catalog_id: str, catalog: list[dict[str, Any]] | None = None) -> bool:
    """Synthetic by id prefix, or (when the entry is known) by its manufacturer label."""
    if catalog_id.startswith(_SYNTHETIC_ID_PREFIXES):
        return True
    for entry in catalog or []:
        if entry.get("catalog_id") == catalog_id:
            return _entry_synthetic(entry)
    return False


def _verified_link(entry: dict[str, Any]) -> str | None:
    sourcing = entry.get("sourcing") or {}
    if sourcing.get("purchase_url") and sourcing.get("purchase_url_verified_at"):
        return sourcing["purchase_url"]
    return None


def _is_https_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and bool(parsed.netloc)


def is_verified_product(catalog_id: str, catalog: list[dict[str, Any]]) -> bool:
    """Same bar as a `verified_product` BOM row: a SKU and a verified https purchase link."""
    for entry in catalog:
        if entry.get("catalog_id") == catalog_id:
            link = _verified_link(entry)
            return bool(link and _is_https_url(link) and (entry.get("identity") or {}).get("sku"))
    return False


def plan_synthetic_ids(plan: dict[str, Any], catalog: list[dict[str, Any]] | None = None) -> list[str]:
    ids = {c["catalog_id"] for c in plan.get("components", [])}
    ids |= {i["catalog_id"] for i in plan.get("bom", {}).get("items", [])}
    return sorted(i for i in ids if is_synthetic_catalog_id(i, catalog))


def plan_is_synthetic(plan: dict[str, Any], catalog: list[dict[str, Any]] | None = None) -> bool:
    version = str(plan.get("provenance", {}).get("catalog_version") or "")
    return version.upper().startswith("SYNTHETIC") or bool(plan_synthetic_ids(plan, catalog))


def check_bom_links(plan: dict[str, Any], catalog: list[dict[str, Any]]) -> list[str]:
    """Problems where the BOM claims sourcing the catalog does not back (empty = clean)."""
    by_id = {e["catalog_id"]: e for e in catalog}
    bom = plan["bom"]
    problems: list[str] = []
    for item in bom["items"]:
        cid = item["catalog_id"]
        entry = by_id.get(cid)
        if entry is None:  # unresolved ids are the contract guard's job
            continue
        verified = _verified_link(entry)
        url = item.get("purchase_url")
        status = item["link_status"]
        if url is not None:
            if not _is_https_url(url):
                problems.append(f"{cid}: purchase_url is not an https URL")
            elif url != verified:
                problems.append(f"{cid}: purchase_url is not the catalog's verified link")
        if status == "verified_product":
            if verified is None or url != verified:
                problems.append(f"{cid}: claims verified_product without a verified catalog link")
            if not (entry.get("identity") or {}).get("sku"):
                problems.append(f"{cid}: claims verified_product but the catalog has no SKU")
        elif url is not None:
            problems.append(f"{cid}: has a purchase_url but link_status is {status}")
        sourcing = entry.get("sourcing") or {}
        catalog_price = sourcing.get("price_amount")
        if catalog_price is not None and sourcing.get("price_currency") != bom["currency"]:
            catalog_price = None
        price = item.get("unit_price_amount")
        if (price is None) != (catalog_price is None):
            problems.append(f"{cid}: unit price {price!r} does not match the catalog ({catalog_price!r})")
        elif price is not None:
            try:
                same = Decimal(price) == Decimal(catalog_price)
            except InvalidOperation:
                same = False
            if not same:
                problems.append(f"{cid}: unit price {price} does not match the catalog ({catalog_price})")
    return problems


def sourcing_summary(plan: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, Any]:
    """Structured replacement for reading 'SYNTHETIC' out of free text. Computed on read,
    never stored: the engine rejects plans carrying keys it does not know."""
    by_id = {e["catalog_id"]: e for e in catalog}
    items = plan["bom"]["items"]
    return {
        "synthetic": plan_is_synthetic(plan, catalog),
        "synthetic_catalog_ids": plan_synthetic_ids(plan, catalog),
        "unverified_link_count": sum(1 for i in items if i["link_status"] != "verified_product"),
        "sku_missing_count": sum(
            1 for i in items if not (by_id.get(i["catalog_id"], {}).get("identity") or {}).get("sku")
        ),
    }


def refuse_if_synthetic(plan: dict[str, Any], catalog: list[dict[str, Any]], code: str, what: str) -> None:
    if plan_is_synthetic(plan, catalog):
        raise ApiError(
            code,
            f"{what} is not available for a plan built from synthetic demo parts; "
            "it has no real products, SKUs or purchase links",
            422,
            {"synthetic_catalog_ids": plan_synthetic_ids(plan, catalog)},
        )
