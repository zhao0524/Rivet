"""Referential integrity (B4 category 1): every ID in the plan resolves."""

from __future__ import annotations

from collections import Counter
from decimal import Decimal

from rivet_engine.models import Finding
from rivet_engine.validators.common import PlanView, Rule


def check(view: PlanView) -> list[Finding]:
    plan, catalog = view.plan, view.catalog
    out: list[Finding] = []

    unique = Rule("integrity.instance_ids_unique", pass_message="Every instance_id is unique")
    for iid, n in sorted(Counter(c.instance_id for c in plan.components).items()):
        if n > 1:
            unique.fail(f"instance_id {iid!r} appears {n} times", [iid])
    out += unique.result()

    known = Rule("integrity.catalog_ids", pass_message="Every component references a catalog item")
    for c in plan.components:
        if c.catalog_id not in catalog:
            known.fail(f"{c.instance_id} references unknown catalog_id {c.catalog_id!r}", [c.instance_id])
    out += known.result()

    parents = Rule("integrity.parents", pass_message="Every parent exists and the hierarchy has no cycles")
    for c in plan.components:
        if c.parent_instance_id is not None and c.parent_instance_id not in view.by_id:
            parents.fail(f"{c.instance_id} has missing parent {c.parent_instance_id!r}", [c.instance_id])
    for c in plan.components:
        seen, cur = {c.instance_id}, view.by_id[c.instance_id].parent_instance_id
        while cur is not None and cur in view.by_id:
            if cur in seen:
                parents.fail(f"Parent cycle through {c.instance_id}", sorted(seen))
                break
            seen.add(cur)
            cur = view.by_id[cur].parent_instance_id
    roots = [c.instance_id for c in plan.components if c.parent_instance_id is None]
    if plan.components and len(roots) != 1:
        parents.fail(f"Expected one root component, found {len(roots)}", roots)
    out += _dedupe(parents.result())

    mounts = Rule("integrity.mounts", pass_message="Every mount reference exists on its catalog item")
    for c in plan.components:
        own = view.component(c.instance_id)
        if c.own_mount_id and own and own.mount(c.own_mount_id) is None:
            mounts.fail(f"{c.instance_id}: own_mount_id {c.own_mount_id!r} not on {c.catalog_id}", [c.instance_id])
        if c.attached_to_mount_id:
            parent = view.component(c.parent_instance_id) if c.parent_instance_id else None
            if parent is None:
                mounts.fail(f"{c.instance_id}: attached_to_mount_id without a resolvable parent", [c.instance_id])
            elif parent.mount(c.attached_to_mount_id) is None:
                mounts.fail(f"{c.instance_id}: mount {c.attached_to_mount_id!r} not on parent {parent.catalog_id}", [c.instance_id])
        if c.parent_instance_id is not None and c.role != "accessory" and not c.attached_to_mount_id:
            mounts.fail(f"{c.instance_id} has a parent but no mount reference; only loose kit items may be unmounted", [c.instance_id])
        if bool(c.own_mount_id) != bool(c.attached_to_mount_id):
            mounts.fail(f"{c.instance_id}: own_mount_id and attached_to_mount_id must both be set or both null", [c.instance_id])
    occupied = Counter((c.parent_instance_id, c.attached_to_mount_id) for c in plan.components if c.attached_to_mount_id)
    for (parent, mount), n in sorted(occupied.items()):
        if n > 1:
            mounts.fail(f"Mount {mount!r} on {parent} holds {n} components", [parent])
    out += mounts.result()

    conns = Rule("integrity.connections", pass_message="Every connection endpoint resolves to a component port")
    for iid, n in sorted(Counter(c.connection_id for c in plan.connections).items()):
        if n > 1:
            conns.fail(f"connection_id {iid!r} appears {n} times")
    for conn in plan.connections:
        for end in (conn.from_, conn.to):
            if end.instance_id not in view.by_id:
                conns.fail(f"{conn.connection_id}: instance {end.instance_id!r} is not in the plan", [])
            elif conn.kind == "electrical" and view.port(end.instance_id, end.port_id) is None:
                conns.fail(f"{conn.connection_id}: port {end.port_id!r} is not on {view.by_id[end.instance_id].catalog_id}", [end.instance_id])
    out += conns.result()

    bom = Rule("integrity.bom", pass_message="BOM rows match the placed components exactly")
    counted: Counter[str] = Counter()
    for item in plan.bom.items:
        if item.quantity != len(item.instance_ids):
            bom.fail(f"BOM {item.catalog_id}: quantity {item.quantity} != {len(item.instance_ids)} instances")
        for iid in item.instance_ids:
            counted[iid] += 1
            inst = view.by_id.get(iid)
            if inst is None:
                bom.fail(f"BOM {item.catalog_id}: phantom instance {iid!r}")
            elif inst.catalog_id != item.catalog_id:
                bom.fail(f"BOM row {item.catalog_id} lists {iid}, which is {inst.catalog_id}", [iid])
    for c in plan.components:
        if counted[c.instance_id] != 1:
            bom.fail(f"{c.instance_id} is counted {counted[c.instance_id]} times in the BOM", [c.instance_id])
    for item in plan.bom.items:
        comp = catalog.get(item.catalog_id)
        if comp is None:
            bom.fail(f"BOM row {item.catalog_id} is not in the catalog")
            continue
        s = comp.sourcing
        expected_price = s.price_amount if s.price_amount is not None and s.price_currency == plan.bom.currency else None
        if (item.unit_price_amount is None) != (expected_price is None) or (
            expected_price is not None and Decimal(item.unit_price_amount) != Decimal(expected_price)
        ):
            bom.fail(f"BOM {item.catalog_id}: unit price {item.unit_price_amount} does not match the catalog ({expected_price} {plan.bom.currency})", item.instance_ids)
        verified_link = s.purchase_url if s.purchase_url and s.purchase_url_verified_at else None
        if item.purchase_url is not None and item.purchase_url != verified_link:
            bom.fail(f"BOM {item.catalog_id}: purchase_url is not the catalog's verified link", item.instance_ids)
        if item.link_status == "verified_product" and verified_link is None:
            bom.fail(f"BOM {item.catalog_id}: claims a verified product link the catalog does not have", item.instance_ids)
    priced = [Decimal(i.unit_price_amount) * i.quantity for i in plan.bom.items if i.unit_price_amount is not None]
    expected = str(sum(priced, Decimal("0")).quantize(Decimal("0.01"))) if priced else None
    if plan.bom.known_subtotal_amount is not None and (
        expected is None or Decimal(plan.bom.known_subtotal_amount) != Decimal(expected)
    ):
        bom.fail(f"BOM known_subtotal_amount {plan.bom.known_subtotal_amount} != priced rows {expected}")
    out += bom.result()

    steps = Rule("integrity.assembly_steps", pass_message="Assembly steps are numbered 1..n and reference placed components")
    numbers = [s.step for s in plan.assembly_steps]
    if not plan.assembly_steps:
        steps.fail("Plan has no assembly steps")
    covered = {i for s in plan.assembly_steps for i in s.instance_ids}
    missing = sorted(c.instance_id for c in plan.components if c.instance_id not in covered)
    if plan.assembly_steps and missing:
        steps.fail("Components never appear in an assembly step: " + ", ".join(missing), missing)
    for s in plan.assembly_steps:
        if not s.instance_ids:
            steps.fail(f"Step {s.step} references no components")
    if numbers != list(range(1, len(numbers) + 1)):
        steps.fail(f"Assembly steps must be numbered 1..{len(numbers)} in order, got {numbers}")
    for s in plan.assembly_steps:
        for iid in s.instance_ids:
            if iid not in view.by_id:
                steps.fail(f"Step {s.step} references missing instance {iid!r}")
    out += steps.result()
    return out


def _dedupe(findings: list[Finding]) -> list[Finding]:
    seen, out = set(), []
    for f in findings:
        key = (f.result, f.message)
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out
