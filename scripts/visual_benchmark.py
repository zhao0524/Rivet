#!/usr/bin/env python
"""Fresh, uncached end-to-end visual benchmark of the v2 geometry-first pipeline.

    RIVET_3D_MODE=live RIVET_IMAGE_PROVIDER=openai OPENAI_API_KEY=... \\
      services/api/.venv/bin/python scripts/visual_benchmark.py --out bench/<run> [--photo ref.jpg] [--cases photo_object,animal]

Runs six cases (an uploaded photograph, a futuristic vehicle, an organic animal, an articulated
mechanical object, a curved enclosure and an asymmetric object with surface details) through the
real HTTP API with caching disabled, then one natural-language revision per case. For every case it
saves the original reference(s), the three candidates (DesignSpec, GLB, six renders, visual review,
mechanical report, revision history), the selected final output and its exports, the generation
trace (every provider call with how many images it carried) and a contact sheet. summary.json and
README.md report scores, whether the visual target was met, geometry digests and provider evidence.
Without RIVET_3D_MODE=live it runs the labelled offline author, which is useful for checking the
harness but is not evidence of visual quality.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from rivet_api.config import Settings  # noqa: E402
from rivet_api.main import create_app  # noqa: E402

CASES = [
    {"id": "photo_object", "title": "Unfamiliar object from a photograph", "text": "",
     "revise": "Make the handle longer and add a visible seam line around the middle of the body"},
    {"id": "future_vehicle", "title": "Distinctive futuristic vehicle",
     "text": "A futuristic single-seat hover racer: long tapered nose, a bubble canopy set back, one large air intake only on the left flank, "
             "twin rear thruster nozzles, a tall swept tail fin and three retractable landing skids",
     "revise": "Lengthen the nose by a third and add a second, smaller fin on the right side of the tail"},
    {"id": "animal", "title": "Organic animal-shaped design",
     "text": "A stylised sitting fox figurine: plump body, raised narrow snout, two tall pointed ears, a bushy tail curling round the front paws, "
             "and a flat base under the haunches",
     "revise": "Make the ears larger and tilt the head to the left"},
    {"id": "articulated", "title": "Articulated mechanical object",
     "text": "An articulated desk lamp: heavy round base, a lower arm and an upper arm joined by a knuckle hinge, a hinged conical shade "
             "with a visible bulb opening and a toggle switch on the base",
     "revise": "Bend the upper arm forward by 30 degrees and widen the shade"},
    {"id": "enclosure", "title": "Complex curved enclosure",
     "text": "A handheld game console enclosure: a curved wraparound shell with sculpted grips at both ends, a recessed screen bezel, "
             "two shoulder buttons on the top edge, a round direction pad on the left, four face buttons on the right and a row of vent slots on the back",
     "revise": "Add a kickstand on the back and make the grips thicker"},
    {"id": "asymmetric", "title": "Asymmetric object with recognisable surface details",
     "text": "A compact rangefinder-style camera: boxy body with a lens barrel offset to the right, a textured rubber grip only on the left, "
             "a large knurled dial and a hot shoe on top, a viewfinder window at the top left and a port door on the right side",
     "revise": "Move the dial to the left of the hot shoe and add a second smaller dial on the right"},
]
VIEWS = ("front", "left", "back", "right", "top", "perspective")


def wait(c: TestClient, job_id: str, timeout: float) -> dict:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        job = c.get(f"/api/v2/generations/{job_id}").json()
        if job["status"] in ("complete", "failed", "cancelled", "budget_exhausted"):
            return job
        time.sleep(1.0)
    raise TimeoutError(f"job {job_id} did not finish in {timeout}s")


def events(c: TestClient, job_id: str) -> list[dict]:
    text = c.get(f"/api/v2/generations/{job_id}/events").text
    return [json.loads(line[5:]) for line in text.splitlines() if line.startswith("data:")]


def fetch(c: TestClient, url: str) -> bytes:
    r = c.get(url)
    r.raise_for_status()
    return r.content


def save(path: Path, data: bytes | str | dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(path, Path) and isinstance(data, (dict, list)):
        path.write_text(json.dumps(data, indent=1, sort_keys=True, default=str))
    elif isinstance(data, str):
        path.write_text(data)
    else:
        path.write_bytes(data)


def photo_reference(args) -> tuple[bytes, str, str]:
    """The photograph case: a real file when given, otherwise a photo-style image generated by the
    configured image model (labelled as such; it is not a real photograph)."""
    if args.photo:
        data = Path(args.photo).read_bytes()
        mime = "image/jpeg" if data[:3] == b"\xff\xd8\xff" else "image/png"
        return data, mime, f"photograph supplied by --photo ({Path(args.photo).name})"
    if os.environ.get("RIVET_3D_MODE") == "live" and os.environ.get("OPENAI_API_KEY"):
        import base64

        import openai

        client = openai.OpenAI()
        prompt = ("A sharp product photograph on a plain light background of an unusual hand-cranked kitchen gadget: a squat octagonal hopper "
                  "with a side crank handle, a tilted spout on one side only, three splayed legs and a knurled adjustment ring. Photo-realistic, "
                  "three-quarter view, soft studio light, no text.")
        res = client.images.generate(model=os.environ.get("RIVET_IMAGE_MODEL", "gpt-image-1"), prompt=prompt, size="1024x1024", quality="medium")
        return base64.b64decode(res.data[0].b64_json), "image/png", "photo-style image generated by the image model for the benchmark (no real photograph was supplied)"
    img = Image.new("RGB", (640, 480), (236, 236, 236))
    d = ImageDraw.Draw(img)
    d.polygon([(200, 120), (440, 120), (480, 300), (160, 300)], fill=(120, 90, 60))
    d.rectangle((300, 60, 330, 120), fill=(60, 60, 60))
    d.ellipse((440, 80, 560, 200), fill=(60, 60, 60))
    for x in (190, 320, 450):
        d.rectangle((x, 300, x + 24, 400), fill=(90, 90, 90))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue(), "image/png", "synthetic drawing (offline run; not a photograph)"


def contact_sheet(reference: bytes | None, shots: dict[str, bytes], path: Path, label: str) -> None:
    tiles = ([("reference", reference)] if reference else []) + [(v, shots[v]) for v in VIEWS if v in shots]
    if not tiles:
        return
    size = 256
    sheet = Image.new("RGB", (size * len(tiles), size + 24), (20, 22, 26))
    d = ImageDraw.Draw(sheet)
    for i, (name, data) in enumerate(tiles):
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((size, size))
        sheet.paste(img, (i * size + (size - img.width) // 2, 24 + (size - img.height) // 2))
        d.text((i * size + 6, 6), name, fill=(230, 230, 230))
    d.text((6, size + 8), label[:200], fill=(180, 180, 180))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def save_candidate(c: TestClient, cand: dict, out: Path) -> dict:
    save(out / "candidate.json", cand)
    if cand["status"] != "complete":
        return {"id": cand["id"], "strategy": cand["strategy"], "status": "failed", "error": cand.get("error")}
    save(out / "spec.json", cand["spec"])
    save(out / "scene.glb", fetch(c, cand["scene_asset_url"]))
    shots = {}
    for s in cand["shots"]:
        shots[s["view"]] = fetch(c, s["image_url"])
        save(out / f"shot_{s['view']}.png", shots[s["view"]])
    save(out / "visual_review.json", cand["visual"])
    save(out / "mechanical.json", cand["mechanical"])
    save(out / "revision_history.json", cand.get("iterations", []))
    return {"id": cand["id"], "strategy": cand["strategy"], "status": "complete", "feasible": cand["feasible"], "visual_overall": cand["visual"]["overall"],
            "visual_scores": cand["visual"]["scores"], "critical_issues": sum(i["severity"] == "critical" for i in cand["visual"]["issues"]),
            "judge": cand["visual"]["judge_model"], "geometry_digest": cand["geometry_digest"], "bodies": len([p for p in cand["part_manifest"] if p["status"] == "placed"]),
            "shape_types": sorted({b["shape"]["type"] for b in cand["spec"]["bodies"] if b.get("shape")}),
            "mechanical_status": cand["mechanical"]["status"], "hard_collisions": cand["mechanical"]["counts"]["hard_collisions"],
            "revisions": [{k: v for k, v in it.items() if k != "patch"} for it in cand.get("iterations", [])], "_shots": shots}


def run_case(c: TestClient, case: dict, out: Path, args, image: tuple[bytes, str, str] | None) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    asset_id = None
    if image:
        data, mime, origin = image
        r = c.post("/api/v2/assets/images", files={"file": ("reference" + (".jpg" if mime == "image/jpeg" else ".png"), data, mime)})
        r.raise_for_status()
        asset_id = r.json()["asset_id"]
        save(out / ("original_reference" + (".jpg" if mime == "image/jpeg" else ".png")), data)
        save(out / "original_reference.json", {"origin": origin, "asset_id": asset_id, "sha256": r.json()["sha256"]})
    body = {"input": {"user_text": case["text"], "image_asset_id": asset_id}, "mode": args.mode, "quality": "full", "candidate_count": 3,
            "review_rounds": args.rounds, "visual_target": args.target, "allow_cached": False, "generation_budget_usd": args.case_budget, "constraints": {}}
    save(out / "request.json", body)
    r = c.post("/api/v2/generations", json=body)
    if r.status_code != 202:
        return {"case": case["id"], "title": case["title"], "status": "rejected", "error": r.text[:500]}
    job = wait(c, r.json()["job_id"], args.timeout)
    save(out / "job.json", job)
    evs = events(c, job["job_id"])
    save(out / "events.jsonl", "\n".join(json.dumps(e, sort_keys=True) for e in evs))
    if job["status"] != "complete":
        return {"case": case["id"], "title": case["title"], "status": job["status"], "error": job.get("error"), "seconds": round(time.monotonic() - started, 1)}
    bundle = c.get(f"/api/v2/projects/{job['build_id']}/design").json()
    save(out / "bundle.json", bundle)
    trace = json.loads(fetch(c, bundle["generation_trace_url"]))
    save(out / "trace.json", trace)
    refs = {}
    for ref in bundle["references"]:
        refs[ref["view"]] = fetch(c, ref["image_url"])
        save(out / f"reference_{ref['view']}_{ref['source']}.png", refs[ref["view"]])
    cands = [save_candidate(c, cand, out / cand["id"]) for cand in bundle["candidates"]]
    chosen = next((x for x in cands if x["id"] == bundle["selected_candidate_id"]), None)
    reference_png = refs.get("perspective") or next(iter(refs.values()), None)
    for cand in cands:
        if cand["status"] == "complete":
            contact_sheet(reference_png, cand.pop("_shots"), out / cand["id"] / "contact_sheet.png",
                          f"{case['id']} {cand['id']} {cand['strategy']} visual {cand['visual_overall']}/10 ({cand['judge']}) feasible={cand['feasible']}")
    final = {}
    if chosen:
        for kind in ("glb", "bom", "manifest", "assembly_steps"):
            r = c.get(f"/api/v2/projects/{bundle['build_id']}/export", params={"kind": kind})
            if r.status_code == 200:
                ext = {"glb": "glb"}.get(kind, "json")
                save(out / "final" / f"{kind}.{ext}", r.content)
                final[kind] = r.status_code
            else:
                final[kind] = r.status_code
    calls = trace.get("calls", [])
    provider_evidence = {"calls": len(calls), "calls_with_images": sum(1 for k in calls if (k.get("images") or 0) > 0),
                         "images_sent": sum(int(k.get("images") or 0) for k in calls), "kinds": sorted({k.get("kind") for k in calls})}
    # One natural-language revision through the normal revise route.
    revision = {"instruction": case["revise"]}
    r = c.post(f"/api/v2/projects/{bundle['build_id']}/revise", json={"base_revision": bundle["revision"], "instruction": case["revise"], "selected_body_ids": []})
    if r.status_code == 202:
        rjob = wait(c, r.json()["job_id"], args.timeout)
        revision["job_status"] = rjob["status"]
        revision["events"] = [e["message"] for e in events(c, rjob["job_id"]) if e["stage"] in ("revision_ready", "complete", "failed")]
        after = c.get(f"/api/v2/projects/{bundle['build_id']}/design").json()
        save(out / "revision" / "bundle.json", after)
        new_chosen = next((x for x in after["candidates"] if x["id"] == after["selected_candidate_id"]), None)
        if new_chosen and new_chosen["status"] == "complete":
            summary = save_candidate(c, new_chosen, out / "revision" / new_chosen["id"])
            contact_sheet(reference_png, summary.pop("_shots"), out / "revision" / "contact_sheet.png",
                          f"{case['id']} after revision: {case['revise'][:80]}")
            revision.update(accepted=after["revision"] > bundle["revision"], revision_before=bundle["revision"], revision_after=after["revision"],
                            geometry_digest_before=chosen["geometry_digest"] if chosen else None, geometry_digest_after=summary["geometry_digest"],
                            changed_bodies=after.get("change", {}).get("changed_bodies"), visual_after=summary["visual_overall"])
    else:
        revision["job_status"] = f"rejected {r.status_code}: {r.text[:200]}"
    row = {"case": case["id"], "title": case["title"], "status": bundle["status"], "generation_mode": bundle["provenance"]["generation_mode"],
           "renderer": bundle["model_versions"].get("renderer"), "design_model": bundle["model_versions"].get("design_model"), "image_model": bundle["model_versions"].get("image_model"),
           "selected": bundle["selected_candidate_id"], "visual_quality": bundle["visual_quality"], "candidates": cands, "final_exports": final,
           "provider_evidence": provider_evidence, "spent_usd": bundle["budget"]["spent_usd"], "revision": revision, "limitations": bundle["provenance"]["limitations"],
           "seconds": round(time.monotonic() - started, 1), "build_id": bundle["build_id"]}
    save(out / "summary.json", row)
    return row


def write_readme(rows: list[dict], out: Path, settings: Settings) -> None:
    lines = [f"# Visual benchmark ({'live' if settings.design_mode == 'live' else 'fixture'} providers, renderer {settings.renderer})", "",
             "Fresh, uncached runs through the real API. Visual scores are subjective judgements of rendered geometry against the references; "
             "they never count toward mechanical or electrical verification.", "",
             "| Case | Status | Candidates (strategy: score, feasible, bodies) | Selected | Visual target | Calls with images | Revision | Spent (est. USD) |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r.get("status") in ("rejected", "failed", "cancelled", "budget_exhausted"):
            lines.append(f"| {r['case']} | {r['status']} | {str(r.get('error'))[:120]} | | | | | |")
            continue
        cands = "<br>".join(f"{c['strategy']}: {c['visual_overall']}/10, {'feasible' if c['feasible'] else 'not feasible'}, {c['bodies']} bodies" if c["status"] == "complete"
                            else f"{c['strategy']}: failed" for c in r["candidates"])
        vq = r["visual_quality"]
        rev = r["revision"]
        rev_text = (f"{'kept' if rev.get('accepted') else 'rejected/unchanged'}; geometry {'changed' if rev.get('geometry_digest_before') != rev.get('geometry_digest_after') else 'unchanged'}"
                    if "accepted" in rev else str(rev.get("job_status")))
        lines.append(f"| {r['case']} | {r['status']} | {cands} | {r['selected']} | {'met' if vq['achieved'] else 'NOT met'} ({vq['score']}/{vq['target']}, {vq['refinement_rounds']} rounds) | "
                     f"{r['provider_evidence']['calls_with_images']}/{r['provider_evidence']['calls']} ({r['provider_evidence']['images_sent']} images) | {rev_text} | {r['spent_usd']:.2f} |")
    digests = [c["geometry_digest"] for r in rows if r.get("candidates") for c in r["candidates"] if c["status"] == "complete"]
    lines += ["", f"Distinct geometry digests across all completed candidates: {len(set(digests))}/{len(digests)}.", "",
              "Per case: `original_reference.*`, `reference_<view>_<source>.png`, `cand-N/{spec.json,scene.glb,shot_<view>.png,visual_review.json,mechanical.json,revision_history.json,contact_sheet.png}`, "
              "`final/` exports of the selected candidate, `revision/` after the natural-language edit, `trace.json` (provider calls with image counts), `events.jsonl`, `bundle.json`."]
    (out / "README.md").write_text("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--cases", default=",".join(c["id"] for c in CASES))
    ap.add_argument("--photo", default=None, help="a real photograph for the photo_object case")
    ap.add_argument("--mode", default="concept_only", choices=["concept_only", "engineered"])
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--target", type=float, default=8.0)
    ap.add_argument("--case-budget", type=float, default=6.0)
    ap.add_argument("--total-budget", type=float, default=30.0)
    ap.add_argument("--timeout", type=float, default=2400)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("RIVET_DATA_ROOT", str(args.out / "data"))
    settings = Settings.from_env()
    app = create_app(settings)
    c = TestClient(app)
    c.get("/api/v2/session").raise_for_status()
    wanted = [x for x in CASES if x["id"] in set(args.cases.split(","))]
    rows: list[dict] = []
    spent = 0.0
    photo = photo_reference(args) if any(x["id"] == "photo_object" for x in wanted) else None
    for case in wanted:
        if spent >= args.total_budget:
            rows.append({"case": case["id"], "title": case["title"], "status": "rejected", "error": f"total benchmark budget {args.total_budget} USD reached"})
            continue
        print(f"== {case['id']}: {case['title']}", flush=True)
        try:
            row = run_case(c, case, args.out / case["id"], args, photo if case["id"] == "photo_object" else None)
        except Exception as exc:  # noqa: BLE001 - the benchmark records failures instead of dying
            row = {"case": case["id"], "title": case["title"], "status": "failed", "error": f"{type(exc).__name__}: {exc}"[:500]}
        spent += float(row.get("spent_usd") or 0.0)
        rows.append(row)
        print(json.dumps({k: v for k, v in row.items() if k in ("case", "status", "visual_quality", "spent_usd", "seconds", "error")}, default=str), flush=True)
    save(args.out / "summary.json", {"settings": {"design_mode": settings.design_mode, "renderer": settings.renderer, "design_model": settings.design_model or "default",
                                                   "image_provider": settings.image_provider, "image_model": settings.image_model, "visual_target": args.target, "review_rounds": args.rounds},
                                      "cases": rows, "total_spent_usd": round(spent, 2)})
    write_readme(rows, args.out, settings)
    print(f"wrote {args.out}/README.md; estimated spend {spent:.2f} USD")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
