"""Engine contract conformance (B0, B4): models and outputs against the shared contracts/.

`contracts/*.schema.json` (INT-1, JSON Schema 2020-12, frozen v1) is the shared wire format;
`rivet_engine/models.py` is the engine's. This module keeps the two equal and checks real
engine output and the shared `fixtures/` (INT-2) against the schemas:

1. Models vs contracts: every object in each contract, top level and nested (through
   `$ref`/`$defs`), is compared with the JSON Schema of the matching Pydantic model:
   property names, extra-key policy, required sets, nullability and enum/const values.
   Intended differences are listed in ALLOWED_DIFFERENCES with the reason; nothing else may
   differ. Conditional rules (`if`/`then`) and value constraints (patterns, minimums) are
   checked by validating documents, below, not by this structural comparison.
2. Engine output validates: `solve()` on the shared intent fixture, `apply_edit()`,
   `verify()` and `get_catalog()`.
3. The schemas accept the shared fixtures and a fresh plan, and reject
   `contracts/examples/invalid/*.json` and targeted mutations of a valid engine plan.
4. The shared failing-driver plan yields the blocking `electrical.motor_driver_current`
   finding through the public `verify()`.

JSON Schema cannot express the section 3.4 cross-object rules (instances, mounts, ports and
BOM rows must resolve); the engine enforces those as `integrity.*` findings. Nothing here
skips: a missing contract, fixture or `jsonschema` (dev extra) is a failure.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from decimal import Decimal
from functools import cache
from pathlib import Path
from typing import Any, Callable

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

import rivet_engine
from rivet_engine.models import BuildPlan, CatalogComponent, IntentSpec
from tests import support

CONTRACTS_DIR = support.REPO_ROOT / "contracts"
FIXTURES_DIR = support.SHARED_FIXTURES
# contracts/<name>.schema.json -> the engine model for the same record.
MODELS = {"intent": IntentSpec, "component": CatalogComponent, "build-plan": BuildPlan}


# --- contract loading and validation ----------------------------------------------------


@cache
def _contract_text(name: str) -> str:
    return (CONTRACTS_DIR / f"{name}.schema.json").read_text(encoding="utf-8")


def contract(name: str) -> dict[str, Any]:
    """A fresh copy of contracts/<name>.schema.json (callers may mutate it)."""
    return json.loads(_contract_text(name))


@cache
def _validator(name: str, pointer: str) -> Draft202012Validator:
    root = contract(name)
    Draft202012Validator.check_schema(root)
    schema = root
    if pointer:
        node: Any = root
        for part in pointer.strip("/").split("/"):
            node = node[part]
        # One node of the contract, keeping its `$defs` so local `$ref`s still resolve.
        schema = {"$schema": root["$schema"], "$defs": root.get("$defs", {}), **node}
    # The v1 contracts constrain strings with `pattern`, not `format`. Format checking is on
    # anyway, so a `format` added later is enforced instead of silently ignored.
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def schema_errors(name: str, doc: Any, pointer: str = "") -> list[str]:
    """Violations of `doc` (as JSON on the wire) against a contract or one node of it."""
    wire = json.loads(json.dumps(doc))
    errors = sorted(_validator(name, pointer).iter_errors(wire), key=lambda e: e.json_path)
    return [f"{e.json_path}: {e.message}" for e in errors]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_files(directory: Path) -> list[Path]:
    # An empty directory yields a path that cannot be read, so the test fails instead of
    # pytest skipping an empty parameter set.
    return sorted(directory.glob("*.json")) or [directory / "(no JSON files found)"]


def _name(path: Path) -> str:
    return path.name


# --- 1. models vs contracts ---------------------------------------------------------------

# Difference kinds reported by the comparison.
MISSING = "missing"  # the contract defines the property, the model does not
EXTRA = "extra"  # the model defines the property, the contract does not
REQUIRED = "required"  # required sets differ (over the properties both define)
EXTRA_KEYS = "extra-keys"  # one side forbids undocumented keys, the other allows them
NULLABLE = "nullable"  # one side allows null, the other does not
ENUM = "enum"  # enum/const values differ, or only one side restricts the values
SHAPE = "shape"  # object vs array vs scalar disagree
OPEN_MAP = "open-map"  # open contract object with named properties vs a free-form model map

# (contract, path, kind) -> why the difference is intended. Each entry must still occur
# (test_allowed_differences_still_occur), so the list cannot go stale.
ALLOWED_DIFFERENCES: dict[tuple[str, str, str], str] = {
    ("build-plan", "provenance.sourcing", MISSING): (
        "Response-only summary that services/api adds to GET /api/projects/{build_id}; the contract "
        "says it is never stored or emitted by the engine. The engine model rejects it, so a stored "
        "or edited plan cannot carry it (test_response_only_sourcing_never_enters_the_engine)."
    ),
    ("build-plan", "components[].render_overrides", OPEN_MAP): (
        "Presentation hints: the contract documents optional `color` and `visible` on an open object; "
        "the engine keeps hint keys in a dict[str, Any], so every hint the contract allows is accepted. "
        "Hints the engine emits are validated against the schema by the solve and apply_edit tests."
    ),
    ("build-plan", "concept", MISSING): (
        "Concept models (appearance only) are built by services/api/rivet_api/concept without the engine; "
        "the engine never emits or accepts them."
    ),
    ("build-plan", "concept_catalog", MISSING): (
        "Concept models carry their own concept.* catalog entries; built by services/api, never by the engine."
    ),
    ("build-plan", "behavior", NULLABLE): (
        "Only concept models (built by services/api) have no behavior; every engine plan has one."
    ),
}


@dataclass(frozen=True)
class Difference:
    contract: str
    path: str
    kind: str
    detail: str

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.contract, self.path, self.kind)

    def __str__(self) -> str:
        return f"{self.path or '(root)'} [{self.kind}]: {self.detail}"


def _join(path: str, name: str) -> str:
    return f"{path}.{name}" if path else name


def _deref(node: Any, root: dict[str, Any]) -> Any:
    """Inline local `$ref`s; sibling keywords win, as JSON Schema 2020-12 allows them."""
    seen: list[str] = []
    while isinstance(node, dict) and "$ref" in node:
        ref = node["$ref"]
        if not ref.startswith("#/") or ref in seen:
            raise ValueError(f"unsupported or cyclic $ref {ref!r}")
        seen.append(ref)
        target: Any = root
        for part in ref[2:].split("/"):
            target = target[part.replace("~1", "/").replace("~0", "~")]
        node = {**target, **{k: v for k, v in node.items() if k != "$ref"}}
    return node


def _enum_values(node: dict[str, Any]) -> list[Any] | None:
    if "enum" not in node and "const" not in node:
        return None
    values = list(node.get("enum", []))
    if "const" in node and node["const"] not in values:
        values.append(node["const"])
    return values


def _alternatives(node: Any, root: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """The non-null alternatives a schema node allows, and whether it allows null."""
    node = _deref(node, root)
    for key in ("anyOf", "oneOf"):
        if key in node:
            options: list[dict[str, Any]] = []
            nullable = False
            for option in node[key]:
                found, null = _alternatives(option, root)
                options += found
                nullable = nullable or null
            return options, nullable
    types = node.get("type")
    if isinstance(types, list):
        rest = [t for t in types if t != "null"]
        if not rest:
            return [], True
        return [{**node, "type": rest[0] if len(rest) == 1 else rest}], len(rest) < len(types)
    if types == "null":
        return [], True
    values = _enum_values(node)
    if values is not None and None in values:
        rest = [v for v in values if v is not None]
        return ([{"enum": rest}] if rest else []), True
    return [node], False


def _kind(node: dict[str, Any]) -> str:
    if _enum_values(node) is not None:
        return "enum"
    if node.get("type") == "object" or "properties" in node or "additionalProperties" in node:
        return "object"
    if node.get("type") == "array" or "items" in node:
        return "array"
    return "scalar"


def _values_text(values: set[str]) -> str:
    return "[" + ", ".join(sorted(values)) + "]"


def _map_values(node: dict[str, Any]) -> Any:
    """`additionalProperties` of a map: a value schema, True (any value) or False (no keys)."""
    values = node.get("additionalProperties", True)
    return True if values == {} else values


@dataclass
class Comparison:
    """Walks a contract and a model's JSON Schema in parallel, collecting differences."""

    name: str
    contract: dict[str, Any]
    model: dict[str, Any]
    differences: list[Difference] = field(default_factory=list)
    compared_objects: set[str] = field(default_factory=set)

    def run(self) -> Comparison:
        self._node(self.contract, self.model, "")
        return self

    def _diff(self, path: str, kind: str, detail: str) -> None:
        self.differences.append(Difference(self.name, path, kind, detail))

    def _node(self, contract_node: Any, model_node: Any, path: str) -> None:
        c_options, c_null = _alternatives(contract_node, self.contract)
        m_options, m_null = _alternatives(model_node, self.model)
        if c_null != m_null:
            self._diff(path, NULLABLE, f"contract {'allows' if c_null else 'forbids'} null, "
                                       f"engine model {'allows' if m_null else 'forbids'} null")
        c_kinds: dict[str, list[dict[str, Any]]] = {}
        m_kinds: dict[str, list[dict[str, Any]]] = {}
        for options, kinds in ((c_options, c_kinds), (m_options, m_kinds)):
            for option in options:
                kinds.setdefault(_kind(option), []).append(option)

        c_enum, m_enum = c_kinds.pop("enum", None), m_kinds.pop("enum", None)
        if c_enum and m_enum:
            c_values = {json.dumps(v) for o in c_enum for v in _enum_values(o) or []}
            m_values = {json.dumps(v) for o in m_enum for v in _enum_values(o) or []}
            if c_values != m_values:
                self._diff(path, ENUM, f"only in contract {_values_text(c_values - m_values)}, "
                                       f"only in engine model {_values_text(m_values - c_values)}")
        elif c_enum:
            values = {json.dumps(v) for o in c_enum for v in _enum_values(o) or []}
            self._diff(path, ENUM, f"contract allows only {_values_text(values)}, engine model accepts any value")
            m_kinds.pop("scalar", None)
        elif m_enum:
            values = {json.dumps(v) for o in m_enum for v in _enum_values(o) or []}
            self._diff(path, ENUM, f"engine model allows only {_values_text(values)}, contract accepts any value")
            c_kinds.pop("scalar", None)

        if set(c_kinds) != set(m_kinds):
            self._diff(path, SHAPE, f"contract is {sorted(c_kinds) or ['null']}, "
                                    f"engine model is {sorted(m_kinds) or ['null']}")
            return
        for kind in ("object", "array"):
            if kind in c_kinds and (len(c_kinds[kind]) > 1 or len(m_kinds[kind]) > 1):
                self._diff(path, SHAPE, f"more than one {kind} alternative; compare by hand")
                return
        if "object" in c_kinds:
            self._object(c_kinds["object"][0], m_kinds["object"][0], path)
        if "array" in c_kinds:
            c_items, m_items = c_kinds["array"][0].get("items"), m_kinds["array"][0].get("items")
            if isinstance(c_items, dict) and isinstance(m_items, dict):
                self._node(c_items, m_items, f"{path}[]")
            elif isinstance(c_items, dict) != isinstance(m_items, dict):
                self._diff(path, SHAPE, "only one side constrains the array items")

    def _object(self, c: dict[str, Any], m: dict[str, Any], path: str) -> None:
        self.compared_objects.add(path)
        c_props, m_props = c.get("properties"), m.get("properties")
        c_closed, m_closed = c.get("additionalProperties") is False, m.get("additionalProperties") is False
        if c_props is None and m_props is None:  # both are maps: compare the value schemas
            c_values, m_values = _map_values(c), _map_values(m)
            if isinstance(c_values, dict) and isinstance(m_values, dict):
                self._node(c_values, m_values, f"{path}.*")
            elif c_values != m_values:
                self._diff(path, SHAPE, f"map values: contract {c_values!r}, engine model {m_values!r}")
            return
        if c_props is not None and m_props is None and not c_closed and not m_closed and not c.get("required"):
            self._diff(path, OPEN_MAP, f"contract documents optional properties {sorted(c_props)} on an open "
                                       "object; the engine model is a free-form map")
            return
        if c_props is None or m_props is None:
            self._diff(path, SHAPE, f"contract has properties {sorted(c_props or [])}, "
                                    f"engine model has properties {sorted(m_props or [])}")
            return
        if c_closed != m_closed:
            self._diff(path, EXTRA_KEYS, f"contract {'forbids' if c_closed else 'allows'} undocumented keys, "
                                         f"engine model {'forbids' if m_closed else 'allows'} them")
        c_required, m_required = set(c.get("required", [])), set(m.get("required", []))
        for name in sorted(set(c_props) - set(m_props)):
            status = "required" if name in c_required else "optional"
            self._diff(_join(path, name), MISSING, f"contract defines {status} property {name!r}; "
                                                   "the engine model has no such field")
        for name in sorted(set(m_props) - set(c_props)):
            forbidden = " and forbids undocumented keys" if c_closed else ""
            self._diff(_join(path, name), EXTRA, f"engine model defines property {name!r}; the contract does not{forbidden}")
        common = set(c_props) & set(m_props)
        if c_required & common != m_required & common:
            self._diff(path, REQUIRED, f"required only in contract {sorted((c_required - m_required) & common)}, "
                                       f"required only in engine model {sorted((m_required - c_required) & common)}")
        for name in sorted(common):
            self._node(c_props[name], m_props[name], _join(path, name))


