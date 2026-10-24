"""Budget (B4 category 7): quantity x confirmed price only, exact Decimal arithmetic."""

from __future__ import annotations

from decimal import Decimal

from rivet_engine.models import Finding
from rivet_engine.validators.common import PlanView, Rule


def check(view: PlanView) -> list[Finding]:
    return _price_currency(view) + _budget(view)


def _price_currency(view: PlanView) -> list[Finding]:
    """Prices in another currency are left out of the subtotal; say so explicitly."""
    rule = Rule("budget.price_currency", "advisory", "Every catalog price is in the BOM currency")
    bom = view.plan.bom
    for item in bom.items:
        comp = view.catalog.get(item.catalog_id)
        if comp is None or comp.sourcing.price_amount is None:
            continue
        if comp.sourcing.price_currency != bom.currency:
            rule.unknown(
                f"{item.catalog_id} is priced in {comp.sourcing.price_currency}, not {bom.currency}; "
                "it is excluded from the subtotal (no conversion)",
                item.instance_ids,
                severity="advisory",
            )
        else:
            rule.ok(item.instance_ids)
    rule.applicable = bool(bom.items)
    return rule.result()


def _budget(view: PlanView) -> list[Finding]:
    req = view.context.requirements
    if req is None or req.max_budget is None:
        return []
    rule = Rule("budget.max_budget", pass_message="Priced BOM is within the requested budget")
    bom = view.plan.bom
    budget = Decimal(req.max_budget)
    if bom.currency != req.currency:
        rule.unknown(f"Budget is in {req.currency} but the BOM is in {bom.currency}; no conversion is done")
        return rule.result()

    known = Decimal("0")
    unpriced = []
    for item in bom.items:
        comp = view.catalog.get(item.catalog_id)
        currency = comp.sourcing.price_currency if comp else None
        if item.unit_price_amount is None or (currency is not None and currency != bom.currency):
            unpriced.append(item)
        else:
            known += Decimal(item.unit_price_amount) * item.quantity
    ids = [i for item in unpriced for i in item.instance_ids]
    if known > budget:
        rule.fail(f"Known subtotal {known:.2f} {bom.currency} already exceeds the {budget:.2f} budget", ids)
    elif unpriced:
        rule.unknown(
            f"{len(unpriced)} BOM row(s) have no confirmed {bom.currency} price; known subtotal {known:.2f} of {budget:.2f} "
            "cannot prove the budget",
            ids,
        )
    else:
        rule.ok([i for item in bom.items for i in item.instance_ids])
        rule.pass_message = f"Total {known:.2f} {bom.currency} is within the {budget:.2f} budget"
    return rule.result()
