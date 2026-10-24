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
import math
import re
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
    "services/api/rivet_api/data/fixtures/intent/rover_obstacle_v1.json",
    "apps/web/src/lib/rivet/fixtures/synthetic-intent-rover-obstacle-v1.json",
)
KNOWN_PLANS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("fixtures/plans/rover_obstacle_v1.json", SHARED_CATALOGS),
    ("fixtures/plans/rover_failing_driver_v1.json", SHARED_CATALOGS),
    (
        "services/api/rivet_api/data/fixtures/plans/rover_obstacle_v1.json",
        ("services/api/rivet_api/data/fixtures/catalog/seed-components.json",),
    ),
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
    """Appendix A plan, catalog and intent from the shared fixtures/."""
    paths = [REPO_ROOT / p for p in (KNOWN_PLANS[0][0], SHARED_CATALOGS[0], KNOWN_INTENTS[0])]
    if all(p.exists() for p in paths):
        return load_json(paths[0]), [load_json(paths[1])], load_json(paths[2])
    return None


# --- INT-2 shared fixture checks (beyond schema + section 3.4) ---------------------------

SIM_SCENARIO = "fixtures/sim/obstacle-scenario.json"
IMAGES_DIR = "fixtures/images"
APPENDIX_A_COPIES = {
    "fixtures/intent/rover_obstacle_v1.json": 0,
    "fixtures/catalog/seed-components.json": 7,
    "fixtures/plans/rover_obstacle_v1.json": 8,
}
REQUIRED_ROLES = {
    "chassis": 1, "motor": 2, "wheel": 2, "motor_driver": 1, "controller": 1,
    "distance_sensor": 1, "caster": 1, "power_supply": 1,
}
SIM_STATES = {"FORWARD", "STOP", "TURN", "DISABLED"}
IMAGE_SIGNATURES = {".png": b"\x89PNG\r\n\x1a\n", ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".webp": b"RIFF"}


def appendix_a_blocks() -> list[Any]:
    text = (REPO_ROOT / "docs" / "implementation.md").read_text()
    return [json.loads(block) for block in re.findall(r"```json\n(.*?)```", text, re.DOTALL)]


def complete_rover_errors(plan: dict[str, Any]) -> list[str]:
    errors = []
    roles = Counter(c["role"] for c in plan["components"])
    for role, need in REQUIRED_ROLES.items():
        if roles[role] < need:
            errors.append(f"needs {need} distinct '{role}' instance(s), found {roles[role]}")
    if not plan["bom"]["items"]:
        errors.append("BOM is empty")
    if len(plan["assembly_steps"]) < 6:
        errors.append(f"needs at least 6 assembly steps, found {len(plan['assembly_steps'])}")
    if not any(c["parent_instance_id"] and c["attached_to_mount_id"] for c in plan["components"]):
        errors.append("no mount references to check")
    if not any(c["kind"] == "electrical" for c in plan["connections"]):
        errors.append("no port references to check")
    return errors


def synthetic_marking_errors(plan: dict[str, Any], catalog: list[Any]) -> list[str]:
    by_id = {r["catalog_id"]: r for r in catalog}
    errors = []
    if "synthetic" not in plan["title"].lower():
        errors.append("plan title must say it is synthetic")
    for cid in sorted({c["catalog_id"] for c in plan["components"]}):
        record = by_id.get(cid)
        if record is None or "SYNTHETIC" not in (record["identity"]["manufacturer"] or ""):
            errors.append(f"{cid} is not explicitly marked synthetic in the catalog")
        elif record["sourcing"]["purchase_url"] is not None:
            errors.append(f"{cid} is synthetic but carries a purchase URL")
    return errors


def failing_driver_errors(plan: dict[str, Any]) -> list[str]:
    errors = []
    if plan["status"] == "verified" or plan["status"] == "verified_with_warnings":
        errors.append(f"failing-driver plan must not be {plan['status']}")
    current = [f for f in plan["verification"]["findings"] if f["rule_id"] == "electrical.motor_driver_current"]
    if not any(f["result"] in ("FAIL", "UNKNOWN") and f["severity"] == "blocking" for f in current):
        errors.append("needs a blocking FAIL/UNKNOWN electrical.motor_driver_current finding")
    motor_ids = {c["instance_id"] for c in plan["components"] if c["role"] == "motor"}
    driver_ids = {c["instance_id"] for c in plan["components"] if c["role"] == "motor_driver"}
    wired = any(
        {conn["from"]["instance_id"], conn["to"]["instance_id"]} & motor_ids
        and {conn["from"]["instance_id"], conn["to"]["instance_id"]} & driver_ids
        for conn in plan["connections"]
    )
    if not wired:
        errors.append("no driver-to-motor connection carries the current case")
    return errors


def _finite(*values: Any) -> bool:
    return all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values)


