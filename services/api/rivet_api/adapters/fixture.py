"""Offline engineering adapter backed by a saved synthetic build.

It never computes engineering results: solve returns the saved plan unchanged except
for provenance labels, and edits only touch display/parameter fields, never
`status` or `verification` (those belong to Developer B's engine).
"""

import copy
import json
import re
from pathlib import Path
from typing import Any

_PACKAGED = Path(__file__).resolve().parents[1] / "data" / "fixtures"
_REPO_ROOT_FIXTURES = Path(__file__).resolve().parents[4] / "fixtures"

_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_BEHAVIOR_PARAMS = {
    "obstacle_stop_distance_m": lambda v: v > 0,
    "turn_duration_ms": lambda v: v > 0,
    "forward_speed_fraction": lambda v: 0 < v <= 1,
}


def _fixture_root(name: str) -> Path:
    """Prefer the shared repo fixtures once INT-2 lands; else the packaged copy."""
    plan = f"plans/{name}.json"
    cat = "catalog/seed-components.json"
    if (_REPO_ROOT_FIXTURES / plan).exists() and (_REPO_ROOT_FIXTURES / cat).exists():
        return _REPO_ROOT_FIXTURES
    return _PACKAGED


def _finding(rule_id: str, message: str, instance_ids: list[str] | None = None) -> dict[str, Any]:
    return {
        "rule_id": rule_id,
        "result": "UNKNOWN",
        "severity": "blocking",
        "affected_instance_ids": instance_ids or [],
        "message": message,
        "evidence_urls": [],
    }


def _reject(rule_id: str, message: str, instance_ids: list[str] | None = None) -> dict[str, Any]:
    return {"accepted": False, "finding": _finding(rule_id, message, instance_ids)}


class FixtureEngineeringAdapter:
    def __init__(self, fixture_name: str = "rover_obstacle_v1", generation_mode: str = "fixture"):
        self.fixture_name = fixture_name
        self.generation_mode = generation_mode
        root = _fixture_root(fixture_name)
        self._plan = json.loads((root / "plans" / f"{fixture_name}.json").read_text())
        self._catalog = json.loads((root / "catalog" / "seed-components.json").read_text())

    def get_catalog(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._catalog)

    def describe(self) -> dict[str, Any]:
        """Summary for the examples list; always labeled as a saved fixture."""
        return {
            "example_id": self.fixture_name,
            "title": self._plan["title"],
            "project_family": self._plan["project_family"],
            "status": self._plan["status"],
            "generation_mode": "fixture",
        }

    def solve(self, intent: dict[str, Any]) -> dict[str, Any]:
        plan = copy.deepcopy(self._plan)
        plan["source_intent_id"] = intent["intent_id"]
        plan["provenance"]["generation_mode"] = self.generation_mode
        if self.generation_mode == "fallback":
            plan["provenance"]["notes"].append(
                "Engineering engine unavailable: this is a saved fixture build, not a live result"
            )
        return plan

    def verify(self, plan: dict[str, Any]) -> dict[str, Any]:
        # Fixture mode performs no verification; return what the saved plan already says.
        return copy.deepcopy(plan["verification"])

    def apply_edit(self, plan: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
        op = operation.get("op")
        if op == "set_behavior_parameter":
            return self._set_behavior_parameter(plan, operation)
        if op == "change_appearance_color":
            return self._change_color(plan, operation)
        return _reject(
            "edit.unsupported_in_fixture_mode",
            f"Operation {op!r} is not supported in fixture mode; no changes were made",
        )

    def _set_behavior_parameter(self, plan: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
        name, value = operation.get("name"), operation.get("value")
        check = _BEHAVIOR_PARAMS.get(name)
        if check is None:
            return _reject("edit.unknown_behavior_parameter", f"Unknown behavior parameter {name!r}")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not check(value):
            return _reject("edit.invalid_behavior_value", f"Invalid value {value!r} for {name}")
        new = copy.deepcopy(plan)
        new["behavior"]["parameters"][name] = value
        return {"accepted": True, "plan": new}

    def _change_color(self, plan: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
        instance_id, color = operation.get("instance_id"), operation.get("color")
        if not isinstance(color, str) or not _COLOR_RE.match(color):
            return _reject("edit.invalid_color", f"Color {color!r} is not a #RRGGBB value")
        new = copy.deepcopy(plan)
        target = next((c for c in new["components"] if c["instance_id"] == instance_id), None)
        if target is None:
            return _reject("edit.unknown_instance", f"No instance {instance_id!r} in this plan", [str(instance_id)])
        target.setdefault("render_overrides", {})["color"] = color
        return {"accepted": True, "plan": new}
