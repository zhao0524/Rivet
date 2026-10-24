"""The packaged fixtures under rivet_api/data are mirrors of the shared repo `fixtures/`.

They stay so the service runs from an install outside the monorepo; inside the repo the
adapter and mock vision provider read the shared files, and these tests keep the mirrors exact.
"""

import json
from pathlib import Path

import pytest

from rivet_api.adapters import fixture as fixture_adapter
from rivet_api.agents import vision

API_ROOT = Path(__file__).resolve().parents[1]
SHARED = API_ROOT.parents[1] / "fixtures"
PACKAGED = API_ROOT / "rivet_api" / "data" / "fixtures"
MIRRORED = ("intent/rover_obstacle_v1.json", "plans/rover_obstacle_v1.json", "catalog/seed-components.json")


@pytest.mark.parametrize("relative", MIRRORED)
def test_packaged_mirror_matches_shared_fixture(relative):
    assert json.loads((PACKAGED / relative).read_text()) == json.loads((SHARED / relative).read_text())


def test_fixture_adapter_reads_shared_fixtures():
    assert fixture_adapter._fixture_root("rover_obstacle_v1") == SHARED


def test_mock_vision_reads_shared_intent():
    assert vision._intent_fixture() == SHARED / "intent" / "rover_obstacle_v1.json"


def test_shared_failing_driver_fixture_is_served_and_not_verified():
    plan = fixture_adapter.FixtureEngineeringAdapter(fixture_name="rover_failing_driver_v1").solve({"intent_id": "intent-rover-001"})
    assert plan["status"] != "verified"
    current = [f for f in plan["verification"]["findings"] if f["rule_id"] == "electrical.motor_driver_current"]
    assert current and all(f["result"] in ("FAIL", "UNKNOWN") and f["severity"] == "blocking" for f in current)