def model_schema(name: str) -> dict[str, Any]:
    return MODELS[name].model_json_schema(by_alias=True, mode="validation")


def compare(name: str, contract_schema: dict[str, Any] | None = None,
            model_json: dict[str, Any] | None = None) -> Comparison:
    return Comparison(
        name,
        contract_schema if contract_schema is not None else contract(name),
        model_json if model_json is not None else model_schema(name),
    ).run()


def contract_object_paths(schema: dict[str, Any]) -> set[str]:
    """Every object node of a contract, found independently of Comparison."""
    paths: set[str] = set()

    def walk(node: Any, path: str) -> None:
        for option in _alternatives(node, schema)[0]:
            kind = _kind(option)
            if kind == "object":
                paths.add(path)
                for name, sub in option.get("properties", {}).items():
                    walk(sub, _join(path, name))
                if isinstance(option.get("additionalProperties"), dict):
                    walk(option["additionalProperties"], f"{path}.*")
            elif kind == "array" and isinstance(option.get("items"), dict):
                walk(option["items"], f"{path}[]")

    walk(schema, "")
    return paths


def _within(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith((f"{prefix}.", f"{prefix}["))


@pytest.mark.parametrize("name", sorted(MODELS))
def test_model_matches_contract(name):
    found = compare(name).differences
    unexpected = [d for d in found if d.key not in ALLOWED_DIFFERENCES]
    assert not unexpected, (
        f"rivet_engine.models.{MODELS[name].__name__} differs from contracts/{name}.schema.json:\n"
        + "\n".join(f"  - {d}" for d in unexpected)
        + "\nFix the model if the contract is right. contracts/ is frozen: if the contract looks wrong, "
        "record it in docs/context.md section 6 instead, and allow only an intended difference in "
        "ALLOWED_DIFFERENCES, with the reason."
    )


def test_allowed_differences_still_occur():
    found = [d for name in MODELS for d in compare(name).differences]
    stale = sorted(set(ALLOWED_DIFFERENCES) - {d.key for d in found})
    assert not stale, f"these ALLOWED_DIFFERENCES no longer occur; remove them: {stale}"
    # A property the contract requires can never be allowed to be missing from the model.
    required = [str(d) for d in found if d.key in ALLOWED_DIFFERENCES and d.kind == MISSING
                and "required property" in d.detail]
    assert not required, required


@pytest.mark.parametrize("name", sorted(MODELS))
def test_every_contract_object_is_compared(name):
    absent = [path for (c, path, kind) in ALLOWED_DIFFERENCES if c == name and kind == MISSING]
    expected = {p for p in contract_object_paths(contract(name)) if not any(_within(p, a) for a in absent)}
    compared = compare(name).compared_objects
    assert expected <= compared, f"contract objects never compared: {sorted(expected - compared)}"
    assert len(expected) > 1  # nested objects were found through $ref/$defs, not only the root


def _drop_property(obj: dict[str, Any], name: str) -> None:
    obj["properties"].pop(name)
    obj["required"].remove(name)


def _set_in(path: tuple[str, ...], value: Any) -> Callable[[dict[str, Any]], None]:
    def mutate(schema: dict[str, Any]) -> None:
        target = schema
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value

    return mutate


# Each change to one side must surface as (path, kind): proves the comparison follows
# $ref/$defs into nested objects and is not vacuous.
COMPARISON_SELF_CHECKS = [
    ("build-plan", "contract", lambda s: s["$defs"]["finding"]["properties"].update(confidence={"type": "number"}),
     "verification.findings[].confidence", MISSING),
    ("build-plan", "contract", lambda s: s["$defs"]["endpoint"]["required"].append("port_id"),
     "connections[].from", REQUIRED),
    ("build-plan", "contract", lambda s: s["properties"]["bom"]["properties"]["total_status"]["enum"].remove("complete"),
     "bom.total_status", ENUM),
    ("build-plan", "contract", lambda s: s["properties"]["simulation"].update(additionalProperties=True),
     "simulation", EXTRA_KEYS),
    ("build-plan", "contract", lambda s: _drop_property(s["$defs"]["component_instance"], "role"),
     "components[].role", EXTRA),
    ("build-plan", "contract", _set_in(("properties", "firmware", "properties", "pin_map"), {"type": "string"}),
     "firmware.pin_map", SHAPE),
    ("build-plan", "model", lambda s: s["$defs"]["Provenance"]["properties"].update(cache_key={"type": "string"}),
     "provenance.cache_key", EXTRA),
    ("build-plan", "model", lambda s: s["$defs"]["Firmware"]["properties"]["pin_map"].update(
        additionalProperties={"type": "string", "enum": ["a"]}), "firmware.pin_map.*", ENUM),
    ("intent", "contract", _set_in(("properties", "requirements", "properties", "currency", "type"), ["string", "null"]),
     "requirements.currency", NULLABLE),
    ("intent", "model", lambda s: s["$defs"]["IntentInput"]["required"].remove("user_text"),
     "input", REQUIRED),
    ("component", "contract", lambda s: s["properties"]["ports"]["items"]["properties"]["signal"]["enum"].append("can_bus"),
     "ports[].signal", ENUM),
    ("component", "contract", _set_in(("properties", "physical", "properties", "dimensions_mm"), {"type": "number"}),
     "physical.dimensions_mm", SHAPE),
]


@pytest.mark.parametrize("name, side, mutate, path, kind", COMPARISON_SELF_CHECKS,
                         ids=[f"{c[0]}:{c[1]}:{c[3]}" for c in COMPARISON_SELF_CHECKS])
def test_comparison_detects_a_changed_side(name, side, mutate, path, kind):
    if side == "contract":
        schema = contract(name)
        mutate(schema)
        found = compare(name, contract_schema=schema)
    else:
        schema = model_schema(name)
        mutate(schema)
        found = compare(name, model_json=schema)
    assert (name, path, kind) in {d.key for d in found.differences}, [str(d) for d in found.differences]


def test_response_only_sourcing_never_enters_the_engine(fresh_plan):
    plan = copy.deepcopy(fresh_plan)
    plan["provenance"]["sourcing"] = {
        "synthetic": False, "synthetic_catalog_ids": [], "unverified_link_count": 0, "sku_missing_count": 0,
    }
    assert schema_errors("build-plan", plan) == []  # what GET /api/projects/{build_id} may return
    with pytest.raises(ValidationError, match="sourcing"):
        BuildPlan.model_validate(plan)  # never stored, edited or emitted by the engine
    assert "sourcing" not in fresh_plan["provenance"]


# --- 2. engine output validates against the contracts -------------------------------------


@pytest.fixture(scope="module")
def fresh_plan() -> dict[str, Any]:
    """A plan built now by the public solve() from fixtures/intent/rover_obstacle_v1.json."""
    return rivet_engine.solve(support.appendix_intent_dict())


def test_solve_on_shared_intent_fixture_validates_against_build_plan_schema(fresh_plan):
    assert schema_errors("build-plan", fresh_plan) == []
    assert BuildPlan.model_validate(fresh_plan).to_wire() == fresh_plan  # nothing outside the model
    assert fresh_plan["source_intent_id"] == support.appendix_intent_dict()["intent_id"]
    assert fresh_plan["provenance"]["input_mode"] == support.appendix_intent_dict()["input"]["kind"]


def _other_sensor(plan: dict[str, Any]) -> str:
    current = next(c["catalog_id"] for c in plan["components"] if c["role"] == "distance_sensor")
    return next(r["catalog_id"] for r in rivet_engine.get_catalog()
                if r["identity"]["category"] == "distance_sensor" and r["catalog_id"] != current)


EDITS = [
    lambda plan: {"op": "set_budget", "amount": "500.00", "currency": "USD"},
    lambda plan: {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 700},
    lambda plan: {"op": "replace_optional_sensor", "catalog_id": _other_sensor(plan)},
    lambda plan: {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 5, 0]},
    lambda plan: {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "#112233"},
]