def sim_scenario_errors(doc: dict[str, Any]) -> list[str]:
    errors = []
    required = ("scenario_id", "label", "plan_fixture", "seed", "fixed_dt_s", "start_pose", "obstacles", "run_ticks", "expected")
    missing = [k for k in required if k not in doc]
    if missing:
        return [f"missing keys: {missing}"]
    if doc["label"] != "Simplified kinematic simulation":
        errors.append("label must be 'Simplified kinematic simulation'")
    if not (REPO_ROOT / "fixtures" / doc["plan_fixture"]).exists():
        errors.append(f"plan_fixture {doc['plan_fixture']!r} does not exist")
    pose = doc["start_pose"]
    if not isinstance(pose, dict) or not _finite(pose.get("x"), pose.get("y"), pose.get("theta")):
        return [*errors, "start_pose must be one finite {x, y, theta}"]
    if not _finite(doc["fixed_dt_s"]) or abs(doc["fixed_dt_s"] - 1 / 60) > 1e-12:
        errors.append("fixed_dt_s must be the engine's 1/60 s step")
    hx, hy = math.cos(pose["theta"]), math.sin(pose["theta"])

    def ahead(o: dict[str, Any]) -> bool:
        if o.get("kind") == "box":
            corners = [(x, y) for x in (o["min"]["x"], o["max"]["x"]) for y in (o["min"]["y"], o["max"]["y"])]
        elif o.get("kind") == "wall":
            corners = [(o["start"]["x"], o["start"]["y"]), (o["end"]["x"], o["end"]["y"])]
        else:
            return False
        along = [(x - pose["x"]) * hx + (y - pose["y"]) * hy for x, y in corners]
        across = [-(x - pose["x"]) * hy + (y - pose["y"]) * hx for x, y in corners]
        return min(along) > 0 and min(across) <= 0 <= max(across)

    if not any(ahead(o) for o in doc["obstacles"]):
        errors.append("needs a wall or box directly ahead of start_pose")
    transitions = doc["expected"].get("transitions") or []
    if not transitions:
        errors.append("expected.transitions is empty")
    prev_tick, state = -1, "FORWARD"
    for i, t in enumerate(transitions):
        if t["from"] != state or t["to"] not in SIM_STATES:
            errors.append(f"transition {i}: {t['from']}->{t['to']} does not follow {state}")
        if not isinstance(t["tick"], int) or t["tick"] <= prev_tick:
            errors.append(f"transition {i}: ticks must be strictly increasing integers")
        elif abs(t["time_s"] - t["tick"] * doc["fixed_dt_s"]) > 1e-9:
            errors.append(f"transition {i}: time_s must equal tick * fixed_dt_s")
        prev_tick, state = t["tick"], t["to"]
    if transitions and transitions[0]["reason"] != "obstacle_within_stop_distance":
        errors.append("first transition must be the obstacle stop")
    if prev_tick > doc["run_ticks"]:
        errors.append("run_ticks ends before the last expected transition")
    if doc["expected"].get("final_state") != state:
        errors.append("expected.final_state disagrees with the last transition")
    return errors


def image_errors() -> list[str]:
    images = sorted((REPO_ROOT / IMAGES_DIR).glob("rover-reference.*"))
    if len(images) != 1:
        return [f"expected exactly one {IMAGES_DIR}/rover-reference.*, found {len(images)}"]
    signature = IMAGE_SIGNATURES.get(images[0].suffix.lower())
    if signature is None or not images[0].read_bytes().startswith(signature):
        return [f"{rel(images[0])} is not a PNG/JPEG/WebP file"]
    readme = REPO_ROOT / "fixtures" / "README.md"
    if not readme.exists() or "license" not in readme.read_text().lower():
        return ["fixtures/README.md must record the image provenance and license"]
    return []


def check_shared_fixtures(report: Report) -> None:
    shared = REPO_ROOT / "fixtures"
    if not shared.exists():
        report.result("shared     fixtures/", ["fixtures/ is missing"])
        return
    blocks = appendix_a_blocks()
    for path, index in APPENDIX_A_COPIES.items():
        report.result(f"appendix A {path}", [] if load_json(REPO_ROOT / path) == blocks[index] else ["differs from docs/implementation.md"])
    catalog = catalog_records(load_json(REPO_ROOT / SHARED_CATALOGS[0]))
    plan = load_json(REPO_ROOT / KNOWN_PLANS[0][0])
    failing = load_json(REPO_ROOT / KNOWN_PLANS[1][0])
    report.result(f"complete   {KNOWN_PLANS[0][0]}", complete_rover_errors(plan))
    for path, doc in ((KNOWN_PLANS[0][0], plan), (KNOWN_PLANS[1][0], failing)):
        report.result(f"synthetic  {path}", synthetic_marking_errors(doc, catalog))
    report.result(f"failing    {KNOWN_PLANS[1][0]}", failing_driver_errors(failing))
    report.result(f"sim        {SIM_SCENARIO}", sim_scenario_errors(load_json(REPO_ROOT / SIM_SCENARIO)))
    report.result(f"image      {IMAGES_DIR}/rover-reference.*", image_errors())


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
        check_shared_fixtures(report)
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
