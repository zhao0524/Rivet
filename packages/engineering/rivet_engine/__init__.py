"""Rivet engineering engine: public entry points (docs/implementation.md section 6, B0).

All four functions are pure and offline: no model, network or renderer calls. They
take and return canonical JSON dicts. Unsupported or malformed requests raise
`EngineError` subclasses whose `to_envelope()` matches the API error envelope.
"""

from __future__ import annotations

from typing import Any

from rivet_engine.catalog import catalog_from_records, load_catalog
from rivet_engine.ports import Catalog, EngineError, EngineNotImplementedError, InvalidInputError, UnsupportedRequestError

__version__ = "0.1.0"
# True while the entry points below are placeholders that always raise.
_ENTRY_POINTS_ARE_STUBS = False


def _builder():
    from rivet_engine.catalog import load_fit_evidence
    from rivet_engine.configurator import Builder

    return Builder(load_catalog(), fit_evidence=load_fit_evidence())


def solve(intent: dict[str, Any]) -> dict[str, Any]:
    """Return a complete, verified (or honestly caveated) BuildPlan for a supported rover intent."""
    from rivet_engine.configurator import parse_intent, solve_intent

    return solve_intent(parse_intent(intent), _builder()).to_wire()


def apply_edit(plan: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
    """Return {"accepted": True, "plan": <next revision>} or {"accepted": False, "finding": ...}.

    Never mutates its inputs. Supported operations: set_budget, set_behavior_parameter,
    replace_optional_sensor, set_mount_offset_within_template, change_appearance_color.
    """
    from rivet_engine.configurator import edit_plan
    from rivet_engine.serialize import plan_from_dict

    if not isinstance(operation, dict):
        raise InvalidInputError("Edit operation must be an object")
    current = plan_from_dict(plan)
    try:
        return edit_plan(current, operation, _builder())
    except UnsupportedRequestError as err:
        from rivet_engine.ports import finding

        return {"accepted": False, "finding": finding("edit.unsupported_plan", "FAIL", "blocking", err.message).to_wire()}


def verify(plan: dict[str, Any], catalog: Any = None) -> dict[str, Any]:
    """Deterministic verification report {"overall", "findings"} for a plan.

    `catalog` may be None (packaged catalog), a list of CatalogComponent dicts, or
    {"catalog_version", "components"}.
    """
    from rivet_engine.configurator import Builder
    from rivet_engine.serialize import plan_from_dict

    model = plan_from_dict(plan)
    if catalog is None:
        resolved: Catalog = load_catalog()
    elif isinstance(catalog, list):
        resolved = catalog_from_records(catalog, "caller-supplied")
    elif isinstance(catalog, dict) and isinstance(catalog.get("components"), list):
        resolved = catalog_from_records(catalog["components"], str(catalog.get("catalog_version") or "caller-supplied"))
    else:
        raise InvalidInputError("catalog must be None, a list of components, or {components: [...]}")
    from rivet_engine.catalog import load_fit_evidence

    # Fit evidence is keyed by packaged catalog IDs; it only applies to the packaged catalog.
    report = Builder(resolved, fit_evidence=load_fit_evidence() if catalog is None else None).verify(model)
    return {"overall": report.overall, "findings": [f.to_wire() for f in report.findings]}


def get_catalog() -> list[dict[str, Any]]:
    """Return the packaged catalog as canonical CatalogComponent dicts."""
    return load_catalog().to_wire()


__all__ = ["EngineError", "EngineNotImplementedError", "apply_edit", "get_catalog", "solve", "verify"]
