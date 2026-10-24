"""Collision, contact and clearance checks on placed bodies.

Broadphase: world AABB overlap (inflated by the clearance being checked). Narrowphase:
exact boolean intersection of the two closed meshes (manifold3d); separation distance
with manifold `min_gap`. Bodies whose mesh is not closed fall back to an AABB estimate
that is labelled approximate. Pair classification:

- parent/child with contact touch|fastened: overlap within a contact tolerance is the
  intended contact; more is a penetration.
- parent/child with contact embedded: intended overlap (flagged if a purchased part is
  embedded, which is not physical).
- parent/child with contact clearance: any overlap, or a gap below clearance_mm, fails.
- unrelated bodies: any overlap is a collision; a gap below the general clearance is a
  clearance violation.
Collisions between two physical bodies (purchased or fabricated) are hard; anything that
involves a concept_visual body is cosmetic (visual-only geometry).
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

import numpy as np

from .meshing import TriMesh, ray_hits

CONTACT_DEPTH_MM = 0.6
CONTACT_VOLUME_FRACTION = 0.005


@dataclass
class PlacedBody:
    id: str
    kind: str
    parent_id: str | None
    contact: str | None
    clearance_mm: float
    mesh: TriMesh  # world, mm
    manifold: object | None  # world manifold3d.Manifold or None
    volume_mm3: float
    lo: np.ndarray
    hi: np.ndarray
    role: str = "body"
    internal: bool = False

    @property
    def physical(self) -> bool:
        return self.kind in ("purchased", "fabricated")


def _aabb_overlap(a: PlacedBody, b: PlacedBody, inflate: float = 0.0) -> bool:
    return bool(np.all(a.lo - inflate <= b.hi) and np.all(b.lo - inflate <= a.hi))


def _aabb_intersection(a: PlacedBody, b: PlacedBody) -> tuple[float, float]:
    lo = np.maximum(a.lo, b.lo)
    hi = np.minimum(a.hi, b.hi)
    ext = np.maximum(hi - lo, 0)
    return float(np.prod(ext)), float(ext.min())


def pair_overlap(a: PlacedBody, b: PlacedBody) -> tuple[float, float, bool]:
    """(intersection volume mm3, depth estimate mm, exact?)"""
    if a.manifold is not None and b.manifold is not None:
        inter = a.manifold ^ b.manifold
        if inter.is_empty():
            return 0.0, 0.0, True
        vol = float(inter.volume())
        lo, hi = inter.bounding_box()[:3], inter.bounding_box()[3:]
        depth = float(np.min(np.array(hi) - np.array(lo)))
        return vol, depth, True
    vol, depth = _aabb_intersection(a, b)
    return vol, depth, False


def pair_gap(a: PlacedBody, b: PlacedBody, search: float) -> float | None:
    if a.manifold is not None and b.manifold is not None:
        gap = float(a.manifold.min_gap(b.manifold, float(search)))
        return gap if gap < search else None
    d = np.maximum(np.maximum(a.lo - b.hi, b.lo - a.hi), 0)
    gap = float(np.linalg.norm(d))
    return gap if gap < search else None


def _related(a: PlacedBody, b: PlacedBody) -> tuple[PlacedBody, PlacedBody] | None:
    if a.parent_id == b.id:
        return b, a
    if b.parent_id == a.id:
        return a, b
    return None


def check(bodies: list[PlacedBody], min_clearance: float) -> dict:
    hard, contacts, cosmetic, clearance, unintended = [], [], [], [], []
    approximate = []
    broad = checked = 0
    for a, b in combinations(bodies, 2):
        rel = _related(a, b)
        need = max(min_clearance, rel[1].clearance_mm if rel else 0.0)
        if not _aabb_overlap(a, b, need + 1e-6):
            continue
        broad += 1
        checked += 1
        vol, depth, exact = pair_overlap(a, b)
        if not exact:
            approximate.append([a.id, b.id])
        small = min(max(a.volume_mm3, 1e-9), max(b.volume_mm3, 1e-9))
        eps = max(0.05, small * 1e-6)
        both_physical = a.physical and b.physical
        entry = {"a": a.id, "b": b.id, "volume_mm3": round(vol, 3), "depth_mm": round(depth, 3), "exact": exact}
        if rel is not None:
            parent, child = rel
            contact = child.contact or "touch"
            if contact == "embedded":
                if vol > eps:
                    entry["kind"] = "intended_overlap"
                    contacts.append(entry)
                    if "purchased" in (a.kind, b.kind):
                        hard.append({**entry, "kind": "embedded_purchased_part",
                                     "suggestion": f"a purchased part cannot be embedded in another body; use contact 'touch' or a cut-out in {parent.id}"})
                continue
            if vol > eps:
                tolerated = contact in ("touch", "fastened") and depth <= CONTACT_DEPTH_MM and vol <= max(0.5, CONTACT_VOLUME_FRACTION * small)
                if tolerated:
                    contacts.append({**entry, "kind": "intended_contact"})
                    continue
                entry.update(kind="penetration", suggestion=f"move {child.id} out of {parent.id} by about {depth + 0.2:.1f} mm along its mounting face normal")
                (hard if both_physical else cosmetic).append(entry)
                continue
            gap = pair_gap(a, b, need + 1.0)
            if contact == "clearance" and gap is not None and gap < child.clearance_mm - 1e-6:
                clearance.append({"a": a.id, "b": b.id, "gap_mm": round(gap, 3), "required_mm": child.clearance_mm, "kind": "joint_clearance"})
            elif gap is not None and gap <= 1e-3:
                contacts.append({**entry, "kind": "intended_contact", "gap_mm": round(gap, 4)})
            continue
        if vol > eps:
            entry.update(kind="collision", suggestion=f"separate {a.id} and {b.id} by at least {depth + max(min_clearance, 0.2):.1f} mm or add a cut-out")
            (hard if both_physical else cosmetic).append(entry)
            continue
        gap = pair_gap(a, b, need + 1.0)
        if gap is None:
            continue
        if gap <= 1e-3:
            item = {"a": a.id, "b": b.id, "gap_mm": round(gap, 4), "kind": "unintended_contact"}
            (unintended if both_physical else cosmetic).append(item)
        elif gap < min_clearance and both_physical:
            clearance.append({"a": a.id, "b": b.id, "gap_mm": round(gap, 3), "required_mm": min_clearance, "kind": "general_clearance"})
    return {
        "method": "AABB broadphase + exact mesh boolean narrowphase (manifold3d)",
        "pairs": len(bodies) * (len(bodies) - 1) // 2,
        "broadphase_pairs": broad,
        "narrowphase_pairs": checked,
        "approximate_pairs": approximate,
        "hard_collisions": hard,
        "intended_contacts": contacts,
        "cosmetic_overlaps": cosmetic,
        "clearance_violations": clearance,
        "unintended_contacts": unintended,
    }


def moving_sweep(static: list[PlacedBody], moving_by_sample: list[tuple[float, list[PlacedBody]]], joint_body: str, parent_id: str) -> list[dict]:
    """Collisions of a moving subtree against static physical bodies across joint samples."""
    hits = []
    moving_ids = {b.id for _, group in moving_by_sample[:1] for b in group}
    for value, group in moving_by_sample:
        for m in group:
            for s in static:
                if s.id in moving_ids or (m.id == joint_body and s.id == parent_id):
                    continue
                if not (m.physical and s.physical) or not _aabb_overlap(m, s):
                    continue
                vol, depth, exact = pair_overlap(m, s)
                if vol > max(0.05, 1e-6 * min(m.volume_mm3, s.volume_mm3)):
                    hits.append({"joint_body": joint_body, "value": round(value, 3), "a": m.id, "b": s.id, "volume_mm3": round(vol, 3), "depth_mm": round(depth, 3), "exact": exact})
    return hits


def access_rays(target: PlacedBody, others: list[PlacedBody], reach_mm: float = 25.0) -> dict:
    """Which of the six directions from a part's centre are open to the outside within
    `reach_mm` of its surface (for wiring/connector and tool access)."""
    centre = (target.lo + target.hi) / 2
    half = (target.hi - target.lo) / 2
    dirs = {"+x": (1, 0, 0), "-x": (-1, 0, 0), "+y": (0, 1, 0), "-y": (0, -1, 0), "+z": (0, 0, 1), "-z": (0, 0, -1)}
    blockers = [o for o in others if o.id != target.id and o.physical]
    open_dirs, blocked = [], {}
    for name, d in dirs.items():
        d = np.array(d, dtype=float)
        start = centre + d * (np.abs(d) @ half + 0.05)
        nearest, by = np.inf, None
        for o in blockers:
            # quick reject: ray segment vs AABB
            seg_lo = np.minimum(start, start + d * reach_mm)
            seg_hi = np.maximum(start, start + d * reach_mm)
            if np.any(seg_hi < o.lo) or np.any(seg_lo > o.hi):
                continue
            hit = float(ray_hits(o.mesh, start[None, :], d[None, :], reach_mm)[0])
            if hit < nearest:
                nearest, by = hit, o.id
        if by is None:
            open_dirs.append(name)
        else:
            blocked[name] = {"by": by, "distance_mm": round(nearest, 2)}
    return {"open": open_dirs, "blocked": blocked}
