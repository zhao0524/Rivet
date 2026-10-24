"""End-to-end smoke check for the API (the assertions in docs/implementation.md section 8
that belong to lane A).

Runs against a live server (`--base-url`) or in-process (`--in-process`). Every step
reports PASS, SKIP or FAIL; a step that cannot run because an earlier one failed is a SKIP
that says why, never a silent pass. Exit code 1 means at least one FAIL.
"""

import argparse
import csv
import io
import json
import os
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from rivet_api.contract import assert_build_plan_contract
from rivet_api.models.plan import BuildPlan

Status = Literal["PASS", "SKIP", "FAIL"]
POLL_TIMEOUT_S = 60.0


@dataclass
class StepResult:
    name: str
    status: Status
    detail: str
    data: dict[str, Any] = field(default_factory=dict)


class _Skip(Exception):
    pass


class _Runner:
    def __init__(self) -> None:
        self.results: list[StepResult] = []
        self.state: dict[str, Any] = {}

    def step(self, name: str, fn: Callable[[], str], needs: tuple[str, ...] = ()) -> None:
        for dep in needs:
            done = next((r for r in self.results if r.name == dep), None)
            if done is None or done.status != "PASS":
                self.results.append(StepResult(name, "SKIP", f"depends on '{dep}' ({done.status if done else 'not run'})"))
                return
        try:
            self.results.append(StepResult(name, "PASS", fn(), self.state.pop("_data", {})))
        except _Skip as skip:
            self.results.append(StepResult(name, "SKIP", str(skip)))
        except AssertionError as err:
            self.results.append(StepResult(name, "FAIL", str(err) or "assertion failed"))
        except Exception as err:  # connection errors, bad JSON, ...
            self.results.append(StepResult(name, "FAIL", f"{type(err).__name__}: {str(err)[:200]}"))


def _png() -> bytes:
    from PIL import Image

    img = Image.new("RGB", (64, 48))
    img.putdata([(x * 4 % 256, y * 5 % 256, 120) for y in range(48) for x in range(64)])
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _sse_events(client: Any, url: str) -> list[dict]:
    events = []
    with client.stream("GET", url) as resp:
        assert resp.status_code == 200, f"events returned {resp.status_code}"
        body = "".join(resp.iter_text())
    for line in body.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


