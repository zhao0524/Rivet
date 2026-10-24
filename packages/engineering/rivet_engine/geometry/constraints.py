"""Attachment solver: world transforms from named anchors, never from model-written poses.

Anchor frames have +Y along the outward normal of the mating face and +Z along the
face's "up" tangent (the body's +Y projected onto the face, or its +Z on top/bottom
faces). A child meets its parent with the normals opposed and the up tangents aligned.
Offsets, rotations and joint axes are expressed in the PARENT body's axes (x right,
y up, z front), about the parent anchor point p:

    world_child = world_parent * T(offset) * T(p) * R(rotation) * J(joint) * T(-p) * A_parent * S * inverse(A_child)

with S a half turn about the anchor's Z. Implicit anchors are named by face first, then
optional edge/corner words: "top", "front_top" (front face, top edge), "left_bottom_back".
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..design_ir.models import Anchor, DesignBody, DesignSpec, implicit_anchor_axes
from .transforms import AXES, apply, frame_from_normal, inverse, matrix, rotation_about, from_rotation, translation

_FACE = {"left": (0, -1), "right": (0, 1), "bottom": (1, -1), "top": (1, 1), "back": (2, -1), "front": (2, 1), "center": None}
_S = from_rotation(np.diag([-1.0, -1.0, 1.0]))


class UnresolvedAnchor(Exception):
    pass


def anchor_local_frame(bounds: tuple[np.ndarray, np.ndarray], anchors: list[Anchor], name: str) -> np.ndarray:
    for a in anchors:
        if a.id == name:
            return matrix(a.frame.position_mm, a.frame.rotation_deg)
    signs = implicit_anchor_axes(name)
    if signs is None:
        raise UnresolvedAnchor(f"unknown anchor {name!r}")
    lo, hi = bounds
    centre = (lo + hi) / 2
    half = (hi - lo) / 2
    position = centre + np.array(signs, dtype=float) * half
    first = name.lower().replace("-", "_").split("_")[0]
    face = _FACE[first]
    if face is None:
        return translation(position)
    normal = np.zeros(3)
    normal[face[0]] = face[1]
    hint = AXES["Z"] if face[0] == 1 else AXES["Y"]
    return frame_from_normal(position, normal, hint)


def joint_matrix(kind: str, axis: str, value: float) -> np.ndarray:
    if kind in ("hinge", "shaft") and value:
        return from_rotation(rotation_about(AXES[axis], value))
    if kind == "slide" and value:
        return translation(AXES[axis] * value)
    return np.eye(4)


@dataclass
class SolveResult:
    world: dict[str, np.ndarray]
    depth: dict[str, int]
    order: list[str]
    unresolved: list[dict] = field(default_factory=list)
    joints: list[dict] = field(default_factory=list)
    grounding_shift_mm: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])

    def subtree(self, body_id: str, spec: DesignSpec) -> list[str]:
        children: dict[str, list[str]] = {}
        for b in spec.bodies:
            if b.parent_id:
                children.setdefault(b.parent_id, []).append(b.id)
        out, stack = [], [body_id]
        while stack:
            cur = stack.pop()
            out.append(cur)
            stack.extend(children.get(cur, []))
        return out


def topological_order(spec: DesignSpec) -> list[DesignBody]:
    by_id = {b.id: b for b in spec.bodies}
    placed: list[DesignBody] = []
    done: set[str] = set()
    pending = list(spec.bodies)
    while pending:
        progressed = False
        for b in list(pending):
            if b.parent_id is None or b.parent_id in done:
                placed.append(b)
                done.add(b.id)
                pending.remove(b)
                progressed = True
        if not progressed:  # validated specs are acyclic; guard anyway
            raise ValueError(f"cannot order bodies (cycle?): {[b.id for b in pending]}")
    assert len(placed) == len(by_id)
    return placed


def solve(spec: DesignSpec, local_bounds: dict[str, tuple[np.ndarray, np.ndarray] | None],
          joint_values: dict[str, float] | None = None, ground: bool = True) -> SolveResult:
    order = topological_order(spec)
    world: dict[str, np.ndarray] = {}
    depth: dict[str, int] = {}
    result = SolveResult(world, depth, [b.id for b in order])
    by_id = {b.id: b for b in spec.bodies}
    for body in order:
        bounds = local_bounds.get(body.id)
        if body.parent_id is None:
            if bounds is None:
                result.unresolved.append({"body_id": body.id, "reason": "body geometry failed, so it cannot be placed"})
                continue
            world[body.id] = matrix(body.frame.position_mm, body.frame.rotation_deg)
            depth[body.id] = 0
            continue
        parent = by_id[body.parent_id]
        att = body.attachment
        assert att is not None
        if body.parent_id not in world:
            result.unresolved.append({"body_id": body.id, "reason": f"parent {body.parent_id!r} could not be placed"})
            continue
        if bounds is None:
            result.unresolved.append({"body_id": body.id, "reason": "body geometry failed, so it cannot be placed"})
            continue
        try:
            a_p = anchor_local_frame(local_bounds[parent.id], parent.anchors, att.parent_anchor)
            a_c = anchor_local_frame(bounds, body.anchors, att.child_anchor)
        except UnresolvedAnchor as exc:
            result.unresolved.append({"body_id": body.id, "reason": str(exc)})
            continue
        value = (joint_values or {}).get(body.id, att.value)
        offset = np.array(att.offset_mm, dtype=float)
        if att.contact == "clearance":
            offset = offset + a_p[:3, 1] * att.clearance_mm
        p = a_p[:3, 3]
        pivot = translation(offset) @ translation(p) @ matrix((0, 0, 0), att.rotation_deg) @ joint_matrix(att.joint, att.axis, value) @ translation(-p)
        m = pivot @ a_p @ _S @ inverse(a_c)
        world[body.id] = world[parent.id] @ m
        depth[body.id] = depth[parent.id] + 1
        frame_world = world[parent.id] @ translation(offset) @ a_p
        result.joints.append({
            "body_id": body.id,
            "parent_id": parent.id,
            "joint": att.joint,
            "parent_anchor": att.parent_anchor,
            "child_anchor": att.child_anchor,
            "position_mm": [round(float(v), 4) for v in frame_world[:3, 3]],
            "normal": [round(float(v), 6) for v in frame_world[:3, 1]],
            "axis_world": [round(float(v), 6) for v in (world[parent.id][:3, :3] @ AXES[att.axis])],
            "value": value,
            "limits": list(att.limits),
            "contact": att.contact,
            "fasteners": att.fasteners.model_dump() if att.fasteners else None,
        })
    if ground and world:
        lo = np.full(3, np.inf)
        hi = np.full(3, -np.inf)
        for body_id, m in world.items():
            b = local_bounds[body_id]
            corners = np.array([[x, y, z] for x in (b[0][0], b[1][0]) for y in (b[0][1], b[1][1]) for z in (b[0][2], b[1][2])])
            w = apply(m, corners)
            lo, hi = np.minimum(lo, w.min(axis=0)), np.maximum(hi, w.max(axis=0))
        shift = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
        t = translation(shift)
        for body_id in world:
            world[body_id] = t @ world[body_id]
        for j in result.joints:
            j["position_mm"] = [round(float(v + s), 4) for v, s in zip(j["position_mm"], shift)]
        result.grounding_shift_mm = [round(float(v), 4) for v in shift]
    return result
