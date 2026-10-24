#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["jsonschema>=4.18,<5"]
# ///
"""Validate fixtures against the shared contracts/ schemas (INT-1).

Two layers, both required for a fixture to pass:
  1. JSON Schema (contracts/*.schema.json): shapes, enumerations, required fields.
  2. Referential rules from docs/implementation.md section 3.4 that JSON Schema
     cannot express (instances, mounts, ports, BOM rows and steps must resolve).

It also runs rejection checks: known-invalid samples, including the section 3.3
shape-only plan and a plan wired to a missing `driver-1`, must fail.

Usage (from the repo root):
  uv run scripts/validate_contracts.py
  uv run scripts/validate_contracts.py --plan P.json --catalog C.json [--catalog C2.json]
  uv run scripts/validate_contracts.py --intent I.json
  uv run scripts/validate_contracts.py --component C.json

Without uv: `pip install "jsonschema>=4.18,<5"` and run with python3.
Exits 0 when everything validates and every invalid sample is rejected, else 1.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Iterable

from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = REPO_ROOT / "contracts"
SCHEMA_FILES = {
    "intent": "intent.schema.json",
    "component": "component.schema.json",
    "plan": "build-plan.schema.json",
    "error": "errors.schema.json",
}

# Checked-in fixture copies, validated when present. Shared fixtures/ (INT-2) come
# first; lane-private copies of Appendix A stay listed until they are replaced.
# Each plan names the catalog files its catalog_ids must resolve against.
SHARED_CATALOGS = ("fixtures/catalog/seed-components.json",)
KNOWN_INTENTS = (
    "fixtures/intent/rover_obstacle_v1.json",
    "packages/engineering/tests/support/appendix_a/intent_rover_obstacle_v1.json",
    "services/api/rivet_api/data/fixtures/intent/rover_obstacle_v1.json",
    "services/api/tests/fixtures/intent_rover_obstacle_v1.json",
    "apps/web/src/lib/rivet/fixtures/synthetic-intent-rover-obstacle-v1.json",
)
KNOWN_PLANS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("fixtures/plans/rover_obstacle_v1.json", SHARED_CATALOGS),
    ("fixtures/plans/rover_failing_driver_v1.json", SHARED_CATALOGS),
    (
        "packages/engineering/tests/support/appendix_a/rover_obstacle_v1.json",
        ("packages/engineering/tests/support/appendix_a/seed-components.json",),
    ),
    (
        "services/api/rivet_api/data/fixtures/plans/rover_obstacle_v1.json",
        ("services/api/rivet_api/data/fixtures/catalog/seed-components.json",),
    ),
    ("services/api/tests/fixtures/plan_rover_obstacle_v1.json", ("services/api/tests/fixtures/seed-components.json",)),
    (
        "apps/web/src/lib/rivet/fixtures/synthetic-rover-obstacle-v1.json",
        ("apps/web/src/lib/rivet/fixtures/synthetic-seed-components.json",),
    ),
    (
        "apps/web/src/lib/rivet/fixtures/sourced-rover-obstacle-v1.json",
        ("apps/web/src/lib/rivet/fixtures/sourced-seed-components.json",),
    ),
)
KNOWN_CATALOGS = (
    *SHARED_CATALOGS,
    "packages/engineering/rivet_engine/data/components.json",
)
KNOWN_ERRORS = ("contracts/examples/error-unsupported-project-family.json",)
SHAPE_ONLY_PLAN = "contracts/examples/invalid/section-3.3-shape-only-plan.json"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_validators() -> dict[str, Draft202012Validator]:
    validators = {}
    for kind, name in SCHEMA_FILES.items():
        schema = load_json(CONTRACTS / name)
        Draft202012Validator.check_schema(schema)
        validators[kind] = Draft202012Validator(schema)
    return validators


def schema_errors(validator: Draft202012Validator, doc: Any) -> list[str]:
    errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path))
    return [f"{e.json_path}: {e.message}" for e in errors]


def catalog_records(doc: Any) -> list[Any]:
    """Catalog files are a bare list or an envelope with a `components` list."""
    if isinstance(doc, dict) and isinstance(doc.get("components"), list):
        return doc["components"]
    if isinstance(doc, list):
        return doc
    raise ValueError("catalog must be a JSON list or an object with a `components` list")


def referential_errors(plan: dict[str, Any], catalog: dict[str, dict[str, Any]] | None) -> list[str]:
    """Section 3.4 integrity rules. `catalog=None` skips the catalog-backed rules."""
    errors: list[str] = []
    components = plan.get("components", [])
    instances = {c["instance_id"]: c for c in components}

    def duplicates(values: Iterable[Any]) -> list[Any]:
        return sorted(v for v, n in Counter(values).items() if n > 1)

    def record(instance_id: str | None) -> dict[str, Any] | None:
        instance = instances.get(instance_id) if instance_id else None
        return catalog.get(instance["catalog_id"]) if catalog is not None and instance else None

    def has(rec: dict[str, Any], key: str, id_key: str, value: str) -> bool:
        return any(item.get(id_key) == value for item in rec.get(key, []))

    def require_instances(where: str, ids: Iterable[str]) -> None:
        errors.extend(f"{where}: unknown instance_id {i!r}" for i in ids if i not in instances)

    if dup := duplicates(c["instance_id"] for c in components):
        errors.append(f"components: duplicate instance_id {dup}")
    if dup := duplicates(c["connection_id"] for c in plan.get("connections", [])):
        errors.append(f"connections: duplicate connection_id {dup}")
    if plan.get("verification", {}).get("overall") != plan.get("status"):
        errors.append("verification.overall must equal status")

    for i, comp in enumerate(components):
        where = f"components[{i}] ({comp['instance_id']})"
        parent_id = comp.get("parent_instance_id")
        if parent_id is not None and (parent_id not in instances or parent_id == comp["instance_id"]):
            errors.append(f"{where}: parent_instance_id {parent_id!r} does not resolve")
        if comp.get("attached_to_mount_id") is not None and parent_id is None:
            errors.append(f"{where}: attached_to_mount_id is set without a parent_instance_id")
        if catalog is None:
            continue
        own = catalog.get(comp["catalog_id"])
        if own is None:
            errors.append(f"{where}: catalog_id {comp['catalog_id']!r} is not in the catalog")
            continue
        if comp.get("own_mount_id") is not None and not has(own, "mounts", "mount_id", comp["own_mount_id"]):
            errors.append(f"{where}: own_mount_id {comp['own_mount_id']!r} is not a mount of {comp['catalog_id']}")
        parent = record(parent_id)
        mount = comp.get("attached_to_mount_id")
        if mount is not None and parent is not None and not has(parent, "mounts", "mount_id", mount):
            errors.append(f"{where}: attached_to_mount_id {mount!r} is not a mount of {parent['catalog_id']}")

    for i, conn in enumerate(plan.get("connections", [])):
        where = f"connections[{i}] ({conn['connection_id']})"
        for side in ("from", "to"):
            end = conn[side]
            if end["instance_id"] not in instances:
                errors.append(f"{where}.{side}: unknown instance_id {end['instance_id']!r}")
                continue
            rec = record(end["instance_id"])
            port = end.get("port_id")
            if port is not None and rec is not None and not has(rec, "ports", "port_id", port):
                errors.append(f"{where}.{side}: port_id {port!r} is not a port of {rec['catalog_id']}")

    for i, finding in enumerate(plan.get("verification", {}).get("findings", [])):
        require_instances(f"verification.findings[{i}] ({finding['rule_id']})", finding["affected_instance_ids"])

    steps = plan.get("assembly_steps", [])
    if dup := duplicates(s["step"] for s in steps):
        errors.append(f"assembly_steps: duplicate step number {dup}")
    for i, step in enumerate(steps):
        require_instances(f"assembly_steps[{i}]", step["instance_ids"])

    bom_items = plan.get("bom", {}).get("items", [])
    if dup := duplicates(item["catalog_id"] for item in bom_items):
        errors.append(f"bom.items: duplicate catalog_id rows {dup}")
    if dup := duplicates(i for item in bom_items for i in item["instance_ids"]):
        errors.append(f"bom.items: instances listed in more than one row {dup}")
    for i, item in enumerate(bom_items):
        where = f"bom.items[{i}] ({item['catalog_id']})"
        require_instances(where, item["instance_ids"])
        if item["quantity"] != len(item["instance_ids"]):
            errors.append(f"{where}: quantity {item['quantity']} != {len(item['instance_ids'])} referenced instances")
        mismatched = [i for i in item["instance_ids"] if i in instances and instances[i]["catalog_id"] != item["catalog_id"]]
        if mismatched:
            errors.append(f"{where}: instances {mismatched} use a different catalog_id")
    if missing := sorted(set(instances) - {i for item in bom_items for i in item["instance_ids"]}):
        errors.append(f"bom.items: components missing from the BOM {missing}")

    controller = plan.get("behavior", {}).get("controller_catalog_id")
    if controller is not None and controller not in {c["catalog_id"] for c in components}:
        errors.append(f"behavior.controller_catalog_id {controller!r} is not a component in this plan")
    if dup := duplicates(plan.get("firmware", {}).get("pin_map", {}).values()):
        errors.append(f"firmware.pin_map: GPIO allocated to more than one signal {dup}")
    return errors


class Report:
    def __init__(self) -> None:
        self.failures = 0

    def result(self, label: str, errors: list[str]) -> None:
        print(f"{'FAIL' if errors else 'ok  '}  {label}")
        for err in errors:
            print(f"        {err}")
        self.failures += bool(errors)


def check_plan(validators: dict[str, Draft202012Validator], plan: Any, catalog_docs: list[Any]) -> list[str]:
    errors = schema_errors(validators["plan"], plan)
    if errors:
        return errors  # referential checks assume a schema-valid shape
    catalog = None
    if catalog_docs:
        records = [r for doc in catalog_docs for r in catalog_records(doc)]
        catalog = {r["catalog_id"]: r for r in records if isinstance(r, dict) and "catalog_id" in r}
    return referential_errors(plan, catalog)


def check_catalog(validators: dict[str, Draft202012Validator], doc: Any) -> list[str]:
    errors = []
    records = catalog_records(doc)
    for i, rec in enumerate(records):
        errors += [f"[{i}] {e}" for e in schema_errors(validators["component"], rec)]
    ids = [r.get("catalog_id") for r in records if isinstance(r, dict)]
    errors += [f"duplicate catalog_id {d!r}" for d, n in Counter(ids).items() if n > 1]
    return errors


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def validate_known(validators: dict[str, Draft202012Validator], report: Report) -> None:
    def present(paths: Iterable[str]) -> list[Path]:
        return [REPO_ROOT / p for p in paths if (REPO_ROOT / p).exists()]

    for path in present(KNOWN_INTENTS):
        report.result(f"intent     {rel(path)}", schema_errors(validators["intent"], load_json(path)))
    for path in present(KNOWN_CATALOGS + tuple(c for _, cats in KNOWN_PLANS for c in cats if c not in KNOWN_CATALOGS)):
        report.result(f"catalog    {rel(path)}", check_catalog(validators, load_json(path)))
    for plan_path, catalog_paths in KNOWN_PLANS:
        path = REPO_ROOT / plan_path
        if not path.exists():
            continue
        catalogs = present(catalog_paths)
        if len(catalogs) != len(catalog_paths):
            report.result(f"plan       {plan_path}", [f"catalog file missing: {catalog_paths}"])
            continue
        report.result(f"plan       {plan_path}", check_plan(validators, load_json(path), [load_json(c) for c in catalogs]))
    for path in present(KNOWN_ERRORS):
        report.result(f"error      {rel(path)}", schema_errors(validators["error"], load_json(path)))


Mutation = Callable[[dict[str, Any]], None]


def _drop_driver(plan: dict[str, Any]) -> None:
    """Remove driver-1 everywhere except the electrical connection that wires it."""
    plan["components"] = [c for c in plan["components"] if c["instance_id"] != "driver-1"]
    for item in plan["bom"]["items"]:
        item["instance_ids"] = [i for i in item["instance_ids"] if i != "driver-1"]
        item["quantity"] = len(item["instance_ids"])
    plan["bom"]["items"] = [i for i in plan["bom"]["items"] if i["instance_ids"]]
    for step in plan["assembly_steps"]:
        step["instance_ids"] = [i for i in step["instance_ids"] if i != "driver-1"]
    for finding in plan["verification"]["findings"]:
        finding["affected_instance_ids"] = [i for i in finding["affected_instance_ids"] if i != "driver-1"]


def _set(path: str, value: Any) -> Mutation:
    def mutate(doc: dict[str, Any]) -> None:
        *parents, last = path.split(".")
        target: Any = doc
        for key in parents:
            target = target[int(key)] if isinstance(target, list) else target[key]
        if isinstance(target, list):
            target[int(last)] = value
        else:
            target[last] = value

    return mutate


def _verified_with_blocking_unknown(plan: dict[str, Any]) -> None:
    plan["status"] = plan["verification"]["overall"] = "verified"
    plan["verification"]["findings"].append(
        {
            "rule_id": "electrical.motor_driver_current",
            "result": "UNKNOWN",
            "severity": "blocking",
            "affected_instance_ids": ["driver-1"],
            "message": "Motor stall current is not documented",
            "evidence_urls": [],
        }
    )


# (label, kind, mutation applied to a baseline copy, substring expected in an error)
PLAN_REJECTIONS: tuple[tuple[str, Mutation, str], ...] = (
    ("electrical connection to a missing driver-1", _drop_driver, "unknown instance_id 'driver-1'"),
    ("unknown status enum", _set("status", "approved"), "'approved' is not one of"),
    ("undocumented top-level key", _set("cost_estimate", "12.00"), "Additional properties"),
    ("money as a JSON number", _set("bom.items.0.unit_price_amount", 1.5), "1.5 is not of type"),
    ("created_at without UTC Z", _set("created_at", "2026-10-24T00:00:00+02:00"), "does not match"),
    ("electrical connection without a port", _set("connections.0.to.port_id", None), "None is not of type 'string'"),
    ("verified with a blocking UNKNOWN", _verified_with_blocking_unknown, "should not be valid"),
    ("BOM quantity disagrees with instances", _set("bom.items.0.quantity", 5), "referenced instances"),
    ("status differs from verification.overall", _set("status", "unbuildable"), "verification.overall must equal"),
    ("mount that the catalog part does not have", _set("components.1.own_mount_id", "no_such_mount"), "is not a mount"),
    ("port that the catalog part does not have", _set("connections.0.from.port_id", "gpio999"), "is not a port"),
    ("revision 0", _set("revision", 0), "less than the minimum"),
    ("incomplete provenance.sourcing", _set("provenance.sourcing", {"synthetic": True}), "is a required property"),
)
OTHER_REJECTIONS: tuple[tuple[str, str, Mutation, str], ...] = (
    ("intent: unknown project_family", "intent", _set("project_family", "spaceship"), "is not one of"),
    ("intent: image input without an asset id", "intent", _set("input.image_asset_id", None), "None is not of type"),
    ("component: unknown category", "component", _set("identity.category", "laser"), "is not one of"),
    ("component: invented negative current", "component", _set("ports.0.current_limit_a", -1), "less than the minimum"),
    ("error: envelope without retryable", "error", lambda d: d["error"].pop("retryable"), "'retryable' is a required"),
)


def baseline() -> tuple[dict[str, Any], list[Any], dict[str, Any]] | None:
    """Appendix A plan, catalog and intent: shared fixtures/ first, then the engine's copy."""
    for plan, catalog, intent in (
        ("fixtures/plans/rover_obstacle_v1.json", SHARED_CATALOGS[0], KNOWN_INTENTS[0]),
        (KNOWN_PLANS[2][0], KNOWN_PLANS[2][1][0], KNOWN_INTENTS[1]),
    ):
        paths = [REPO_ROOT / p for p in (plan, catalog, intent)]
        if all(p.exists() for p in paths):
            return load_json(paths[0]), [load_json(paths[1])], load_json(paths[2])
    return None