@pytest.mark.parametrize("make_operation", EDITS, ids=[
    "set_budget", "set_behavior_parameter", "replace_optional_sensor", "set_mount_offset_within_template",
    "change_appearance_color",
])
def test_accepted_edit_validates_against_build_plan_schema(fresh_plan, make_operation):
    result = rivet_engine.apply_edit(fresh_plan, make_operation(fresh_plan))
    assert result["accepted"] is True, result.get("finding")
    assert schema_errors("build-plan", result["plan"]) == []
    assert result["plan"]["revision"] == fresh_plan["revision"] + 1


def test_rejected_edit_finding_validates_against_finding_schema(fresh_plan):
    result = rivet_engine.apply_edit(fresh_plan, {"op": "teleport"})
    assert result["accepted"] is False
    assert schema_errors("build-plan", result["finding"], "/$defs/finding") == []


def test_verify_report_validates_against_verification_schema(fresh_plan):
    report = rivet_engine.verify(fresh_plan)
    assert schema_errors("build-plan", report, "/properties/verification") == []


def test_packaged_catalog_validates_against_component_schema():
    records = rivet_engine.get_catalog()
    errors = {r["catalog_id"]: schema_errors("component", r) for r in records}
    assert records and {k: v for k, v in errors.items() if v} == {}


