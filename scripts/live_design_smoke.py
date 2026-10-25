"""Opt-in live-provider smoke for v2 generation (paid calls; never run in CI).

    services/api/.venv/bin/python scripts/live_design_smoke.py "a red desk lamp" [--images] [--mode engineered]

Reads OPENAI_API_KEY from the environment or the repo .env/.env.local (the value is never
printed), runs one full-quality job in-process with RIVET_3D_MODE=live and a 3 USD budget,
and prints stages, candidates, provider calls and timings. Renders go to /tmp/rivet-live/.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "services" / "api"), str(ROOT / "packages" / "engineering")]


def load_key() -> None:
    for name in (".env.local", ".env"):
        path = ROOT / name
        if os.environ.get("OPENAI_API_KEY") or not path.exists():
            continue
        for line in path.read_text(errors="ignore").splitlines():
            if line.startswith("OPENAI_API_KEY="):
                os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip().strip("'\"")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt")
    ap.add_argument("--images", action="store_true")
    ap.add_argument("--mode", default="concept_only", choices=["concept_only", "engineered"])
    ap.add_argument("--model", default=os.environ.get("RIVET_DESIGN_MODEL") or "gpt-4o")
    args = ap.parse_args()
    load_key()
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set; live smoke skipped")
        return 2
    os.environ.update(RIVET_3D_MODE="live", RIVET_DESIGN_MODEL=args.model, RIVET_IMAGE_PROVIDER="openai" if args.images else "none")
    from fastapi.testclient import TestClient

    from rivet_api.config import Settings
    from rivet_api.main import create_app

    data = Path(tempfile.mkdtemp(prefix="rivet-live-"))
    settings = Settings.from_env().model_copy(update={"data_root": data, "mode": "fixture", "vision_provider": "mock"})
    client = TestClient(create_app(settings))
    client.get("/api/v2/session")
    t0 = time.monotonic()
    job = client.post("/api/v2/generations", json={"input": {"user_text": args.prompt, "image_asset_id": None}, "mode": args.mode, "generation_budget_usd": 3}).json()
    while True:
        status = client.get(f"/api/v2/generations/{job['job_id']}").json()
        if status["status"] in ("complete", "failed", "cancelled", "budget_exhausted"):
            break
        time.sleep(2)
    elapsed = round(time.monotonic() - t0, 1)
    text = client.get(f"/api/v2/generations/{job['job_id']}/events").text
    events = [json.loads(line[5:]) for line in text.splitlines() if line.startswith("data:")]
    print(json.dumps({"status": status["status"], "error": status.get("error"), "seconds": elapsed, "model": args.model, "images": args.images}, indent=1))
    for e in events:
        if e["stage"] not in ("body_ready",):
            print(f"  [{e['event_id']:3d}] {e['stage']:<18} {e['status']:<8} {e['message'][:150]}")
    if status["status"] != "complete":
        return 1
    bundle = client.get(f"/api/v2/projects/{status['build_id']}/design").json()
    out = Path("/tmp/rivet-live")
    out.mkdir(exist_ok=True)
    for c in bundle["candidates"]:
        print(f"  {c['id']} {c['strategy']:<22} {c['status']:<9} digest={str(c.get('geometry_digest'))[:12]} feasible={c.get('feasible')} "
              f"visual={(c.get('visual') or {}).get('overall')} buildability={(c.get('claims') or {}).get('buildability')} bodies={len(c.get('part_manifest', []))}")
        for s in c.get("shots", []):
            if s["view"] == "perspective":
                (out / f"{c['id']}-perspective.png").write_bytes(client.get(s["image_url"]).content)
    for r in bundle["references"]:
        (out / f"reference-{r['view']}.png").write_bytes(client.get(r["image_url"]).content)
    print(json.dumps({"selected": bundle["selected_candidate_id"], "spent_usd_estimate": bundle["budget"]["spent_usd"], "providers": bundle["provenance"]["providers"],
                      "generation_mode": bundle["provenance"]["generation_mode"], "view_consistency": bundle["provenance"]["view_consistency"]}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
