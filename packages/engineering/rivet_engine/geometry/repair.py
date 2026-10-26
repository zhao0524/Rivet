"""Bounded deterministic repair, applied before any model-guided patch.

Allowed moves only: slide or lift an attached child within its adjustment allowance
(attachment.adjust_mm, default 8 mm for fabricated/visual parts and 4 mm for purchased
parts), lower a wheel or foot that does not reach the floor the other contact parts
stand on, and raise thin walls or plates to the minimum wall. Required bodies are never
removed or shrunk. Each round is re-validated by a full compile and kept only if the
issue score improves; every accepted or rejected change is logged.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from ..design_ir.models import DesignBody, DesignSpec, apply_patch
from .constraints import UnresolvedAnchor, anchor_local_frame
from .stability import CONTACT_TOLERANCE_MM

DEFAULT_ALLOWANCE = {"fabricated": 8.0, "concept_visual": 8.0, "purchased": 4.0}
# Parts whose job is to touch the floor, so they may be lowered onto it.
GROUND_PART = re.compile(r"wheel|caster|castor|foot|feet|leg|skid|tyre|tire|track|roller|outrigger")
# Structural members that must read as solid beams, not wires.
STRUCTURAL_PART = re.compile(r"arm|boom|strut|leg|post|beam|rod|mast|pole|spar|brace|bar|spine")
MIN_STRUCTURE_CROSS_MM = 8.0
MIN_STRUCTURE_RATIO = 0.1
THICKENABLE_SHAPES = {"box", "rounded_box", "cylinder", "capsule", "cone"}


def is_ground_part(body: DesignBody) -> bool:
    if body.shape is not None and body.shape.type == "wheel":
        return True
    return bool(GROUND_PART.search(" ".join([body.role, body.name, *body.tags]).lower()))


def structural_floor_contacts(result: dict) -> list[str]:
    """Bodies holding the design off the floor that are structure, not feet.

    A quadcopter authored without landing gear rests on its own arms: the support polygon is then
    whatever two booms happen to reach lowest, which is why it reads as unstable. No bounded repair
    can invent the missing feet, so this names the problem for the authoring model instead.
    """
    contacts = set((result.get("geometry_report", {}).get("stability") or {}).get("contact_bodies") or [])
    if not contacts:
        return []
    out = []
    for entry in result.get("part_manifest") or []:
        if entry["body_id"] not in contacts:
            continue
        words = " ".join([entry.get("role") or "", entry.get("name") or "", *(entry.get("tags") or [])]).lower()
        if GROUND_PART.search(words):
            continue
        if STRUCTURAL_PART.search(words):
            out.append(entry["body_id"])
    return sorted(out)


def slender_structures(result: dict) -> list[dict]:
    """Fabricated structural parts (arms, legs, struts) whose cross-section is too thin to read
    as a solid member: below MIN_STRUCTURE_CROSS_MM, or below a tenth of their own length.

    Prompt rules alone are not reliable here; a stick-thin arm still compiles as valid geometry,
    so this is what makes the difference measurable rather than cosmetic.
    """
    out: list[dict] = []
    for entry in result.get("part_manifest") or []:
        if entry.get("status") != "placed" or entry.get("kind") != "fabricated":
            continue
        words = " ".join([entry.get("role") or "", entry.get("name") or "", *(entry.get("tags") or [])]).lower()
        if not STRUCTURAL_PART.search(words):
            continue
        bounds = entry.get("local_bounds_mm")
        if not bounds:
            continue
        ext = sorted(float(hi) - float(lo) for lo, hi in zip(bounds["min"], bounds["max"]))
        if ext[0] <= 1e-6:
            continue
        target = max(MIN_STRUCTURE_CROSS_MM, ext[2] * MIN_STRUCTURE_RATIO)
        if ext[0] < target - 1e-9:
            out.append({"body_id": entry["body_id"], "cross_mm": ext[0], "length_mm": ext[2], "target_mm": target})
    return out


SWEEP_SAMPLES = 9


def clear_joint_fixes(spec: DesignSpec, report: dict) -> list[dict]:
    """Narrow a joint's declared range to the widest collision-free span around its shown value.

    The sweep check reports every sampled joint value whose motion drives a moving body into a
    static one. A design is only claiming a motion it cannot perform; the shown pose is still
    sound. So clamp `limits` to the clear span containing `value`, or lock the joint rigid when
    no motion at all is clear. The value never changes, so the assembled pose is untouched.
    """
    blocked: dict[str, set[float]] = {}
    for hit in report.get("sweeps") or []:
        blocked.setdefault(hit["joint_body"], set()).add(round(float(hit["value"]), 6))
    by_id = {b.id: b for b in spec.bodies}
    fixes: list[dict] = []
    for body_id, hits in blocked.items():
        body = by_id.get(body_id)
        att = body.attachment if body else None
        if att is None or att.joint not in ("hinge", "shaft", "slide"):
            continue
        lo, hi = float(att.limits[0]), float(att.limits[1])
        samples = [round(v, 6) for v in np.linspace(lo, hi, SWEEP_SAMPLES)]
        runs: list[list[float]] = []
        run: list[float] = []
        for sample in samples:
            if sample in hits:
                if run:
                    runs.append(run)
                    run = []
            else:
                run.append(sample)
        if run:
            runs.append(run)
        span = next((r for r in runs if r[0] - 1e-9 <= att.value <= r[-1] + 1e-9), None)
        if span is None:
            continue
        if span[-1] - span[0] <= 1e-9:
            fixes.append({"body_id": body_id, "set": {"attachment.joint": "rigid", "attachment.limits": [att.value, att.value]},
                          "before": {"attachment.joint": att.joint, "attachment.limits": list(att.limits)},
                          "reason": f"lock {body_id} rigid: no motion is clear of the other parts, so the shown pose is the only valid one"})
        elif span != [lo, hi]:
            fixes.append({"body_id": body_id, "set": {"attachment.limits": [span[0], span[-1]]},
                          "before": {"attachment.limits": [lo, hi]},
                          "reason": f"narrow {body_id} to its collision-free range {span[0]:g}..{span[-1]:g} {'' if att.joint != 'slide' else 'mm'}"})
    return fixes


def _scale_shape(shape: dict, factor: float, min_wall: float) -> dict:
    out = dict(shape)
    for key in ("dimensions_mm", "section_heights_mm"):
        if out.get(key):
            out[key] = [round(float(v) * factor, 4) for v in out[key]]
    for key in ("radius_mm", "radius_top_mm", "minor_radius_mm", "height_mm"):
        if out.get(key) is not None:
            out[key] = round(float(out[key]) * factor, 4)
    if out.get("wall_mm") is not None:
        wall = max(min_wall, float(out["wall_mm"]) * factor)
        # tube/wheel require wall < radius, and rounded_box radius < half the smallest side:
        # keep the scaled wall strictly inside whatever it hollows.
        radius = out.get("radius_mm")
        if out.get("type") in ("tube", "wheel") and radius:
            wall = min(wall, float(radius) * 0.9)
        out["wall_mm"] = round(wall, 4)
    if out.get("minor_radius_mm") is not None and out.get("radius_mm"):
        out["minor_radius_mm"] = round(min(float(out["minor_radius_mm"]) * factor, float(out["radius_mm"]) * 0.9), 4)
    if out.get("pitch_mm") is not None:
        out["pitch_mm"] = round(max(0.2, float(out["pitch_mm"]) * factor), 4)
    if out.get("smoothing_mm") is not None:
        out["smoothing_mm"] = round(float(out["smoothing_mm"]) * factor, 4)
    for key in ("profile_mm", "sections", "path_mm"):
        if out.get(key):
            out[key] = [[round(float(c) * factor, 4) for c in point] for point in out[key]]
    if out.get("children"):
        out["children"] = [_scale_shape(c, factor, min_wall) for c in out["children"]]
    if out.get("frame", {}).get("position_mm"):
        out["frame"] = {**out["frame"], "position_mm": [round(float(v) * factor, 4) for v in out["frame"]["position_mm"]]}
    return out


def scale_spec(spec: DesignSpec, factor: float, min_wall: float) -> dict:
    """Uniformly scale a whole design so its assembled size fits its own declared envelope.

    Proportions, hierarchy and the shown pose are preserved because every length shrinks by the
    same factor; walls are floored at the minimum wall so the result stays printable.
    """
    raw = spec.model_dump(mode="json")
    for body in raw["bodies"]:
        if body.get("shape"):
            body["shape"] = _scale_shape(body["shape"], factor, min_wall)
        for feature in body.get("features") or []:
            for key in ("radius_mm", "depth_mm", "wall_mm", "counterbore_radius_mm", "counterbore_depth_mm", "width_mm", "length_mm", "spacing_mm"):
                if feature.get(key) is not None:
                    feature[key] = round(max(0.1, float(feature[key]) * factor), 4)
            if feature.get("position_mm"):
                feature["position_mm"] = [round(float(v) * factor, 4) for v in feature["position_mm"]]
        att = body.get("attachment")
        if att:
            att["offset_mm"] = [round(float(v) * factor, 4) for v in att["offset_mm"]]
            if att.get("adjust_mm"):
                att["adjust_mm"] = round(float(att["adjust_mm"]) * factor, 4)
        for anchor in body.get("anchors") or []:
            if anchor.get("frame", {}).get("position_mm"):
                anchor["frame"]["position_mm"] = [round(float(v) * factor, 4) for v in anchor["frame"]["position_mm"]]
    if raw["visual_goal"].get("target_size_mm"):
        raw["visual_goal"]["target_size_mm"] = [round(float(v) * factor, 4) for v in raw["visual_goal"]["target_size_mm"]]
    return raw


def issue_score(result: dict) -> float:
    c = result["geometry_report"]["counts"]
    stab = result["geometry_report"]["stability"].get("verdict")
    return (
        100 * c["hard_collisions"] + 50 * c["sweep_collisions"] + 100 * c["unresolved_required_mounts"] + 100 * c["failed_required_bodies"]
        + 5 * c["clearance_violations"] + 20 * c["blocking_manufacturing_issues"] + (30 if stab == "unstable" else 0)
        + (1 if not result["geometry_report"]["within_max_bounds"] else 0) * 40
        + 5 * len(slender_structures(result))
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


def _overlap_extents(a: dict, b: dict) -> np.ndarray:
    """How far two placed bodies' boxes overlap along each axis (mm)."""
    lo = np.maximum(a["bounds_mm"]["min"], b["bounds_mm"]["min"])
    hi = np.minimum(a["bounds_mm"]["max"], b["bounds_mm"]["max"])
    return np.maximum(np.array(hi, dtype=float) - np.array(lo, dtype=float), 0.0)


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

    # A joint that sweeps into another part is claiming a motion it cannot perform. Narrow its
    # declared range instead of moving the parts, so the shown pose is preserved exactly.
    fixes.extend(clear_joint_fixes(spec, report))

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
        # Separate along the axis where the two boxes overlap least: that is the shortest move
        # that clears the clash, and it keeps coplanar parts (e.g. two propellers on one plane)
        # from being slid a long way sideways by the largest centre offset instead.
        extents = _overlap_extents(parts[body.id], parts[other])
        axis = int(np.argmin(np.where(extents > 0, extents, np.inf)))
        if not np.isfinite(extents[axis]):
            axis = int(np.argmax(np.abs(away)))
        need = float(extents[axis]) + max(spec.constraints.min_general_clearance_mm, 0.2) + 0.2
        delta = np.zeros(3)
        delta[axis] = np.sign(away[axis]) * need if away[axis] else need
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
    # A design stands on its lowest parts. When it cannot stand, bring every wheel or foot
    # that hangs above the floor down onto it, so they share one support polygon.
    if report["stability"].get("verdict") == "unstable":
        heights = [float(p["bounds_mm"]["min"][1]) for p in parts.values() if p.get("bounds_mm")]
        contacts = [b for b in spec.bodies if is_ground_part(b) and parts.get(b.id, {}).get("bounds_mm")]
        if heights and len(contacts) >= 2:
            floor = min(heights)
            for body in contacts:
                gap = float(parts[body.id]["bounds_mm"]["min"][1]) - floor
                if gap > CONTACT_TOLERANCE_MM:
                    move(body, np.array([0.0, -gap, 0.0]), f"lower {body.id} by {gap:.1f} mm onto the floor the other contact parts stand on")

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