@pytest.mark.parametrize("call", [
    lambda: rivet_engine.solve({"schema_version": "1.0"}),
    lambda: rivet_engine.solve(support.appendix_intent_dict() | {"project_family": "drone"}),
    lambda: rivet_engine.verify({"build_id": "rivet-x"}),
    lambda: rivet_engine.apply_edit(support.appendix_plan_dict(), "not an object"),
], ids=["solve-invalid-intent", "solve-unsupported-family", "verify-invalid-plan", "apply_edit-invalid-operation"])
def test_engine_error_envelope_validates_against_errors_schema(call):
    with pytest.raises(rivet_engine.EngineError) as caught:
        call()
    assert schema_errors("errors", caught.value.to_envelope()) == []


# --- 3. the schemas accept valid documents and reject invalid ones ------------------------


@pytest.mark.parametrize("path", _json_files(FIXTURES_DIR / "plans"), ids=_name)
def test_shared_plan_fixture_conforms(path):
    plan = _read_json(path)
    assert schema_errors("build-plan", plan) == []
    assert BuildPlan.model_validate(plan).to_wire() == plan
    report = rivet_engine.verify(plan, support.appendix_catalog_records())
    assert schema_errors("build-plan", report, "/properties/verification") == []


@pytest.mark.parametrize("path", _json_files(FIXTURES_DIR / "intent"), ids=_name)
def test_shared_intent_fixtures_conform(path):
    intent = _read_json(path)
    assert schema_errors("intent", intent) == []
    assert IntentSpec.model_validate(intent).to_wire() == intent