def run_smoke(client: Any, poll_timeout_s: float = POLL_TIMEOUT_S, poll_interval_s: float = 0.25) -> list[StepResult]:
    r = _Runner()
    s = r.state

    def health() -> str:
        body = client.get("/api/health").json()
        assert body.get("ok") is True, f"health returned {body}"
        return f"mode={body['mode']}"

    def catalog() -> str:
        body = client.get("/api/catalog").json()
        assert body["schema_version"] == "1.0" and body["components"], "catalog is empty"
        s["catalog"] = body["components"]
        return f"{len(body['components'])} components"

    def upload() -> str:
        resp = client.post("/api/assets/images", files={"file": ("smoke.png", _png(), "image/png")})
        assert resp.status_code == 200, f"upload returned {resp.status_code}: {resp.text[:150]}"
        s["asset_id"] = resp.json()["asset_id"]
        return s["asset_id"]

    def generate() -> str:
        resp = client.post(
            "/api/projects/generate",
            json={
                "input": {
                    "kind": "image_and_text",
                    "image_asset_id": s["asset_id"],
                    "user_text": "Build a small rover that avoids obstacles",
                }
            },
        )
        assert resp.status_code == 202, f"generate returned {resp.status_code}: {resp.text[:150]}"
        s["job_id"] = resp.json()["job_id"]
        deadline = time.monotonic() + poll_timeout_s
        job: dict = {}
        while time.monotonic() < deadline:
            job = client.get(f"/api/jobs/{s['job_id']}").json()
            if job["status"] in ("complete", "failed"):
                break
            time.sleep(poll_interval_s)
        else:
            raise AssertionError(f"job still {job.get('status')} after {poll_timeout_s}s")
        if job["status"] == "failed":
            raise AssertionError(f"job failed: {job['error']['code']}: {job['error']['message']}")
        s["build_id"], s["revision"] = job["build_id"], job["revision"]
        return f"{s['job_id']} -> {s['build_id']} r{s['revision']}"

    def events() -> str:
        evs = _sse_events(client, f"/api/jobs/{s['job_id']}/events")
        assert evs, "no events"
        assert [e["event_id"] for e in evs] == list(range(1, len(evs) + 1)), "event ids are not contiguous"
        assert evs[-1]["stage"] == "complete", f"last stage is {evs[-1]['stage']}"
        return f"{len(evs)} events, stages: " + " > ".join(dict.fromkeys(e["stage"] for e in evs))

    def project() -> str:
        plan = client.get(f"/api/projects/{s['build_id']}").json()
        assert plan["schema_version"] == "1.0", f"schema_version {plan['schema_version']!r}"
        assert (plan["build_id"], plan["revision"]) == (s["build_id"], s["revision"]), "ids differ from the job"
        s["plan"] = plan
        mode = plan["provenance"]["generation_mode"]
        s["_data"] = {"generation_mode": mode, "status": plan["status"]}
        return f"status={plan['status']} generation_mode={mode}"

    def contract() -> str:
        assert_build_plan_contract(BuildPlan.model_validate(s["plan"]), s["catalog"])
        return f"{len(s['plan']['components'])} components, all references resolve"

    def bom() -> str:
        plan = s["plan"]
        resp = client.get(f"/api/projects/{s['build_id']}/exports/bom.csv")
        assert resp.status_code == 200, f"bom returned {resp.status_code}"
        rows = list(csv.reader(io.StringIO(resp.text)))
        items = plan["bom"]["items"]
        assert len(rows) == len(items) + 2, f"{len(rows)} rows for {len(items)} items"
        for item, row in zip(items, rows[1:]):
            expected = "" if item["unit_price_amount"] is None else str(item["unit_price_amount"])
            assert row[3] == expected, f"{item['catalog_id']}: price cell {row[3]!r}, plan says {expected!r}"
        assert rows[-1][6] == f"total_status:{plan['bom']['total_status']}", f"total row {rows[-1]}"
        assert resp.headers["x-rivet-generation-mode"] == plan["provenance"]["generation_mode"]
        unpriced = sum(1 for i in items if i["unit_price_amount"] is None)
        return f"{len(items)} rows, {unpriced} unpriced left empty, total_status={plan['bom']['total_status']}"

    def build_json() -> str:
        got = client.get(f"/api/projects/{s['build_id']}/exports/build.json").json()
        assert got == s["plan"], "build.json differs from the stored revision"
        return "matches the stored revision"

    def edit() -> str:
        base = s["revision"]
        resp = client.post(
            f"/api/projects/{s['build_id']}/edits",
            json={
                "base_revision": base,
                "operation": {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 700},
            },
        )
        assert resp.status_code == 200, f"edit returned {resp.status_code}: {resp.text[:150]}"
        body = resp.json()
        revisions = client.get(f"/api/projects/{s['build_id']}/revisions").json()["revisions"]
        if body["accepted"]:
            assert body["revision"] == base + 1, f"revision {body['revision']}"
            assert len(revisions) == base + 1, "revision list did not grow"
            s["edit_accepted"], s["latest"] = True, base + 1
            return f"accepted, revision {base} -> {base + 1}"
        assert body.get("finding"), "rejected edit carried no finding"
        assert len(revisions) == base, "a rejected edit created a revision"
        s["edit_accepted"], s["latest"] = False, base
        return f"rejected by the engine, no new revision: {body['finding'].get('message', '')[:80]}"

    def stale() -> str:
        if not s["edit_accepted"]:
            raise _Skip("the edit was rejected, so there is no newer revision to be stale against")
        resp = client.post(
            f"/api/projects/{s['build_id']}/edits",
            json={
                "base_revision": s["revision"],
                "operation": {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 800},
            },
        )
        assert resp.status_code == 409, f"stale edit returned {resp.status_code}"
        assert resp.json()["error"]["code"] == "STALE_REVISION"
        return "409 STALE_REVISION"

    def firmware() -> str:
        latest = s["latest"]
        resp = client.get(f"/api/projects/{s['build_id']}/exports/firmware.zip?revision={latest}")
        if resp.status_code == 422:
            code = resp.json()["error"]["code"]
            raise _Skip(f"{code}: {resp.json()['error']['message'][:100]}")
        assert resp.status_code == 200, f"firmware returned {resp.status_code}"
        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            manifest = json.loads(z.read("manifest.json"))
        assert (manifest["build_id"], manifest["revision"]) == (s["build_id"], latest), "manifest ids differ"
        return f"manifest matches r{latest}, compile_status={resp.headers['x-rivet-compile-status']}"

    def estelle() -> str:
        body = client.get("/api/estelle/status").json()
        return f"enabled={body['enabled']} available={body['available']}"

    r.step("health", health)
    r.step("catalog", catalog, ("health",))
    r.step("upload image", upload, ("health",))
    r.step("generate job", generate, ("upload image",))
    r.step("job events", events, ("generate job",))
    r.step("project", project, ("generate job",))
    r.step("contract", contract, ("project", "catalog"))
    r.step("bom csv", bom, ("project",))
    r.step("build.json", build_json, ("project",))
    r.step("edit", edit, ("project",))
    r.step("stale edit", stale, ("edit",))
    r.step("firmware", firmware, ("edit",))
    r.step("estelle", estelle, ("health",))
    return r.results


def mode_note(mode: str | None) -> str | None:
    """Say plainly how far from a live result a run was; None when it was fully live."""
    if mode == "fixture":
        return "NOTE: SAVED DEMO BUILD (generation_mode=fixture); this was not a live engineering result."
    if mode == "fallback":
        return (
            "NOTE: generation_mode=fallback; part of this result was not live "
            "(a saved fixture because the engine was unavailable, or an offline vision stand-in)."
        )
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Smoke test for the Rivet API")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--in-process", action="store_true", help="start the app in this process")
    args = parser.parse_args(argv)

    if args.in_process:
        from fastapi.testclient import TestClient

        from rivet_api.config import Settings
        from rivet_api.main import create_app

        settings = Settings.from_env()
        if "RIVET_DATA_ROOT" not in os.environ:  # keep smoke data out of the real data dir
            settings = settings.model_copy(update={"data_root": Path(tempfile.mkdtemp(prefix="rivet-smoke-"))})
        client = TestClient(create_app(settings))
    else:
        import httpx

        client = httpx.Client(base_url=args.base_url, timeout=30.0)

    results = run_smoke(client)
    for res in results:
        print(f"[{res.status}] {res.name}: {res.detail}")
    counts = {s: sum(1 for x in results if x.status == s) for s in ("PASS", "SKIP", "FAIL")}
    print(f"\n{counts['PASS']} passed, {counts['SKIP']} skipped, {counts['FAIL']} failed")
    mode = next((x.data.get("generation_mode") for x in results if x.name == "project"), None)
    note = mode_note(mode)
    if note:
        print(note)
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