def check_rejections(validators: dict[str, Draft202012Validator], report: Report) -> None:
    base = baseline()
    if base is None:
        report.result("rejections: Appendix A baseline", ["no Appendix A plan/catalog/intent found"])
        return
    plan, catalogs, intent = base

    def expect_rejected(label: str, errors: list[str], expected: str) -> None:
        if not errors:
            report.result(f"rejects    {label}", ["accepted, expected rejection"])
        elif not any(expected in e for e in errors):
            report.result(f"rejects    {label}", [f"rejected, but no error contains {expected!r}", *errors])
        else:
            report.result(f"rejects    {label}", [])

    shape_only = load_json(REPO_ROOT / SHAPE_ONLY_PLAN)
    expect_rejected("section 3.3 shape-only plan", check_plan(validators, shape_only, catalogs), "not in the catalog")
    for label, mutate, expected in PLAN_REJECTIONS:
        doc = copy.deepcopy(plan)
        mutate(doc)
        expect_rejected(label, check_plan(validators, doc, catalogs), expected)

    samples = {
        "intent": intent,
        "component": next(r for r in catalog_records(catalogs[0]) if r["ports"]),
        "error": load_json(REPO_ROOT / KNOWN_ERRORS[0]),
    }
    for label, kind, mutate, expected in OTHER_REJECTIONS:
        doc = copy.deepcopy(samples[kind])
        mutate(doc)
        expect_rejected(label, schema_errors(validators[kind], doc), expected)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--plan", type=Path, action="append", default=[], help="BuildPlan JSON to validate")
    parser.add_argument("--catalog", type=Path, action="append", default=[], help="catalog JSON for --plan refs")
    parser.add_argument("--intent", type=Path, action="append", default=[], help="IntentSpec JSON to validate")
    parser.add_argument("--component", type=Path, action="append", default=[], help="catalog file to validate")
    parser.add_argument("--error", type=Path, action="append", default=[], help="API error envelope to validate")
    args = parser.parse_args(argv)
    if args.catalog and not args.plan:
        parser.error("--catalog only resolves --plan references; use --component to validate a catalog file")

    validators = load_validators()
    report = Report()
    explicit = args.plan or args.intent or args.component or args.error
    if not explicit:
        validate_known(validators, report)
        check_rejections(validators, report)
    for path in args.intent:
        report.result(f"intent     {rel(path)}", schema_errors(validators["intent"], load_json(path)))
    for path in args.component:
        report.result(f"catalog    {rel(path)}", check_catalog(validators, load_json(path)))
    for path in args.error:
        report.result(f"error      {rel(path)}", schema_errors(validators["error"], load_json(path)))
    catalog_docs = [load_json(p) for p in args.catalog]
    for path in args.plan:
        report.result(f"plan       {rel(path)}", check_plan(validators, load_json(path), catalog_docs))

    print(f"\n{report.failures} failure(s)" if report.failures else "\nall contract checks passed")
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main())