def _thicken_set(shape, target: float) -> dict:
    """The patch fields that widen a shape's narrow cross-section to `target`, or {} if it is
    already thick enough or its type cannot be widened in place (booleans, profiles, meshes)."""
    if shape is None or shape.type not in THICKENABLE_SHAPES:
        return {}
    if shape.type in ("box", "rounded_box"):
        dims = list(shape.dimensions_mm)
        i = int(np.argmin(dims))
        if dims[i] >= target - 1e-9:
            return {}
        dims[i] = round(target, 3)
        setter = {"shape.dimensions_mm": dims}
        # A rounded_box corner radius must stay under half its smallest side.
        if shape.type == "rounded_box" and shape.radius_mm * 2 >= min(dims):
            setter["shape.radius_mm"] = round(max(0.1, 0.45 * min(dims)), 4)
        return setter
    if shape.type in ("cylinder", "capsule", "cone"):
        radius = max(float(shape.radius_mm), target / 2.0)
        if radius <= float(shape.radius_mm) + 1e-9:
            return {}
        return {"shape.radius_mm": round(radius, 4)}
    return {}


def _solidify_structures(current: DesignSpec, result: dict, compile_design, catalog, output_dir: Path, cache, log: list[dict], max_rounds: int = 2):
    """Thicken slender structural parts one at a time, keeping only the changes that help.

    A stick-thin arm or leg still compiles as valid geometry, so no collision check catches it; it
    is only unreadable. Widening all four arms of a quadcopter at once can make them clash, and a
    batched change would then veto every one of them together. Tested one at a time, each part that
    helps is kept and the parts that would hurt are left as the author drew them.
    """
    for round_no in range(1, max_rounds + 1):
        items = slender_structures(result)
        if not items:
            break
        progressed = False
        for item in items:
            body = next((b for b in current.bodies if b.id == item["body_id"]), None)
            setter = _thicken_set(body.shape if body else None, item["target_mm"])
            if not setter:
                continue
            reason = f"thicken {item['body_id']} from {item['cross_mm']:.1f} mm to {item['target_mm']:g} mm so it reads as a solid member"
            try:
                candidate = apply_patch(current, {"reason": f"solidify structures round {round_no}",
                                                  "operations": [{"operation": "update", "body_id": item["body_id"], "set": setter}]})
            except ValueError as exc:
                log.append({"round": round_no, "body_id": item["body_id"], "set": setter, "accepted": False, "reason": reason, "rejected": str(exc)})
                continue
            trial = compile_design(candidate, catalog, output_dir=output_dir / f"solidify-{round_no}-{item['body_id']}", cache=cache, write_exports=False)
            before, after = issue_score(result), issue_score(trial)
            accepted = after < before
            log.append({"round": round_no, "body_id": item["body_id"], "set": setter, "before": {"shape": body.shape.model_dump(mode="json")} if body and body.shape else {},
                        "accepted": accepted, "score_before": before, "score_after": after, "reason": reason})
            if accepted:
                current, result = candidate, trial
                progressed = True
        if not progressed:
            break
    return current, result


