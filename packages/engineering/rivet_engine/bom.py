"""Bill of materials from placed components (B6).

One BOM unit is one catalog item as sold, so a row's quantity is always the number of
instances that reference it. Prices come only from the catalog; a price in another
currency is left out (not converted) and makes the total incomplete. `known_subtotal`
is never presented as the total unless every row is priced.
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

from rivet_engine.link_checks import LinkChecks
from rivet_engine.models import Bom, BomItem, CatalogComponent, ComponentInstance
from rivet_engine.ports import Catalog

CENT = Decimal("0.01")


def link_status(component: CatalogComponent, link_checks: LinkChecks | None = None) -> str:
    """A dated purchase link is a verified product unless the latest link check found it broken
    (issue #68). A broken link falls back to the manufacturer reference only if that is a
    different URL."""
    s = component.sourcing
    broken = link_checks is not None and link_checks.broken_entry(component) is not None
    if s.purchase_url and s.purchase_url_verified_at and not broken:
        return "verified_product"
    if s.manufacturer_reference_url and not (broken and s.manufacturer_reference_url == s.purchase_url):
        return "manufacturer_reference_only"
    return "not_available"


def unit_price(component: CatalogComponent, currency: str) -> str | None:
    s = component.sourcing
    if s.price_amount is None or s.price_currency != currency:
        return None
    return s.price_amount


def build_bom(
    components: Sequence[ComponentInstance], catalog: Catalog, currency: str = "USD", link_checks: LinkChecks | None = None
) -> Bom:
    groups: dict[str, list[str]] = {}
    for c in components:
        groups.setdefault(c.catalog_id, []).append(c.instance_id)

    items: list[BomItem] = []
    subtotal = Decimal("0")
    priced_rows = 0
    for catalog_id in sorted(groups):
        component = catalog.require(catalog_id)
        price = unit_price(component, currency)
        status = link_status(component, link_checks)
        ids = groups[catalog_id]
        if price is not None:
            subtotal += Decimal(price) * len(ids)
            priced_rows += 1
        items.append(
            BomItem(
                catalog_id=catalog_id,
                quantity=len(ids),
                instance_ids=ids,
                unit_price_amount=price,
                purchase_url=component.sourcing.purchase_url if status == "verified_product" else None,
                link_status=status,
            )
        )

    if not items or priced_rows == 0:
        total_status, known = "not_available", None
    elif priced_rows == len(items):
        total_status, known = "complete", str(subtotal.quantize(CENT))
    else:
        total_status, known = "incomplete", str(subtotal.quantize(CENT))
    return Bom(currency=currency, known_subtotal_amount=known, total_status=total_status, items=items)