@pytest.mark.parametrize("path", _json_files(FIXTURES_DIR / "catalog"), ids=_name)
def test_shared_catalog_fixtures_conform(path):
    doc = _read_json(path)
    records = doc["components"] if isinstance(doc, dict) else doc  # bare list or {components: [...]}
    assert records
    for record in records:
        assert schema_errors("component", record) == [], record["catalog_id"]
        assert CatalogComponent.model_validate(record).to_wire() == record


def _contract_for(doc: Any) -> str:
    if isinstance(doc, dict):
        for key, name in (("build_id", "build-plan"), ("intent_id", "intent"), ("catalog_id", "component"),
                          ("provider_mode", "offer"), ("error", "errors")):
            if key in doc:
                return name
    raise AssertionError(f"cannot tell which contract applies to {str(doc)[:80]}")


def _integrity_failures(report: dict[str, Any]) -> list[str]:
    return [f"{f['rule_id']}: {f['message']}" for f in report["findings"]
            if f["rule_id"].startswith("integrity.") and f["result"] == "FAIL" and f["severity"] == "blocking"]


@pytest.mark.parametrize("path", _json_files(CONTRACTS_DIR / "examples" / "invalid"), ids=_name)
def test_invalid_contract_examples_are_rejected(path):
    doc = _read_json(path)
    name = _contract_for(doc)
    errors = schema_errors(name, doc)
    if not errors and name == "build-plan":
        # Valid shape, broken references (section 3.4): JSON Schema cannot see that, so the
        # engine's integrity rules must reject it, against the shared catalog fixture.
        errors = _integrity_failures(rivet_engine.verify(doc, support.appendix_catalog_records()))
    assert errors, f"{path.name} is accepted by contracts/{name}.schema.json and by the engine's integrity rules"


