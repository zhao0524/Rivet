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


# ---- app/client helpers shared by pipeline, edit and route tests -----------------
import time  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from rivet_api.adapters.fixture import FixtureEngineeringAdapter  # noqa: E402
from rivet_api.config import Settings  # noqa: E402
from rivet_api.errors import ApiError  # noqa: E402
from rivet_api.main import create_app  # noqa: E402


class StubEngine:
    """Pretends to be a live engine (no generation_mode attribute) around the saved plan."""

    def __init__(self, mutate_plan=None, edit_result=None):
        self._fx = FixtureEngineeringAdapter()
        self.mutate_plan = mutate_plan
        self.edit_result = edit_result
        self.solve_calls: list[dict] = []
        self.edit_calls: list[tuple] = []

    def solve(self, intent):
        self.solve_calls.append(intent)
        plan = self._fx.solve(intent)
        plan["provenance"]["generation_mode"] = "live"
        if self.mutate_plan:
            self.mutate_plan(plan)
        return plan

    def apply_edit(self, plan, operation):
        self.edit_calls.append((plan, operation))
        if self.edit_result is not None:
            return self.edit_result(plan, operation) if callable(self.edit_result) else self.edit_result
        return self._fx.apply_edit(plan, operation)

    def verify(self, plan):
        return self._fx.verify(plan)

    def get_catalog(self):
        return self._fx.get_catalog()


class FakeAssets:
    def __init__(self, items: dict[str, tuple[bytes, str]] | None = None):
        self.items = items or {}

    def exists(self, asset_id: str) -> bool:
        return asset_id in self.items

    def read_bytes(self, asset_id: str):
        if asset_id not in self.items:
            raise ApiError("ASSET_NOT_FOUND", "No such asset", 404)
        return self.items[asset_id]


@pytest.fixture
def stub_engine_cls():
    return StubEngine


@pytest.fixture
def fake_assets_cls():
    return FakeAssets


@pytest.fixture
def make_client(tmp_path):
    def _make(**kwargs):
        settings = kwargs.pop("settings", None) or Settings(mode="fixture", data_root=tmp_path)
        app = create_app(settings, **kwargs)
        return TestClient(app), app

    return _make


@pytest.fixture
def wait_job():
    def _wait(client: TestClient, job_id: str, timeout: float = 5.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            body = client.get(f"/api/jobs/{job_id}").json()
            if body["status"] in ("complete", "failed"):
                return body
            time.sleep(0.02)
        raise AssertionError(f"job {job_id} did not finish: {body}")

    return _wait


@pytest.fixture
def generate(make_client, wait_job):
    """Run one generate request end to end and return (client, app, job_body)."""

    def _go(body=None, **kwargs):
        client, app = make_client(**kwargs)
        body = body or {"input": {"kind": "text", "user_text": "Build a small rover that avoids obstacles"}}
        resp = client.post("/api/projects/generate", json=body)
        assert resp.status_code == 202, resp.text
        return client, app, wait_job(client, resp.json()["job_id"])

    return _go
