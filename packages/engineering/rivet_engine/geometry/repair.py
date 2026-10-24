"""Bounded deterministic repair, applied before any model-guided patch.

Allowed moves only: slide or lift an attached child within its adjustment allowance
(attachment.adjust_mm, default 8 mm for fabricated/visual parts and 4 mm for purchased
parts), and raise thin walls or plates to the minimum wall. Required bodies are never
removed or shrunk. Each round is re-validated by a full compile and kept only if the
issue score improves; every accepted or rejected change is logged.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..design_ir.models import DesignSpec, apply_patch
from .constraints import UnresolvedAnchor, anchor_local_frame

DEFAULT_ALLOWANCE = {"fabricated": 8.0, "concept_visual": 8.0, "purchased": 4.0}


def issue_score(result: dict) -> float:
    c = result["geometry_report"]["counts"]
    stab = result["geometry_report"]["stability"].get("verdict")
    return (
        100 * c["hard_collisions"] + 50 * c["sweep_collisions"] + 100 * c["unresolved_required_mounts"] + 100 * c["failed_required_bodies"]
        + 5 * c["clearance_violations"] + 20 * c["blocking_manufacturing_issues"] + (30 if stab == "unstable" else 0)
        + (1 if not result["geometry_report"]["within_max_bounds"] else 0) * 40
    )


def _descendants(spec: DesignSpec, body_id: str) -> int:
    kids: dict[str, list[str]] = {}
    for b in spec.bodies:
        if b.parent_id:
            kids.setdefault(b.parent_id, []).append(b.id)
    n, stack = 0, list(kids.get(body_id, []))
    while stack:
        n += 1
        stack.extend(kids.get(stack.pop(), []))
    return n


def _manifest(result: dict) -> dict[str, dict]:
    return {p["body_id"]: p for p in result["part_manifest"]}


def _world(entry: dict) -> np.ndarray:
    return np.array(entry["transform_mm"], dtype=float).reshape(4, 4)


def _centre(entry: dict) -> np.ndarray:
    b = entry["bounds_mm"]
    return (np.array(b["min"]) + np.array(b["max"])) / 2


def _mover(spec: DesignSpec, a: str, b: str):
    by_id = {x.id: x for x in spec.bodies}
    options = []
    for bid, other in ((a, b), (b, a)):
        body = by_id[bid]
        if body.parent_id is None or body.attachment is None:
            continue
        if by_id[other].parent_id == bid:  # never move a parent away from its own child
            continue
        options.append((body.kind == "purchased", _descendants(spec, bid), bid, other))
    if not options:
        return None
    options.sort()
    _, _, bid, other = options[0]
    return by_id[bid], other


def _allowance(body) -> float:
    return body.attachment.adjust_mm if body.attachment and body.attachment.adjust_mm > 0 else DEFAULT_ALLOWANCE[body.kind]


def plan_fixes(spec: DesignSpec, result: dict) -> list[dict]:
    report = result["geometry_report"]
    parts = _manifest(result)
    by_id = {b.id: b for b in spec.bodies}
    fixes: list[dict] = []
    moved: set[str] = set()

    def move(body, world_delta: np.ndarray, reason: str):
        if body.id in moved:
            return
        parent = parts.get(body.parent_id)
        if not parent or not parent.get("transform_mm"):
            return
        r = _world(parent)[:3, :3]
        local = r.T @ world_delta
        if float(np.linalg.norm(local)) > _allowance(body) + 1e-6:
            fixes.append({"body_id": body.id, "set": None, "reason": reason, "skipped": f"needs {np.linalg.norm(local):.1f} mm, beyond the {_allowance(body):g} mm allowance"})
            return
        before = list(body.attachment.offset_mm)
        after = [round(float(v + d), 3) for v, d in zip(before, local)]
        fixes.append({"body_id": body.id, "set": {"attachment.offset_mm": after}, "before": {"attachment.offset_mm": before}, "reason": reason})
        moved.add(body.id)

    for hit in report["collisions"]["hard_collisions"]:
        if hit.get("kind") == "embedded_purchased_part":
            continue
        pick = _mover(spec, hit["a"], hit["b"])
        if pick is None:
            continue
        body, other = pick
        depth = float(hit.get("depth_mm", 0)) + max(spec.constraints.min_general_clearance_mm, 0.2) + 0.2
        if hit.get("kind") == "penetration":
            parent_entry = parts[body.parent_id]
            lo, hi = parent_entry["local_bounds_mm"]["min"], parent_entry["local_bounds_mm"]["max"]
            try:
                frame = anchor_local_frame((np.array(lo), np.array(hi)), by_id[body.parent_id].anchors, body.attachment.parent_anchor)
            except UnresolvedAnchor:
                continue
            normal_world = _world(parent_entry)[:3, :3] @ frame[:3, 1]
            move(body, normal_world * (float(hit["depth_mm"]) + 0.2), f"lift {body.id} out of {body.parent_id} ({hit['depth_mm']} mm penetration)")
            continue
        away = _centre(parts[body.id]) - _centre(parts[other])
        axis = int(np.argmax(np.abs(away)))
        delta = np.zeros(3)
        delta[axis] = np.sign(away[axis]) * depth if away[axis] else depth
        move(body, delta, f"slide {body.id} away from {other} ({hit['volume_mm3']} mm3 overlap)")
    for item in report["collisions"]["clearance_violations"]:
        pick = _mover(spec, item["a"], item["b"])
        if pick is None:
            continue
        body, other = pick
        need = float(item["required_mm"]) - float(item["gap_mm"]) + 0.2
        away = _centre(parts[body.id]) - _centre(parts[other])
        axis = int(np.argmax(np.abs(away)))
        delta = np.zeros(3)
        delta[axis] = np.sign(away[axis]) * need if away[axis] else need
        move(body, delta, f"open clearance between {body.id} and {other} to {item['required_mm']} mm")
    for issue in report["manufacturing"]["issues"]:
        if issue["rule"] != "manufacturing.min_wall":
            continue
        body = by_id[issue["body_id"]]
        shape = body.shape
        need = float(issue["required_mm"])
        if shape is None:
            continue
        path = None
        if shape.type in ("tube", "shell") or (shape.type == "occupancy" and shape.hollow):
            path, before = "shape.wall_mm", shape.wall_mm
        elif shape.type in ("box", "plate", "rounded_box"):
            dims = list(shape.dimensions_mm)
            i = int(np.argmin(dims))
            before = list(dims)
            dims[i] = need
            fixes.append({"body_id": body.id, "set": {"shape.dimensions_mm": dims}, "before": {"shape.dimensions_mm": before}, "reason": f"thicken {body.id} to the {need:g} mm minimum wall"})
            continue
        else:
            for idx, f in enumerate(body.features):
                if f.type == "shell" and f.wall_mm < need:
                    path, before = f"features.{idx}.wall_mm", f.wall_mm
        if path:
            fixes.append({"body_id": body.id, "set": {path: need}, "before": {path: before}, "reason": f"raise {body.id} wall to the {need:g} mm minimum"})
    return fixes


def repair(spec: dict | DesignSpec, catalog: list[dict], *, output_dir: str | Path, cache=None, max_rounds: int = 3, initial: dict | None = None) -> dict:
    from ..design_compiler import compile_design

    current = DesignSpec.model_validate(spec)
    result = initial or compile_design(current, catalog, output_dir=Path(output_dir) / "repair-0", cache=cache, write_exports=False)
    log: list[dict] = []
    for round_no in range(1, max_rounds + 1):
        fixes = plan_fixes(current, result)
        applicable = [f for f in fixes if f.get("set")]
        log.extend({"round": round_no, **f, "accepted": False} for f in fixes if not f.get("set"))
        if not applicable:
            break
        merged: dict[str, dict] = {}
        for f in applicable:
            merged.setdefault(f["body_id"], {}).update(f["set"])
        try:
            candidate = apply_patch(current, {"reason": f"deterministic repair round {round_no}",
                                              "operations": [{"operation": "update", "body_id": k, "set": v} for k, v in merged.items()]})
        except ValueError as exc:
            log.extend({"round": round_no, **f, "accepted": False, "rejected": str(exc)} for f in applicable)
            break
        trial = compile_design(candidate, catalog, output_dir=Path(output_dir) / f"repair-{round_no}", cache=cache, write_exports=False)
        before, after = issue_score(result), issue_score(trial)
        accepted = after < before
        log.extend({"round": round_no, **f, "accepted": accepted, "score_before": before, "score_after": after} for f in applicable)
        if not accepted:
            break
        current, result = candidate, trial
        if after == 0:
            break
    return {"spec": current.model_dump(mode="json"), "result": result, "actions": log, "changed": any(a["accepted"] for a in log)}
