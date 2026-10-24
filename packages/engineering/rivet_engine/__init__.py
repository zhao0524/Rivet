"""Rivet engineering engine: public entry points (docs/implementation.md section 6, B0).

Until the composition task lands, every entry point raises EngineNotImplementedError.
They never return a fabricated plan or report.
"""

from typing import Any

from rivet_engine.ports import EngineError, EngineNotImplementedError

__version__ = "0.1.0"
# True while the entry points below are placeholders that always raise.
_ENTRY_POINTS_ARE_STUBS = True


def solve(intent: dict[str, Any]) -> dict[str, Any]:
    """Return a complete versioned BuildPlan for a supported rover intent."""
    raise EngineNotImplementedError("solve() is not implemented yet", {"stage": "configurator"})


def apply_edit(plan: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
    """Return {"accepted": True, "plan": ...} or {"accepted": False, "finding": ...}; never mutates input."""
    raise EngineNotImplementedError("apply_edit() is not implemented yet", {"stage": "configurator"})


def verify(plan: dict[str, Any], catalog: Any = None) -> dict[str, Any]:
    """Return a deterministic verification report {"overall", "findings"} for a plan."""
    raise EngineNotImplementedError("verify() is not implemented yet", {"stage": "validators"})


def get_catalog() -> list[dict[str, Any]]:
    """Return the packaged catalog as canonical CatalogComponent dicts."""
    raise EngineNotImplementedError("get_catalog() is not implemented yet", {"stage": "catalog"})


__all__ = ["EngineError", "EngineNotImplementedError", "apply_edit", "get_catalog", "solve", "verify"]