def test_section_3_3_shape_only_plan_fails_on_unresolved_catalog_ids():
    doc = _read_json(CONTRACTS_DIR / "examples" / "invalid" / "section-3.3-shape-only-plan.json")
    report = rivet_engine.verify(doc, support.appendix_catalog_records())
    unresolved = {i for f in report["findings"] if f["rule_id"] == "integrity.catalog_ids"
                  and f["result"] == "FAIL" and f["severity"] == "blocking" for i in f["affected_instance_ids"]}
    assert unresolved == {"chassis-1", "controller-1"}
    assert report["overall"] == "unbuildable"


def _first_electrical(plan: dict[str, Any]) -> dict[str, Any]:
    return next(c for c in plan["connections"] if c["kind"] == "electrical")


def _verified_with_blocking_unknown(plan: dict[str, Any]) -> None:
    plan["status"] = plan["verification"]["overall"] = "verified"
    plan["verification"]["findings"].append({
        "rule_id": "electrical.motor_driver_current", "result": "UNKNOWN", "severity": "blocking",
        "affected_instance_ids": ["driver-1"], "message": "Motor stall current is not documented",
        "evidence_urls": [],
    })


# (label, change to a fresh engine plan, text expected in a schema error, model must also reject).
# The False group are cross-field or value rules that the schema states and the engine's
# validators enforce on what they build; the models do not encode them, so their verdict on
# those documents is not asserted.
PLAN_MUTATIONS: list[tuple[str, Callable[[dict[str, Any]], Any], str, bool]] = [
    ("undocumented top-level key", lambda p: p.update(cost_estimate="12.00"), "Additional properties", True),
    ("camelCase key", lambda p: p["components"][0].update(instanceId="chassis-1"), "Additional properties", True),
    ("missing bom", lambda p: p.pop("bom"), "'bom' is a required property", True),
    ("finding without evidence_urls", lambda p: p["verification"]["findings"][0].pop("evidence_urls"),
     "'evidence_urls' is a required property", True),
    ("unknown status", lambda p: p.update(status="approved"), "is not one of", True),
    ("unknown finding result", lambda p: p["verification"]["findings"][0].update(result="MAYBE"), "is not one of", True),
    ("unknown link_status", lambda p: p["bom"]["items"][0].update(link_status="probably"), "is not one of", True),
    ("unknown provenance.input_mode", lambda p: p["provenance"].update(input_mode="telepathy"), "is not one of", True),
    ("schema_version 2.0", lambda p: p.update(schema_version="2.0"), "'1.0' was expected", True),
    ("money as a JSON number", lambda p: p["bom"]["items"][0].update(unit_price_amount=1.5), "is not of type", True),
    ("created_at with an offset", lambda p: p.update(created_at="2026-10-24T00:00:00+02:00"), "does not match", True),
    ("revision 0", lambda p: p.update(revision=0), "less than the minimum", True),
    ("BOM quantity 0", lambda p: p["bom"]["items"][0].update(quantity=0), "less than the minimum", True),
    ("pose with two coordinates", lambda p: p["components"][0]["pose"].update(position_mm=[0, 0]), "too short", True),
    ("GPIO as a string", lambda p: p["firmware"]["pin_map"].update(motor_left_pwm="25"), "is not of type 'integer'", True),
    ("electrical connection without a port", lambda p: _first_electrical(p)["to"].update(port_id=None),
     "None is not of type 'string'", False),
    ("verified with a blocking UNKNOWN", _verified_with_blocking_unknown, "should not be valid", False),
    ("simulation kind none but enabled", lambda p: p["simulation"].update(kind="none", enabled=True),
     "False was expected", False),
    ("verified_product row without a link", lambda p: p["bom"]["items"][0].update(
        link_status="verified_product", purchase_url=None), "None is not of type 'string'", False),
    ("complete BOM without a subtotal", lambda p: p["bom"].update(total_status="complete", known_subtotal_amount=None),
     "None is not of type 'string'", False),
    ("evidence URL that is not a URL", lambda p: p["verification"]["findings"][0].update(evidence_urls=["datasheet"]),
     "does not match", False),
    ("negative GPIO", lambda p: p["firmware"]["pin_map"].update(motor_left_pwm=-1), "less than the minimum", False),
]