def _fit_envelope(current: DesignSpec, result: dict, compile_design, catalog, output_dir: Path, cache, log: list[dict]) -> tuple[DesignSpec, dict]:
    """Scale a design that overflows its own declared envelope, keeping every proportion.

    `constraints.max_bounds_mm` is the author's own statement of how big the object may be; a
    design that exceeds it is scaled down uniformly (walls floored at the minimum wall) rather
    than rejected, so the shown pose, hierarchy and proportions survive intact.
    """
    bounds = result["geometry_report"]["bounds_mm"]["size"]
    limits = list(current.constraints.max_bounds_mm)
    factor = min((limit / size for limit, size in zip(limits, bounds) if size > 1e-6), default=1.0) * 0.98
    if factor >= 1.0:
        return current, result
    # Purchased catalog parts have fixed real-world sizes that must not be scaled; a design that
    # mixes them with printed parts cannot be uniformly shrunk, so leave the finding standing.
    if any(b.kind == "purchased" for b in current.bodies):
        return current, result
    try:
        scaled = DesignSpec.model_validate(scale_spec(current, factor, float(current.constraints.min_wall_mm)))
        trial = compile_design(scaled, catalog, output_dir=output_dir / "envelope", cache=cache, write_exports=False)
    except Exception as exc:  # noqa: BLE001 - scaling must never break a run
        log.append({"round": 0, "body_id": None, "set": {"__scale__": round(factor, 5)}, "accepted": False,
                    "reason": f"could not scale the design to fit its {limits[0]:g} x {limits[1]:g} x {limits[2]:g} mm envelope: {str(exc)[:200]}"})
        return current, result
    before, after = issue_score(result), issue_score(trial)
    accepted = after < before
    log.append({"round": 0, "body_id": None, "set": {"__scale__": round(factor, 5)}, "accepted": accepted,
                "reason": f"scale the whole design by {factor:.3f} so it fits its declared {limits[0]:g} x {limits[1]:g} x {limits[2]:g} mm envelope "
                          f"(it measured {bounds[0]:g} x {bounds[1]:g} x {bounds[2]:g} mm)",
                "score_before": before, "score_after": after})
    return (scaled, trial) if accepted else (current, result)


def repair(spec: dict | DesignSpec, catalog: list[dict], *, output_dir: str | Path, cache=None, max_rounds: int = 3, initial: dict | None = None) -> dict:
    from ..design_compiler import compile_design

    current = DesignSpec.model_validate(spec)
    result = initial or compile_design(current, catalog, output_dir=Path(output_dir) / "repair-0", cache=cache, write_exports=False)
    log: list[dict] = []
    if not result["geometry_report"]["within_max_bounds"]:
        current, result = _fit_envelope(current, result, compile_design, catalog, Path(output_dir), cache, log)
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
        if after == 0 and not slender_structures(result):
            break
    # Structural solidity is separate from collision repair: a valid design can still be built from
    # stick-thin arms. Widening them one at a time keeps every part that helps.
    current, result = _solidify_structures(current, result, compile_design, catalog, Path(output_dir), cache, log)
    return {"spec": current.model_dump(mode="json"), "result": result, "actions": log, "changed": any(a["accepted"] for a in log)}
