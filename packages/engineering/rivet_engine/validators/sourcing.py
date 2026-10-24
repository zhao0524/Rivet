"""Purchase-link freshness and broken links (issue #68).

`sourcing.link_freshness` (advisory): a BOM part's purchase link is as fresh as the newer of the
catalog's `purchase_url_verified_at` and the latest *passing* automated check
(`link_checks.json`). Older than MAX_LINK_AGE_DAYS before the evaluation date (the plan's
`created_at` date unless the context injects `as_of`) is UNKNOWN.

`sourcing.link_broken` (blocking UNKNOWN): the latest check found the link broken (HTTP 404/410,
or the page no longer names the SKU) and the catalog has not re-verified it since. The part may
still be sold elsewhere, so this is not a FAIL and repair never swaps parts over it; the plan
needs review and the BOM row is not presented as a verified product (`bom.link_status`).

Blocked or failed checks are never passes: they neither refresh a link nor break it. With no
report only the catalog dates count; an unreadable report is reported and otherwise ignored.
"""

from __future__ import annotations

from datetime import date

from rivet_engine.link_checks import GONE_STATUSES, LinkCheck, parse_date
from rivet_engine.models import BomItem, CatalogComponent, Finding
from rivet_engine.validators.common import PlanView, Rule

MAX_LINK_AGE_DAYS = 30


def check(view: PlanView) -> list[Finding]:
    rows = [
        (item, comp)
        for item in view.plan.bom.items
        if (comp := view.catalog.get(item.catalog_id)) is not None and comp.sourcing.purchase_url
    ]
    return _link_broken(view, rows) + _link_freshness(view, rows)


def evaluation_date(view: PlanView) -> date:
    return view.context.as_of or date.fromisoformat(view.plan.created_at[:10])


def _reason(entry: LinkCheck, comp: CatalogComponent) -> str:
    if entry.http_status in GONE_STATUSES:
        return f"HTTP {entry.http_status}"
    moved = f" after a redirect to {entry.final_url}" if "redirected" in entry.flags else ""
    return f"the page no longer names SKU {comp.identity.sku}{moved}"


def _link_broken(view: PlanView, rows: list[tuple[BomItem, CatalogComponent]]) -> list[Finding]:
    checks = view.context.link_checks
    if checks is None or not rows:
        return []
    rule = Rule("sourcing.link_broken")
    if checks.problem is not None:
        rule.unknown(
            f"The link check report could not be used ({checks.problem}); broken purchase links cannot be "
            "ruled out, so only catalog verification dates count",
            severity="advisory",
        )
        return rule.result()
    passed, unconfirmed, dates = 0, 0, set()
    for item, comp in rows:
        entry = checks.entry_for(comp)
        broken = checks.broken_entry(comp)
        if broken is not None:
            rule.unknown(
                f"{comp.identity.model}: purchase link is broken ({_reason(broken, comp)}, checked {broken.checked_at}); "
                "it is not shown as a verified product link until the catalog link is fixed and re-checked",
                item.instance_ids,
                [comp.sourcing.purchase_url],
            )
        elif entry is not None and entry.status == "pass":
            passed += 1
            dates.add(entry.checked_at)
            rule.ok(item.instance_ids)
        elif entry is not None and entry.status in ("blocked", "error"):
            unconfirmed += 1
    if not rule.findings and passed == 0:
        rule.applicable = False  # no PASS without a passing check behind it
    when = dates.pop() if len(dates) == 1 else f"{min(dates)} to {max(dates)}" if dates else ""
    rule.pass_message = (
        f"Latest link check ({when}): {passed} purchase link(s) load and name their SKU, none broken"
        + (f"; {unconfirmed} not confirmed (blocked or error)" if unconfirmed else "")
    )
    return rule.result()


def _link_freshness(view: PlanView, rows: list[tuple[BomItem, CatalogComponent]]) -> list[Finding]:
    as_of = evaluation_date(view)
    checks = view.context.link_checks
    rule = Rule(
        "sourcing.link_freshness",
        "advisory",
        f"Every purchase link was verified within {MAX_LINK_AGE_DAYS} days of {as_of}",
    )
    evaluated = False
    for item, comp in rows:
        if checks is not None and checks.broken_entry(comp) is not None:
            continue  # sourcing.link_broken reports it
        evaluated = True
        entry = checks.entry_for(comp) if checks is not None else None
        url = comp.sourcing.purchase_url
        dates = [d for d in (parse_date(comp.sourcing.purchase_url_verified_at),
                             parse_date(entry.checked_at) if entry is not None and entry.status == "pass" else None) if d]
        if not dates:
            rule.unknown(f"{comp.identity.model}: purchase link has no verification date", item.instance_ids, [url], severity="advisory")
            continue
        newest = max(dates)
        age = (as_of - newest).days
        if age <= MAX_LINK_AGE_DAYS:
            rule.ok(item.instance_ids)
            continue
        note = ""
        if entry is not None and entry.status in ("blocked", "error"):
            note = f"; the latest automated check ({entry.checked_at}) was {entry.status}: {entry.detail}"
        rule.unknown(
            f"{comp.identity.model}: purchase link last verified {newest}, {age} days before {as_of} "
            f"(limit {MAX_LINK_AGE_DAYS} days); re-run the link check{note}",
            item.instance_ids,
            [url],
            severity="advisory",
        )
    rule.applicable = evaluated
    return rule.result()
