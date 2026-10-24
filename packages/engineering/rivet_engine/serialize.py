"""Deterministic BuildPlan serialization (B6). Only documented fields; nulls preserved."""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from rivet_engine.models import BuildPlan
from rivet_engine.ports import InvalidInputError


def plan_to_dict(plan: BuildPlan) -> dict[str, Any]:
    return plan.to_wire()


def plan_to_json(plan: BuildPlan) -> str:
    return json.dumps(plan_to_dict(plan), sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def plan_from_dict(data: Any) -> BuildPlan:
    try:
        return BuildPlan.model_validate(data)
    except ValidationError as exc:
        errors = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        raise InvalidInputError("Not a valid BuildPlan", {"errors": errors}) from exc