@pytest.mark.parametrize("label, mutate, expected, model_rejects", PLAN_MUTATIONS, ids=[m[0] for m in PLAN_MUTATIONS])
def test_schema_rejects_mutated_engine_plan(fresh_plan, label, mutate, expected, model_rejects):
    plan = copy.deepcopy(fresh_plan)
    mutate(plan)
    errors = schema_errors("build-plan", plan)
    assert any(expected in e for e in errors), f"{label}: no schema error contains {expected!r}: {errors}"
    if model_rejects:
        with pytest.raises(ValidationError):
            BuildPlan.model_validate(plan)


def _record_with_ports() -> dict[str, Any]:
    return next(r for r in rivet_engine.get_catalog() if r["ports"])


OTHER_MUTATIONS: list[tuple[str, str, Callable[[dict[str, Any]], Any], str, bool]] = [
    ("intent", "unknown project_family", lambda d: d.update(project_family="spaceship"), "is not one of", True),
    ("intent", "undocumented key", lambda d: d.update(unrecognized_key=[]), "Additional properties", True),
    ("intent", "negative budget", lambda d: d["requirements"].update(max_budget=-5), "is not valid under any", True),
    ("intent", "image input without an asset id", lambda d: d["input"].update(image_asset_id=None),
     "None is not of type 'string'", False),
    ("component", "unknown category", lambda d: d["identity"].update(category="laser"), "is not one of", True),
    ("component", "negative current", lambda d: d["ports"][0].update(current_limit_a=-1), "less than the minimum", True),
    ("component", "price as a JSON number", lambda d: d["sourcing"].update(price_amount=4.5),
     "is not valid under any", True),
    ("component", "missing evidence", lambda d: d.pop("evidence"), "'evidence' is a required property", True),
]


