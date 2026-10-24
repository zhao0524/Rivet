"""Immutable offline test inputs for every engine task.

- `appendix_*`: exact copies of docs/implementation.md Appendix A and section 3.1. Prefer
  the shared repo `fixtures/` once they exist (see `shared_fixture`).
- `synthetic_*`: SYNTHETIC TEST-ONLY complete rover data (see synthetic.py).

Each call returns a fresh deep copy, so tests can mutate results freely.
"""

from __future__ import annotations

import copy
import json
from functools import cache
from pathlib import Path
from typing import Any

from rivet_engine.models import BuildPlan, CatalogComponent, IntentSpec
from rivet_engine.ports import Catalog
from tests.support import synthetic

SUPPORT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SUPPORT_DIR.parents[3]
SHARED_FIXTURES = REPO_ROOT / "fixtures"


@cache
def _read(path: Path) -> Any:
    return json.loads(path.read_text())


def shared_fixture(relative: str) -> Path | None:
    """Path to a shared repo fixture if it has landed, else None."""
    path = SHARED_FIXTURES / relative
    return path if path.exists() else None


def appendix_catalog_records() -> list[dict[str, Any]]:
    return copy.deepcopy(_read(SUPPORT_DIR / "appendix_a" / "seed-components.json"))


def appendix_plan_dict() -> dict[str, Any]:
    return copy.deepcopy(_read(SUPPORT_DIR / "appendix_a" / "rover_obstacle_v1.json"))


def appendix_intent_dict() -> dict[str, Any]:
    return copy.deepcopy(_read(SUPPORT_DIR / "appendix_a" / "intent_rover_obstacle_v1.json"))


def appendix_catalog() -> Catalog:
    records = appendix_catalog_records()
    return Catalog("SYNTHETIC-BOOTSTRAP", tuple(CatalogComponent.model_validate(r) for r in records))


def appendix_plan() -> BuildPlan:
    return BuildPlan.model_validate(appendix_plan_dict())


def appendix_intent() -> IntentSpec:
    return IntentSpec.model_validate(appendix_intent_dict())


def synthetic_catalog_records() -> list[dict[str, Any]]:
    return synthetic.synthetic_catalog_records()


def synthetic_catalog() -> Catalog:
    return Catalog(
        synthetic.CATALOG_VERSION,
        tuple(CatalogComponent.model_validate(r) for r in synthetic.synthetic_catalog_records()),
    )


def synthetic_plan_dict() -> dict[str, Any]:
    return synthetic.synthetic_plan_dict()


def synthetic_plan() -> BuildPlan:
    return BuildPlan.model_validate(synthetic.synthetic_plan_dict())


def synthetic_intent_dict(**requirements: Any) -> dict[str, Any]:
    """Appendix intent pointed at the synthetic controller, with requirement overrides."""
    intent = appendix_intent_dict()
    intent["requirements"]["preferred_controller_catalog_id"] = "synthetic.controller"
    intent["requirements"].update(requirements)
    return intent


substitute = synthetic.substitute
SYNTHETIC_PIN_MAP = synthetic.SYNTHETIC_PIN_MAP
