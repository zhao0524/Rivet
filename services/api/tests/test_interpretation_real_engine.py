"""Issue #66 against lane B's real rivet_engine (skipped when it is not installed)."""

import json
import time

import pytest

pytest.importorskip("rivet_engine")

from rivet_api.adapters.engineering import RealEngineeringAdapter  # noqa: E402
from rivet_api.config import Settings  # noqa: E402
from rivet_api.orchestration.interpretation import CLOSEST_ROVER_NOTE  # noqa: E402

DRONE = {"input": {"kind": "text", "user_text": "Design a racing drone that flies"}}
ROVER = {"input": {"kind": "text", "user_text": "Build a small rover that avoids obstacles"}}


@pytest.fixture
def client(make_client, tmp_path):
    settings = Settings(mode="live", data_root=tmp_path, allow_fallback=False)
    return make_client(settings=settings, engine=RealEngineeringAdapter())[0]


def run(client, body) -> dict:
    resp = client.post("/api/projects/generate", json=body)
    assert resp.status_code == 202, resp.text
    for _ in range(500):
        job = client.get(f"/api/jobs/{resp.json()['job_id']}").json()
        if job["status"] in ("complete", "failed"):
            return job
        time.sleep(0.02)
    raise AssertionError(job)


def test_real_engine_builds_the_closest_rover_and_keeps_the_choice_through_an_edit(client):
    seen = client.post("/api/intents/interpret", json=DRONE).json()
    assert seen["supported"] is False
    job = run(client, {**DRONE, "intent_id": seen["intent_id"], "interpretation_choice": "closest_supported_rover"})
    assert job["status"] == "complete", job
    plan = client.get(f"/api/projects/{job['build_id']}").json()
    assert plan["project_family"] == "rover" and plan["source_intent_id"] == seen["intent_id"]
    assert sum(n.startswith(CLOSEST_ROVER_NOTE) for n in plan["provenance"]["notes"]) == 1

    edit = client.post(
        f"/api/projects/{job['build_id']}/edits",
        json={"base_revision": 1, "operation": {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 700}},
    )
    assert edit.json()["accepted"] is True, json.dumps(edit.json())
    edited = client.get(f"/api/projects/{job['build_id']}?revision=2").json()
    assert sum(n.startswith(CLOSEST_ROVER_NOTE) for n in edited["provenance"]["notes"]) == 1
    assert edited["provenance"]["generation_mode"] == plan["provenance"]["generation_mode"] == "fallback"
    assert "Intent came from the fixture vision provider, not a live model" in edited["provenance"]["notes"]


def test_real_engine_builds_a_confirmed_interpretation(client):
    seen = client.post("/api/intents/interpret", json=ROVER).json()
    assert seen["supported"] is True
    job = run(client, {**ROVER, "intent_id": seen["intent_id"]})
    assert job["status"] == "complete", job
    assert client.get(f"/api/projects/{job['build_id']}").json()["source_intent_id"] == seen["intent_id"]


def test_supplier_checks_are_read_only_metadata_not_stored_plan_fields(client):
    job = run(client, ROVER)
    assert job['status'] == 'complete'
    url = f"/api/projects/{job['build_id']}"
    served = client.get(url).json()
    checks = served['provenance']['sourcing']['link_checks']
    assert set(checks) == {row['catalog_id'] for row in served['bom']['items']}
    assert all(c['status'] in {'pass', 'broken', 'blocked', 'error', 'unchecked'} for c in checks.values())
    exported = client.get(url + '/exports/build.json').json()
    assert 'sourcing' not in exported['provenance']
    assert exported['revision'] == served['revision'] == 1
    assert exported['verification'] == served['verification']
