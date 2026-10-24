"""Boundary guard for BuildPlan referential integrity (docs/implementation.md 3.4).

This checks that a plan is structurally coherent against the catalog. It is NOT
engineering verification: it never reads or changes status or findings (B owns those).
"""

from collections import Counter
from typing import Any

from rivet_api.models.plan import BuildPlan


class ContractViolation(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def assert_build_plan_contract(plan: BuildPlan, catalog: list[dict[str, Any]]) -> None:
    errors: list[str] = []
    by_catalog = {c["catalog_id"]: c for c in catalog}
    mounts = {cid: {m["mount_id"] for m in c.get("mounts", [])} for cid, c in by_catalog.items()}
    ports = {cid: {p["port_id"] for p in c.get("ports", [])} for cid, c in by_catalog.items()}

    counts = Counter(c.instance_id for c in plan.components)
    errors += [f"duplicate instance_id {i!r}" for i, n in counts.items() if n > 1]
    instances = {c.instance_id: c for c in plan.components}

    for c in plan.components:
        if c.catalog_id not in by_catalog:
            errors.append(f"{c.instance_id}: unknown catalog_id {c.catalog_id!r}")
            continue
        if c.own_mount_id and c.own_mount_id not in mounts[c.catalog_id]:
            errors.append(f"{c.instance_id}: own_mount_id {c.own_mount_id!r} not on {c.catalog_id}")
        if c.parent_instance_id is not None:
            parent = instances.get(c.parent_instance_id)
            if parent is None:
                errors.append(f"{c.instance_id}: parent_instance_id {c.parent_instance_id!r} not in plan")
            elif (
                c.attached_to_mount_id
                and parent.catalog_id in mounts
                and c.attached_to_mount_id not in mounts[parent.catalog_id]
            ):
                errors.append(
                    f"{c.instance_id}: attached_to_mount_id {c.attached_to_mount_id!r} "
                    f"not on parent {parent.catalog_id}"
                )

    for conn in plan.connections:
        for end in (conn.from_, conn.to):
            inst = instances.get(end.instance_id)
            if inst is None:
                errors.append(f"{conn.connection_id}: instance {end.instance_id!r} not in plan")
            elif conn.kind == "electrical" and inst.catalog_id in ports:
                if end.port_id not in ports[inst.catalog_id]:
                    errors.append(
                        f"{conn.connection_id}: port {end.port_id!r} not on {inst.catalog_id}"
                    )

    for step in plan.assembly_steps:
        errors += [
            f"assembly step {step.step}: instance {i!r} not in plan"
            for i in step.instance_ids
            if i not in instances
        ]

    for item in plan.bom.items:
        errors += [
            f"bom {item.catalog_id}: instance {i!r} not in plan"
            for i in item.instance_ids
            if i not in instances
        ]
        if item.quantity != len(item.instance_ids):
            errors.append(
                f"bom {item.catalog_id}: quantity {item.quantity} != "
                f"{len(item.instance_ids)} referenced instances"
            )

    if errors:
        raise ContractViolation(errors)
