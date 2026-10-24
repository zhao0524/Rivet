"""v2 generation state machine: intake -> distill -> concept -> multiview -> candidates ->
compile (streamed previews) -> mechanical -> engineering -> repair -> render -> review ->
selection -> refinement -> exports -> persist. Every stage writes durable events and
content-addressed assets; a live job never falls back to fixture output."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from rivet_engine import engineering_bridge
from rivet_engine.design_compiler import DesignValidationError, compile_design, kernel_versions
from rivet_engine.design_ir import apply_patch, changed_bodies, spec_digest, topology_signature
from rivet_engine.geometry.repair import issue_score, repair

from rivet_api.errors import ApiError

from . import critic, procedural, render
from .artifacts import DesignStore, digest, now
from .models import DistilledIntent
from .providers import CONCEPT_PROMPT, VIEW_PROMPT, CallLedger, ESTIMATED_USD

STRATEGIES = ("closest_to_reference", "simpler_manufacture", "signature_geometry")
KERNEL_LOCK = threading.Lock()  # one geometry compile at a time per process (OCCT safety)
MIME = {".glb": "model/gltf-binary", ".step": "model/step", ".stl": "model/stl", ".png": "image/png", ".json": "application/json"}


class Cancelled(Exception):
    pass


class BudgetExhausted(Exception):
    pass


@dataclass
class DesignServices:
    store: DesignStore
    mode: str  # live | fixture
    provider_factory: Callable[[CallLedger], tuple[Any, Any]]
    catalog: list[dict]
    work_root: Path
    web_root: Path
    renderer: str = "raster"
    cancels: dict[str, threading.Event] = field(default_factory=dict)

    def catalog_digest(self) -> str:
        return digest(sorted((c["catalog_id"], c["physical"]["dimensions_mm"], (c.get("sourcing") or {}).get("price_amount")) for c in self.catalog))


def cache_key(svc: DesignServices, request: dict, image_sha: str | None, provider_names: dict) -> str:
    return digest({"prompt": " ".join(request["input"]["user_text"].lower().split()), "image": image_sha, "mode": request["mode"], "quality": request["quality"],
                   "candidates": request["candidate_count"], "rounds": request["review_rounds"], "constraints": request.get("constraints") or {},
                   "catalog": svc.catalog_digest(), "schema": "2.0", "kernel": kernel_versions()["geometry"], "providers": provider_names, "renderer": svc.renderer})


class Run:
    def __init__(self, svc: DesignServices, owner: str, job: dict):
        self.svc, self.owner, self.job = svc, owner, job
        self.job_id, self.build_id = job["job_id"], job["build_id"]
        self.request = job["request"]
        self.ledger = CallLedger()
        self.model, self.images = svc.provider_factory(self.ledger)
        self.cancel = svc.cancels.setdefault(self.job_id, threading.Event())
        self.dir = svc.work_root / self.job_id
        self.stages: list[dict] = []
        self.limit = float(self.request.get("generation_budget_usd", 10))

    # -- plumbing -------------------------------------------------------------------
    def emit(self, stage: str, message: str, status: str = "ok", **kw) -> dict:
        if self.cancel.is_set():
            raise Cancelled()
        return self.svc.store.emit(self.owner, self.job_id, stage, message, status=status, **kw)

    def spend(self, kind: str) -> None:
        if self.ledger.spent + ESTIMATED_USD[kind] > self.limit:
            raise BudgetExhausted()

    def put(self, data: bytes, mime: str) -> dict:
        return self.svc.store.put(self.owner, data, mime)

    def put_file(self, path: str | Path) -> dict:
        p = Path(path)
        return self.put(p.read_bytes(), MIME.get(p.suffix, "application/octet-stream"))

    def ref(self, kind: str, asset: dict) -> dict:
        return {"type": kind, "id": asset["asset_id"], "url": asset["url"]}

    def stage(self, name: str, status: str, detail: str = "") -> None:
        self.stages.append({"stage": name, "status": status, "detail": detail, "at": now()})

    def image_input(self) -> tuple[bytes, str] | None:
        aid = self.request["input"].get("image_asset_id")
        if not aid:
            return None
        self.svc.store.input(self.owner, aid)
        path, mime = self.svc.store.asset(self.owner, aid)
        return path.read_bytes(), mime

    # -- stages ---------------------------------------------------------------------
    def distill(self, image) -> dict:
        if self.model.mode == "live":
            self.spend("vision" if image else "chat")
        raw = self.model.distill(self.request["input"]["user_text"], image, self.request["mode"])
        feats = [str(f)[:80] for f in (raw.get("signature_features") or []) if str(f).strip()][:6]
        while len(feats) < 3:
            feats.append(["clear silhouette", "recognisable proportions", "distinct parts"][len(feats)])
        clean = {k: raw.get(k) for k in DistilledIntent.model_fields if k in raw}
        clean.update(signature_features=feats, subject=str(raw.get("subject") or "design")[:240], summary=str(raw.get("summary") or "")[:2000])
        clean["palette"] = [p for p in (raw.get("palette") or []) if isinstance(p, dict) and isinstance(p.get("hex"), str) and len(p["hex"]) == 7 and p["hex"].startswith("#")][:8]
        clean["proportions"] = {k: float(v) for k, v in (raw.get("proportions") or {}).items() if isinstance(v, (int, float)) and 0 < v <= 100}
        if clean.get("target_size_mm") is not None and not (isinstance(clean["target_size_mm"], list) and len(clean["target_size_mm"]) == 3):
            clean["target_size_mm"] = None
        if clean.get("sensor_height") not in (None, "low", "mid", "high"):
            clean["sensor_height"] = None
        for key in ("goals", "materials", "mechanical_constraints", "supported", "unsupported", "simplifications", "uncertainties", "image_observations"):
            clean[key] = [str(x)[:200] for x in (clean.get(key) or []) if x][:12]
        if not isinstance(clean.get("wheel_count"), int):
            clean["wheel_count"] = None
        clean["functional_behavior"] = str(clean.get("functional_behavior") or "")[:400]
        clean["archetype"] = str(clean.get("archetype") or "object")[:40]
        clean["source"] = "model" if self.model.mode == "live" else "rules"
        intent = DistilledIntent.model_validate(clean).model_dump(mode="json")
        asset = self.put(json.dumps(intent, sort_keys=True).encode(), "application/json")
        self.emit("distilled", f"Understood: {intent['subject']} ({', '.join(intent['signature_features'][:3])})", actor="vision", references=[self.ref("distilled", asset)])
        self.stage("distill", "ok", intent["source"])
        return intent

    def references(self, intent: dict, image) -> tuple[list[dict], dict]:
        refs, consistency = [], {}
        if image:
            aid = self.request["input"]["image_asset_id"]
            refs.append({"id": "ref-upload", "view": "perspective", "image_url": f"/api/v2/assets/{aid}", "source": "upload", "camera": None,
                         "provenance": {"sha256": aid[6:], "authoritative": True}})
            self.emit("concept_ready", "Using the uploaded image as the authoritative reference; no concept art generated", actor="system",
                      references=[{"type": "reference", "id": aid, "url": f"/api/v2/assets/{aid}"}])
            self.stage("concept", "skipped", "uploaded reference replaces generated concept art")
            base = image[0]
        elif self.images is not None:
            self.spend("image")
            prompt = CONCEPT_PROMPT.format(subject=intent["subject"], summary=intent["summary"][:300], features=", ".join(intent["signature_features"]))
            data, mime, meta = self.images.concept(prompt)
            asset = self.put(data, mime)
            refs.append({"id": "ref-concept", "view": "perspective", "image_url": asset["url"], "source": "generated", "camera": {"label": "three-quarter"}, "provenance": meta})
            self.emit("concept_ready", "Concept image generated (reference art, not geometry)", actor="vision", references=[self.ref("concept", asset)])
            self.stage("concept", "ok", meta.get("provider", ""))
            base = data
        else:
            self.emit("concept_ready", "No image provider in fixture mode: concept art skipped; reference views will be labelled renders of the generated model", status="warning", actor="system")
            self.stage("concept", "skipped", "no image provider configured")
            return refs, {"checked": False, "reason": "no generated views"}
        if self.images is None:
            self.stage("multiview", "skipped", "no image provider configured")
            return refs, {"checked": False, "reason": "no image provider for extra views"}
        views = [("perspective", base)]
        for view in ("left", "back", "top"):
            self.spend("image")
            data, mime, meta = self.images.view(base, view, VIEW_PROMPT.format(view=view))
            asset = self.put(data, mime)
            refs.append({"id": f"ref-{view}", "view": view, "image_url": asset["url"], "source": "generated", "camera": {"label": view, "projection": "orthographic"}, "provenance": meta})
            self.emit("view_ready", f"Generated {view} reference view (inferred, not measured)", actor="vision", references=[self.ref(f"view_{view}", asset)])
            views.append((view, data))
        self.spend("vision")
        consistency = self.model.compare_views(views)
        consistency = {"checked": True, "consistent": bool(consistency.get("consistent")), "contradictions": [str(c)[:200] for c in consistency.get("contradictions", [])][:10],
                       "uncertainties": [str(c)[:200] for c in consistency.get("uncertainties", [])][:10]}
        self.stage("multiview", "ok", f"{len(views) - 1} views; consistent={consistency['consistent']}")
        return refs, consistency

    def compile(self, spec: dict, cid: str, tag: str, stream: bool) -> dict:
        out = self.dir / cid / tag
        previews: list[dict] = []

        def progress(event: dict):
            if not stream:
                return
            if event["event"] == "body_built":
                self.emit("body_ready", f"{cid}: built {event['body_id']}" + (f" (failed: {event['error']})" if event.get("error") else ""),
                          status="warning" if event.get("error") else "ok", actor="engineer", candidate_id=cid)
            elif event["event"] == "geometry_preview":
                asset = self.put_file(event["path"])
                previews.append({"index": event["index"], "url": asset["url"], "is_partial": event["is_partial"], "body_ids": event["body_ids"]})
                self.emit("geometry_preview", f"{cid}: {'partial' if event['is_partial'] else 'complete'} assembly with {len(event['body_ids'])} bodies",
                          actor="engineer", candidate_id=cid, references=[self.ref("geometry", asset)], preview_revision=event["index"], is_partial=event["is_partial"],
                          snapshot={"scene_asset_url": asset["url"], "part_manifest": [{"body_id": b} for b in event["body_ids"]], "geometry_digest": asset["sha256"],
                                    "preview_revision": event["index"], "is_partial": event["is_partial"]})

        with KERNEL_LOCK:
            result = compile_design(spec, self.svc.catalog, output_dir=out, progress=progress, seed=spec.get("seed", 0))
        result["_previews"] = previews
        return result

    def author(self, intent: dict, strategy: str, seed: int, feedback: list[str]) -> dict:
        if self.model.mode == "live":
            self.spend("chat")
            return self.model.author(intent, strategy, seed, self.request["mode"], self.svc.catalog, feedback)
        return procedural.author(intent, strategy, seed, self.request["mode"])

    def propose(self, intent: dict, strategy: str, index: int) -> dict:
        feedback: list[str] = []
        for attempt in range(2 if self.model.mode == "live" else 1):
            spec = self.author(intent, strategy, index * 101 + attempt, feedback)
            spec.update(mode=self.request["mode"], strategy=strategy)
            try:
                from rivet_engine.design_ir import DesignSpec

                return DesignSpec.model_validate(spec).model_dump(mode="json")
            except Exception as exc:  # noqa: BLE001 - structured feedback for one repair round
                errors = getattr(exc, "errors", lambda: [])()
                feedback = [f"{'.'.join(str(p) for p in e.get('loc', []))}: {e.get('msg')}" for e in errors][:20] or [str(exc)[:300]]
        raise ApiError("CANDIDATE_INVALID", f"{strategy}: the design model did not return a valid DesignSpec", 502, {"errors": feedback})

    def evaluate(self, cid: str, strategy: str, spec: dict, intent: dict, refs: list[tuple[str, bytes]], tag: str, stream: bool) -> dict:
        result = self.compile(spec, cid, tag, stream)
        iterations = []
        if result["geometry_report"]["status"] != "valid":
            with KERNEL_LOCK:
                fixed = repair(spec, self.svc.catalog, output_dir=self.dir / cid / f"{tag}-repair", initial=result)
            iterations.append({"kind": "deterministic_repair", "accepted": fixed["changed"], "actions": fixed["actions"], "score_before": issue_score(result), "score_after": issue_score(fixed["result"])})
            if fixed["changed"]:
                spec = fixed["spec"]
                result = self.compile(spec, cid, f"{tag}-r", False)
            self.emit("repair", f"{cid}: deterministic repair {'applied' if fixed['changed'] else 'found no allowed fix'} ({len(fixed['actions'])} actions)", actor="repair", candidate_id=cid,
                      status="ok" if fixed["changed"] else "warning")
        if result["geometry_report"]["status"] != "valid" and self.model.mode == "live":
            self.spend("chat")
            issues = result["geometry_report"]["collisions"]["hard_collisions"][:8] + result["geometry_report"]["manufacturing"]["issues"][:6]
            try:
                patched = apply_patch(spec, self.model.patch(spec, "Fix these geometry validation issues without changing the design intent.", issues, []))
                trial = self.compile(patched.model_dump(mode="json"), cid, f"{tag}-patch", False)
                ok = issue_score(trial) < issue_score(result)
                iterations.append({"kind": "model_patch", "accepted": ok, "score_before": issue_score(result), "score_after": issue_score(trial), "changed": changed_bodies(spec, patched)})
                if ok:
                    spec, result = patched.model_dump(mode="json"), trial
            except (ValueError, ApiError) as exc:
                iterations.append({"kind": "model_patch", "accepted": False, "error": str(getattr(exc, "message", exc))[:300]})
        rep = result["geometry_report"]
        mech_asset = self.put(json.dumps(rep, sort_keys=True, default=str).encode(), "application/json")
        self.emit("mechanical_report", f"{cid}: geometry {rep['status']}; {rep['counts']['hard_collisions']} hard collisions, stability {rep['stability']['verdict']}",
                  status="ok" if rep["status"] == "valid" else "warning", actor="validator", candidate_id=cid, references=[self.ref("mechanical_report", mech_asset)])
        eng = engineering_bridge.evaluate(spec, self.svc.catalog)
        plan_asset = self.put(json.dumps(eng["linked_plan"], sort_keys=True).encode(), "application/json") if eng.get("linked_plan") else None
        functional = {k: v for k, v in eng.items() if k != "linked_plan"}
        functional["linked_plan_url"] = plan_asset["url"] if plan_asset else None
        self.emit("engineering_report", f"{cid}: electrical/firmware {eng['status']} ({eng['reason']})", status="ok" if eng["status"] in ("verified", "verified_with_warnings", "not_applicable") else "warning",
                  actor="validator", candidate_id=cid)
        scene = Path(result["scene_asset_path"]).read_bytes()
        scene_asset = self.put(scene, "model/gltf-binary")
        shots_raw = render.render_six_chromium(scene, self.svc.web_root) if self.svc.renderer == "chromium" and render.chromium_available(self.svc.web_root) else render.render_six(scene)
        shots = []
        for s in shots_raw["shots"]:
            a = self.put(s["png"], "image/png")
            shots.append({"view": s["view"], "image_url": a["url"], "camera": s["camera"]})
        self.emit("render_ready", f"{cid}: six camera renders of the generated geometry ({shots_raw['renderer']})", actor="system", candidate_id=cid,
                  references=[{"type": f"shot_{s['view']}", "id": s["image_url"].rsplit("/", 1)[-1], "url": s["image_url"]} for s in shots])
        review = critic.deterministic_review(intent, spec, result["part_manifest"], shots_raw["shots"], refs, shots_raw["render_digest"])
        if self.model.mode == "live":
            self.spend("vision")
            bodies = [{"body_id": p["body_id"], "name": p["name"], "role": p["role"], "kind": p["kind"]} for p in result["part_manifest"]]
            model_review = self.model.critique(intent, refs[:4], [(s["view"], s["png"]) for s in shots_raw["shots"]], bodies)
            review = critic.merge_model_review(model_review, review, {p["body_id"] for p in result["part_manifest"]}, getattr(self.model, "name", "model"))
        critic.validated(review)
        self.emit("visual_review", f"{cid}: visual score {review['overall']}/10 (subjective, {review['judge_model']}); {len(review['issues'])} issues", actor="vision", candidate_id=cid)
        claims = engineering_bridge.claims(self.request["mode"], rep, eng, review["overall"])
        feasible = rep["status"] == "valid" and (self.request["mode"] == "concept_only" or claims["buildability"] == "needs_review")
        assets = []
        for a in result["manufacturing_assets"]:
            if a.get("path"):
                stored = self.put_file(a["path"])
                assets.append({"body_id": a.get("body_id"), "kind": a["kind"], "url": stored["url"], "sha256": stored["sha256"]})
            else:
                assets.append({"body_id": a.get("body_id"), "kind": a["kind"], "url": None, "unavailable": a.get("unavailable")})
        part_urls = {a["body_id"]: a["url"] for a in assets if a["kind"] == "glb"}
        manifest = [{**p, "asset_url": part_urls.get(p["body_id"])} for p in result["part_manifest"]]
        return {
            "id": cid, "strategy": strategy, "seed": spec.get("seed", 0), "status": "complete", "spec": spec, "spec_digest": spec_digest(spec),
            "scene_asset_url": scene_asset["url"], "part_manifest": manifest, "joints": result["joints"], "geometry_digest": result["geometry_digest"],
            "shots": shots, "previews": result.get("_previews", []), "mechanical": {**{k: rep[k] for k in ("status", "blocking", "counts", "stability", "bounds_mm", "within_max_bounds", "connectivity")},
                                                                                      "report_url": mech_asset["url"], "collisions": rep["collisions"], "manufacturing": rep["manufacturing"], "sweeps": rep["sweeps"], "access": rep["access"]},
            "functional": functional, "claims": claims, "visual": review, "feasible": feasible, "error": None, "manufacturing_assets": assets,
            "bom": result["bom"], "assembly_steps": result["assembly_steps"], "iterations": iterations,
        }

    def candidate(self, intent, refs, strategy, index) -> dict:
        cid = f"cand-{index + 1}"
        self.emit("candidate_started", f"{cid}: authoring a {strategy.replace('_', ' ')} design", actor="planner", candidate_id=cid)
        try:
            spec = self.propose(intent, strategy, index)
            return self.evaluate(cid, strategy, spec, intent, refs, "v1", True)
        except (Cancelled, BudgetExhausted):
            raise
        except (ApiError, DesignValidationError) as exc:
            err = exc.envelope()["error"] if isinstance(exc, ApiError) else {"code": "DESIGN_INVALID", "message": str(exc), "details": {"errors": exc.errors[:20]}}
            self.emit("candidate_complete", f"{cid}: failed ({err['message'][:160]})", status="failed", actor="planner", candidate_id=cid)
            return {"id": cid, "strategy": strategy, "status": "failed", "error": err}

    def refine(self, cand: dict, intent: dict, refs) -> dict:
        review = cand["visual"]
        if self.model.mode == "live":
            self.spend("chat")
            try:
                raw = self.model.patch(cand["spec"], "Improve visual fidelity to the brief and references; fix the critic issues only.", review["issues"], [])
            except ApiError:
                raw = None
        else:
            raw = procedural.critic_patch(cand["spec"], review["issues"])
        if not raw or not raw.get("operations"):
            cand["iterations"].append({"kind": "critic_revision", "accepted": False, "reason": "no actionable critic issue"})
            self.emit("revision_ready", f"{cand['id']}: critic found no actionable change; kept as is", status="warning", actor="vision", candidate_id=cand["id"])
            return cand
        try:
            new_spec = apply_patch(cand["spec"], raw).model_dump(mode="json")
        except ValueError as exc:
            cand["iterations"].append({"kind": "critic_revision", "accepted": False, "reason": f"patch rejected: {exc}"})
            return cand
        revised = self.evaluate(cand["id"], cand["strategy"], new_spec, intent, refs, "rev1", False)
        better = revised["feasible"] and (revised["visual"]["overall"] >= review["overall"] or not cand["feasible"])
        record = {"kind": "critic_revision", "accepted": better, "changed": changed_bodies(cand["spec"], new_spec), "score_before": review["overall"], "score_after": revised["visual"]["overall"],
                  "geometry_digest_before": cand["geometry_digest"], "geometry_digest_after": revised["geometry_digest"], "patch": raw}
        self.emit("revision_ready", f"{cand['id']}: critic-guided revision {'kept' if better else 'rolled back'} ({review['overall']} -> {revised['visual']['overall']})",
                  status="ok" if better else "warning", actor="vision", candidate_id=cand["id"])
        if better:
            revised["iterations"] = cand["iterations"] + revised["iterations"] + [record]
            return revised
        cand["iterations"].append(record)
        return cand

    def bundle(self, intent, refs, candidates, consistency, selected, rationale, parent=None, change=None, cached=False, replay_of=None) -> dict:
        chosen = next((c for c in candidates if c["id"] == selected), None)
        feasible = [c for c in candidates if c.get("feasible")]
        if self.request["mode"] == "engineered":
            status = "needs_review" if feasible else "unbuildable"
        else:
            status = "complete" if chosen and chosen.get("feasible") else "needs_review"
        trace = self.put(json.dumps({"events": self.svc.store.events(self.owner, self.job_id), "stages": self.stages, "calls": self.ledger.calls}, default=str, sort_keys=True).encode(), "application/json")
        exports = {}
        if chosen and chosen["status"] == "complete":
            exports = {"scene_glb": chosen["scene_asset_url"], "parts": [a for a in chosen["manufacturing_assets"]],
                       "bom": self.put(json.dumps(chosen["bom"], sort_keys=True).encode(), "application/json")["url"],
                       "assembly_steps": self.put(json.dumps(chosen["assembly_steps"], sort_keys=True).encode(), "application/json")["url"],
                       "manifest": self.put(json.dumps({"part_manifest": chosen["part_manifest"], "joints": chosen["joints"], "geometry_digest": chosen["geometry_digest"]}, sort_keys=True, default=str).encode(), "application/json")["url"]}
        assembly = [{"id": p["body_id"], "parent_id": p["parent_id"], "role": p["role"], "kind": p["kind"], "transform_mm": p["transform_mm"], "asset_url": p.get("asset_url"),
                     "provenance": p["geometry_source"], "body_id": p["body_id"]} for p in (chosen or {}).get("part_manifest", []) if p["status"] == "placed"]
        limitations = list(intent.get("unsupported", [])) + list(intent.get("simplifications", []))
        if self.model.mode != "live":
            limitations.append("Fixture mode: designs authored by Rivet's offline rule-based author; renders and checks are real")
        return {
            "schema_version": "2.0", "build_id": self.build_id, "revision": 0, "job_id": self.job_id, "mode": self.request["mode"], "status": status,
            "title": intent["subject"][:120], "original_request": {"text": self.request["input"]["user_text"], "image_asset_id": self.request["input"].get("image_asset_id")},
            "distilled": intent, "references": refs, "candidates": candidates, "selected_candidate_id": selected, "recommendation": {"candidate_id": selected, "rationale": rationale},
            "scene_asset_url": chosen["scene_asset_url"] if chosen and chosen["status"] == "complete" else None, "assembly": assembly, "exports": exports,
            "linked_plan_url": (chosen or {}).get("functional", {}).get("linked_plan_url"), "generation_trace_url": trace["url"],
            "model_versions": {"design_model": getattr(self.model, "name", "?"), "image_model": getattr(self.images, "name", "none") if self.images else "none", **kernel_versions(),
                               "renderer": self.svc.renderer, "critic": (chosen or {}).get("visual", {}).get("judge_model", "") if chosen else ""},
            "provenance": {"generation_mode": "live" if self.model.mode == "live" else "fixture", "cached": cached, "replay_of": replay_of,
                           "input_digest": digest(self.request["input"]), "catalog_digest": self.svc.catalog_digest(), "view_consistency": consistency,
                           "limitations": limitations[:16], "providers": {"design": getattr(self.model, "name", "?"), "images": getattr(self.images, "name", "none") if self.images else "none"},
                           "stages": self.stages},
            "budget": {"limit_usd": self.limit, "spent_usd": self.ledger.spent, "reserved_usd": 0.0}, "parent_revision": parent, "change": change or {}, "created_at": now(),
        }

    @staticmethod
    def rank(candidates: list[dict]) -> tuple[str | None, str]:
        done = [c for c in candidates if c["status"] == "complete"]
        if not done:
            return None, "every candidate failed"
        feasible = [c for c in done if c["feasible"]]
        pool = feasible or done
        best = max(pool, key=lambda c: (c["visual"]["overall"], -c["mechanical"]["counts"]["hard_collisions"]))
        why = (f"highest visual score among {len(feasible)} feasible candidate(s)" if feasible else
               "no candidate passed the hard gates; showing the best visual concept, labelled with its blocking findings")
        return best["id"], f"{why}: {best['strategy'].replace('_', ' ')} scored {best['visual']['overall']}/10 (subjective)"

    # -- jobs -------------------------------------------------------------------------
    def generate(self) -> None:
        image = self.image_input()
        self.emit("intake", f"Request accepted ({self.request['mode']}, {self.request['quality']} quality, {self.svc.mode} providers)", actor="system")
        self.stage("intake", "ok")
        intent = self.distill(image)
        refs, consistency = self.references(intent, image)
        ref_images: list[tuple[str, bytes]] = []
        for r in refs:
            path, _ = self.svc.store.asset(self.owner, r["image_url"].rsplit("/", 1)[-1])
            ref_images.append((r["view"], path.read_bytes()))
        strategies = STRATEGIES[: self.request["candidate_count"]]
        with ThreadPoolExecutor(max_workers=len(strategies)) as pool:
            candidates = list(pool.map(lambda args: self.candidate(intent, ref_images, *args), [(s, i) for i, s in enumerate(strategies)]))
        sigs: dict[str, str] = {}
        for c in candidates:
            if c["status"] != "complete":
                continue
            sig = topology_signature(c["spec"])
            if sig in sigs:
                c.update(status="failed", feasible=False, error={"code": "DUPLICATE_CANDIDATE", "message": f"same topology and dimensions as {sigs[sig]}", "details": {}})
            else:
                sigs[sig] = c["id"]
        for c in candidates:
            if c["status"] == "complete":
                self.emit("candidate_complete", f"{c['id']}: {'feasible' if c['feasible'] else 'not feasible'} ({c['claims']['buildability']}), visual {c['visual']['overall']}/10",
                          status="ok" if c["feasible"] else "warning", actor="planner", candidate_id=c["id"])
        self.stage("candidate_generation", "ok", f"{sum(c['status'] == 'complete' for c in candidates)}/{len(candidates)} complete")
        selected, why = self.rank(candidates)
        if selected is None:
            raise ApiError("NO_CANDIDATES", "No design candidate could be generated", 502, {"errors": [c.get("error") for c in candidates]})
        self.emit("choice_requested", f"Recommended {selected}: {why}. You can choose another candidate.", actor="planner", candidate_id=selected)
        for _ in range(self.request["review_rounds"]):
            idx = next(i for i, c in enumerate(candidates) if c["id"] == selected)
            candidates[idx] = self.refine(candidates[idx], intent, ref_images)
            selected, why = self.rank(candidates)
        self.stage("refinement", "ok", f"{self.request['review_rounds']} round(s)")
        bundle = self.bundle(intent, refs, candidates, consistency, selected, why)
        self.emit("export_ready", f"Exports ready for {selected}: GLB, per-part GLB, STEP/STL where valid, BOM, assembly steps, manifest", actor="system", candidate_id=selected)
        saved = self.svc.store.save_bundle(self.owner, {**bundle, "revision": 1}, None)
        if self.job.get("cache_key"):
            self.svc.store.cache_put(self.owner, self.job["cache_key"], saved)
        self.emit("complete", f"Design {saved['build_id']} revision {saved['revision']} saved", actor="system", build_id=saved["build_id"], revision=saved["revision"])
        self.svc.store.finish(self.owner, self.job_id, "complete", revision=saved["revision"])

    def replay(self, cached: dict) -> None:
        source = cached["job_id"]
        for e in self.svc.store.events(self.owner, source):
            if e["stage"] in ("complete", "failed", "cancelled", "budget_exhausted"):
                continue
            self.emit(e["stage"], f"replay: {e['message']}", status=e["status"] if e["status"] != "running" else "ok", actor=e["actor"], candidate_id=e.get("candidate_id"),
                      references=e.get("references", []), preview_revision=e.get("preview_revision"), is_partial=e.get("is_partial", False), snapshot=e.get("snapshot"),
                      provenance={"replay_of_job": source})
        bundle = copy.deepcopy(cached)
        bundle.update(build_id=self.build_id, job_id=self.job_id, revision=1, parent_revision=None, change={"replayed_from": f"{cached['build_id']}@{cached['revision']}"})
        bundle["provenance"] = {**bundle["provenance"], "cached": True, "replay_of": f"{cached['build_id']}@{cached['revision']}"}
        bundle["budget"] = {"limit_usd": self.limit, "spent_usd": 0.0, "reserved_usd": 0.0}
        saved = self.svc.store.save_bundle(self.owner, bundle, None)
        self.emit("complete", f"Replayed cached design {cached['build_id']}@{cached['revision']} without provider calls", actor="system", build_id=saved["build_id"], revision=saved["revision"],
                  provenance={"cached": True})
        self.svc.store.finish(self.owner, self.job_id, "complete", revision=saved["revision"])

    def revise(self, base: dict, instruction: str, focus: list[str]) -> None:
        chosen = next(c for c in base["candidates"] if c["id"] == base["selected_candidate_id"])
        self.emit("intake", f"Revision of {base['build_id']}@{base['revision']}: {instruction[:120]}", actor="system")
        if self.model.mode == "live":
            self.spend("chat")
            raw = self.model.patch(chosen["spec"], instruction, [], focus)
        else:
            raw = procedural.edit(chosen["spec"], instruction, base["distilled"])
        if not raw or not raw.get("operations"):
            self.emit("revision_ready", "The request did not map to a geometry change; the design is unchanged", status="warning", actor="planner")
            self.svc.store.finish(self.owner, self.job_id, "complete", revision=base["revision"])
            return
        try:
            new_spec = apply_patch(chosen["spec"], raw).model_dump(mode="json")
        except ValueError as exc:
            self.emit("revision_ready", f"Change rejected: {exc}", status="failed", actor="planner")
            self.svc.store.finish(self.owner, self.job_id, "complete", revision=base["revision"])
            return
        refs = []
        for r in base["references"]:
            path, _ = self.svc.store.asset(self.owner, r["image_url"].rsplit("/", 1)[-1])
            refs.append((r["view"], path.read_bytes()))
        revised = self.evaluate(chosen["id"], chosen["strategy"], new_spec, base["distilled"], refs, f"edit-{base['revision']}", True)
        if revised["mechanical"]["counts"]["hard_collisions"] or revised["mechanical"]["counts"]["unresolved_required_mounts"]:
            self.emit("revision_ready", "Change rejected: it creates collisions or unattached parts that repair could not fix; the last good design is unchanged",
                      status="failed", actor="validator", candidate_id=chosen["id"])
            self.svc.store.finish(self.owner, self.job_id, "complete", revision=base["revision"])
            return
        diff = changed_bodies(chosen["spec"], new_spec)
        revised["iterations"] = chosen.get("iterations", []) + [{"kind": "user_edit", "instruction": instruction, "patch": raw, "changed": diff, "accepted": True,
                                                                 "geometry_digest_before": chosen["geometry_digest"], "geometry_digest_after": revised["geometry_digest"]}]
        candidates = [revised if c["id"] == chosen["id"] else c for c in base["candidates"]]
        self.limit = base["budget"]["limit_usd"]
        bundle = self.bundle(base["distilled"], base["references"], candidates, base["provenance"].get("view_consistency", {}), chosen["id"],
                             base["recommendation"].get("rationale", ""), parent=base["revision"], change={"instruction": instruction, "changed_bodies": diff, "patch_reason": raw.get("reason")})
        bundle.update(build_id=base["build_id"], job_id=base["job_id"])
        saved = self.svc.store.save_bundle(self.owner, bundle, base["revision"])
        self.emit("revision_ready", f"Revision {saved['revision']}: changed {', '.join(diff['changed'] + diff['added']) or 'nothing'}; unchanged bodies keep their geometry",
                  actor="planner", candidate_id=chosen["id"], build_id=saved["build_id"], revision=saved["revision"])
        self.emit("complete", f"Revision {saved['revision']} saved", actor="system", build_id=saved["build_id"], revision=saved["revision"])
        self.svc.store.finish(self.owner, self.job_id, "complete", revision=saved["revision"])


def run_job(svc: DesignServices, owner: str, job: dict, action: Callable[[Run], None]) -> None:
    run = Run(svc, owner, job)
    try:
        action(run)
    except Cancelled:
        svc.store.emit(owner, run.job_id, "cancelled", "Generation cancelled; completed artifacts were kept", status="cancelled")
        svc.store.finish(owner, run.job_id, "cancelled")
    except BudgetExhausted:
        svc.store.emit(owner, run.job_id, "budget_exhausted", f"Stopped: the next provider call would exceed the {run.limit:.2f} USD budget", status="failed")
        svc.store.finish(owner, run.job_id, "budget_exhausted", error={"code": "BUDGET_EXHAUSTED", "message": "generation budget exhausted", "details": {"spent_usd": run.ledger.spent}, "retryable": False})
    except ApiError as err:
        svc.store.emit(owner, run.job_id, "failed", f"{err.code}: {err.message}", status="failed")
        svc.store.finish(owner, run.job_id, "failed", error=err.envelope()["error"])
    except Exception as exc:  # noqa: BLE001
        import logging

        logging.getLogger("rivet_api").exception("design job %s crashed", run.job_id)
        svc.store.emit(owner, run.job_id, "failed", f"Internal error during generation ({type(exc).__name__})", status="failed")
        svc.store.finish(owner, run.job_id, "failed", error={"code": "INTERNAL", "message": "design job failed", "details": {}, "retryable": True})
    finally:
        svc.cancels.pop(run.job_id, None)


def firmware_zip(plan: dict) -> bytes:
    from rivet_api.firmware.generate import generate_firmware

    bundle = generate_firmware(plan, compile=False)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in sorted(bundle.files.items()):
            zf.writestr(name, data)
    return buf.getvalue()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