@pytest.mark.parametrize("name, label, mutate, expected, model_rejects", OTHER_MUTATIONS,
                         ids=[f"{m[0]}: {m[1]}" for m in OTHER_MUTATIONS])
def test_schemas_reject_mutated_intent_and_component(name, label, mutate, expected, model_rejects):
    doc = support.appendix_intent_dict() if name == "intent" else _record_with_ports()
    mutate(doc)
    errors = schema_errors(name, doc)
    assert any(expected in e for e in errors), f"{label}: no schema error contains {expected!r}: {errors}"
    if model_rejects:
        with pytest.raises(ValidationError):
            MODELS[name].model_validate(doc)


# --- 4. the failing-driver fixture through the public verify() -----------------------------


def _current_findings(report: dict[str, Any]) -> list[dict[str, Any]]:
    return [f for f in report["findings"] if f["rule_id"] == "electrical.motor_driver_current"]


def test_failing_driver_fixture_blocks_on_motor_driver_current():
    plan = support.shared_json("plans/rover_failing_driver_v1.json")
    report = rivet_engine.verify(plan, support.appendix_catalog_records())  # its demo.* parts
    assert schema_errors("build-plan", report, "/properties/verification") == []
    [current] = _current_findings(report)
    # The synthetic driver-to-motor wire joins parts with no sourced current ratings, so the
    # margin cannot be checked: a blocking UNKNOWN (B4: missing stall current is UNKNOWN,
    # never PASS), not a FAIL. No source exists, so no evidence URL is cited (none invented).
    assert (current["result"], current["severity"]) == ("UNKNOWN", "blocking")
    assert current["affected_instance_ids"] == ["driver-1", "motor-left-1"]
    assert current["evidence_urls"] == []
    assert "stall-current rating is not sourced" in current["message"]
    # Never verified. Today it is unbuildable: the Appendix A baseline also fails the engine's
    # pose, wiring and completeness rules (the fixture itself records needs_review).
    assert report["overall"] in ("needs_review", "unbuildable")
    # The finding INT-2 recorded in the fixture is the one the engine computes.
    [recorded] = _current_findings(plan["verification"])
    keys = ("rule_id", "result", "severity", "affected_instance_ids", "evidence_urls")
    assert {k: recorded[k] for k in keys} == {k: current[k] for k in keys}


def _swap_part(plan: dict[str, Any], old: str, new: str) -> dict[str, Any]:
    """Move every instance of catalog part `old` to `new`, keeping BOM prices and links the catalog's."""
    out = copy.deepcopy(plan)
    record = next(r for r in rivet_engine.get_catalog() if r["catalog_id"] == new)
    for component in out["components"]:
        if component["catalog_id"] == old:
            component["catalog_id"] = new
    for item in out["bom"]["items"]:
        if item["catalog_id"] == old:
            item.update(catalog_id=new, unit_price_amount=record["sourcing"]["price_amount"],
                        purchase_url=record["sourcing"]["purchase_url"])
    priced = [Decimal(i["unit_price_amount"]) * i["quantity"] for i in out["bom"]["items"] if i["unit_price_amount"]]
    out["bom"]["known_subtotal_amount"] = str(sum(priced, Decimal("0")).quantize(Decimal("0.01")))
    return out


def test_sourced_stall_current_over_driver_rating_is_a_blocking_fail_with_sources(fresh_plan):
    # The issue's original case on sourced catalog data: Adafruit 3777 TT motors (1.5 A stall)
    # on the TB6612 (1.2 A continuous). The default rover uses 3801 (1.0 A) since issue #32.
    motor = next(c["catalog_id"] for c in fresh_plan["components"] if c["instance_id"] == "motor-left-1")
    plan = _swap_part(fresh_plan, motor, "motor.adafruit_tt_gearbox_200rpm_3777")
    report = rivet_engine.verify(plan)
    assert not _integrity_failures(report)  # a consistent plan, so the finding is about current
    current = _current_findings(report)
    assert sorted(f["affected_instance_ids"] for f in current) == [["driver-1", "motor-left-1"],
                                                                    ["driver-1", "motor-right-1"]]
    for f in current:
        assert (f["result"], f["severity"]) == ("FAIL", "blocking")
        assert "stall current 1.5 A" in f["message"] and "continuous rating 1.2 A" in f["message"]
        assert "https://www.adafruit.com/product/3777" in f["evidence_urls"]
    assert report["overall"] == "unbuildable"
