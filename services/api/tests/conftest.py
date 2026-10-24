import copy
import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture
def intent_dict() -> dict:
    return _load("intent_rover_obstacle_v1.json")


@pytest.fixture
def plan_dict() -> dict:
    return copy.deepcopy(_load("plan_rover_obstacle_v1.json"))


@pytest.fixture
def catalog() -> list[dict]:
    return copy.deepcopy(_load("seed-components.json"))
