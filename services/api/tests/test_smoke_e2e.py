import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from rivet_api.config import Settings
from rivet_api.main import create_app
from rivet_api.smoke import run_smoke

README = Path(__file__).parents[1] / "README.md"

EXPECTED_STEPS = [
    "health",
    "catalog",
    "upload image",
    "generate job",
    "job events",
    "project",
    "contract",
    "bom csv",
    "build.json",
    "edit",
    "stale edit",
    "firmware",
    "estelle",
]


def by_name(results):
    return {r.name: r for r in results}


def test_e2e_fixture_flow(make_client):
    client, _ = make_client()
    results = run_smoke(client, poll_interval_s=0.02)
    assert [r.name for r in results] == EXPECTED_STEPS
    failed = [r for r in results if r.status == "FAIL"]
    assert not failed, failed
    steps = by_name(results)
    assert "fixture" in steps["project"].detail  # the saved build is labeled, not passed off as live
    assert steps["edit"].status == "PASS" and steps["stale edit"].status == "PASS"
    # the saved fixture has no pin map, so firmware is an honest skip rather than a pass
    assert steps["firmware"].status == "SKIP" and "FIRMWARE_NOT_SUPPORTED" in steps["firmware"].detail
    assert steps["estelle"].status == "PASS" and "enabled=False" in steps["estelle"].detail


def test_smoke_firmware_passes_when_the_plan_has_a_pin_map(make_client, stub_engine_cls):
    from rivet_api.firmware.generate import FIRMWARE_SIGNALS

    def pins(plan):
        plan["firmware"]["pin_map"] = dict(zip(FIRMWARE_SIGNALS, range(16, 25)))

    client, _ = make_client(engine=stub_engine_cls(mutate_plan=pins))
    steps = by_name(run_smoke(client, poll_interval_s=0.02))
    assert steps["firmware"].status == "PASS" and "not_checked" in steps["firmware"].detail


def test_smoke_reports_failure_instead_of_hiding_it(make_client, stub_engine_cls):
    def drop_driver(plan):
        plan["components"] = [c for c in plan["components"] if c["instance_id"] != "driver-1"]

    client, _ = make_client(engine=stub_engine_cls(mutate_plan=drop_driver))
    steps = by_name(run_smoke(client, poll_interval_s=0.02))
    assert steps["generate job"].status == "FAIL" and "ENGINE_CONTRACT_VIOLATION" in steps["generate job"].detail
    # later steps depend on a project, so they are skipped, not silently passed
    assert steps["project"].status == "SKIP" and "generate job" in steps["project"].detail
    assert steps["health"].status == "PASS"


def test_smoke_survives_a_server_that_is_down():
    class Dead:
        def __getattr__(self, name):
            raise ConnectionError("down")

    results = run_smoke(Dead(), poll_interval_s=0.01)
    assert results[0].name == "health" and results[0].status == "FAIL"
    assert all(r.status in ("FAIL", "SKIP") for r in results)


def test_smoke_cli_in_process_exits_zero(capsys, tmp_path, monkeypatch):
    from rivet_api.smoke import main

    monkeypatch.setenv("RIVET_DATA_ROOT", str(tmp_path))
    assert main(["--in-process"]) == 0
    out = capsys.readouterr().out
    assert "PASS" in out and "SAVED DEMO BUILD" in out


# ---- README stays in sync with the real API --------------------------------------------------


def api_paths():
    # app.routes hides included routers in newer FastAPI; the OpenAPI schema is reliable.
    app = create_app(Settings(mode="fixture"))
    return sorted(p for p in app.openapi()["paths"] if p.startswith("/api"))


def test_route_discovery_is_not_vacuous():
    paths = api_paths()
    assert len(paths) >= 15 and "/api/health" in paths and "/api/estelle/ground" in paths


def test_readme_exists_and_documents_every_route():
    text = README.read_text()
    missing = [p for p in api_paths() if p not in text]
    assert not missing, f"README.md does not mention: {missing}"


def test_readme_documents_every_environment_variable():
    text = README.read_text()
    config = (Path(__file__).parents[1] / "rivet_api" / "config.py").read_text()
    used = set(re.findall(r'"(RIVET_[A-Z_]+)"', config)) | set(re.findall(r'_flag\("(RIVET_[A-Z_]+)"', config))
    used.add("OPENAI_API_KEY")
    missing = sorted(v for v in used if v not in text)
    assert not missing, f"README.md does not mention: {missing}"


def test_readme_is_honest_about_what_was_never_run():
    text = README.read_text().lower()
    for phrase in ("not been run", "platformio", "estelle", "pin_map"):
        assert phrase in text, phrase


def test_mode_note_never_calls_a_fallback_a_saved_build():
    from rivet_api.smoke import mode_note

    assert "SAVED DEMO BUILD" in mode_note("fixture")
    fallback = mode_note("fallback")
    assert "fallback" in fallback and "SAVED DEMO BUILD" not in fallback
    assert mode_note("live") is None and mode_note(None) is None
