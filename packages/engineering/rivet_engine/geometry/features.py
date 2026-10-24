"""Bounded features (holes, bosses, fillets, cut-outs, shells) on bodies.

B-rep bodies use exact OpenCascade booleans and fillets; freeform mesh bodies support
the additive/subtractive subset through manifold booleans. Every feature reports
applied / failed / skipped with a reason; nothing fails silently.
"""
from __future__ import annotations

import math

import numpy as np
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from ..design_ir.models import Feature
from . import occ
from .occ import GeometryError
from .parametric import hollow
from .transforms import AXES, from_rotation

_OTHER = {("X", "Y"): "Z", ("Y", "X"): "Z", ("X", "Z"): "Y", ("Z", "X"): "Y", ("Y", "Z"): "X", ("Z", "Y"): "X"}


def _basis(depth_axis: str, length_axis: str) -> tuple[np.ndarray, str]:
    """Rotation whose columns are (across, depth, length) for a tool built as box(x=across, y=depth, z=length)."""
    if length_axis == depth_axis:
        length_axis = {"X": "Z", "Y": "Z", "Z": "X"}[depth_axis]
    across_axis = _OTHER[(depth_axis, length_axis)]
    e_across, e_depth, e_len = AXES[across_axis], AXES[depth_axis], AXES[length_axis]
    r = np.column_stack([e_across, e_depth, e_len])
    if np.linalg.det(r) < 0:
        r[:, 0] = -r[:, 0]
    return r, across_axis


def _offsets(feature: Feature, repeat_axis: str) -> list[np.ndarray]:
    n = feature.count
    base = np.array(feature.position_mm, dtype=float)
    return [base + AXES[repeat_axis] * (i - (n - 1) / 2) * feature.spacing_mm for i in range(n)]


def _cyl(r: float, length: float):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, -length / 2, 0), gp_Dir(0, 1, 0)), r, length).Shape()


def _box(dx: float, dy: float, dz: float):
    return BRepPrimAPI_MakeBox(gp_Pnt(-dx / 2, -dy / 2, -dz / 2), dx, dy, dz).Shape()


def _stadium(width: float, length: float, depth: float):
    straight = max(length - width, 1e-3)
    parts = [_box(width, depth, straight)]
    for z in (-straight / 2, straight / 2):
        parts.append(occ.transform(_cyl(width / 2, depth), from_rotation(np.eye(3), (0, 0, z))))
    return occ.fuse_all(parts)


def _rounded_rect(width: float, length: float, depth: float):
    r = min(width, length) * 0.15
    if r < 0.2:
        return _box(width, depth, length)
    core = [_box(width - 2 * r, depth, length), _box(width, depth, length - 2 * r)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            core.append(occ.transform(_cyl(r, depth), from_rotation(np.eye(3), (sx * (width / 2 - r), 0, sz * (length / 2 - r)))))
    return occ.fuse_all(core)


def _placed(tool, rotation: np.ndarray, position: np.ndarray):
    return occ.transform(tool, from_rotation(rotation, position))


def _tools(feature: Feature) -> list:
    """Positioned tool solids for additive/subtractive features (body-local frame)."""
    t = feature.type
    if t in ("hole", "counterbore", "boss"):
        rot = _basis(feature.axis, {"X": "Z", "Y": "Z", "Z": "X"}[feature.axis])[0]  # tool's +Y onto the feature axis
        tools = []
        for p in _offsets(feature, feature.pattern_axis):
            if t == "boss":
                tools.append(_placed(_cyl(feature.radius_mm, feature.depth_mm), rot, p))
                continue
            tool = _cyl(feature.radius_mm, feature.depth_mm)
            if t == "counterbore":
                cb = occ.transform(_cyl(feature.counterbore_radius_mm, feature.counterbore_depth_mm),
                                   from_rotation(np.eye(3), (0, feature.depth_mm / 2 - feature.counterbore_depth_mm / 2, 0)))
                tool = occ.fuse(tool, cb)
            tools.append(_placed(tool, rot, p))
        return tools
    rot, across = _basis(feature.axis, feature.pattern_axis)
    if t == "rib":
        return [_placed(_box(feature.width_mm, feature.depth_mm, feature.length_mm), rot, p) for p in _offsets(feature, across)]
    if t == "slot":
        return [_placed(_stadium(feature.width_mm, feature.length_mm, feature.depth_mm), rot, p) for p in _offsets(feature, across)]
    if t == "window":
        return [_placed(_rounded_rect(feature.width_mm, feature.length_mm, feature.depth_mm), rot, p) for p in _offsets(feature, across)]
    if t == "pocket":
        return [_placed(_box(feature.width_mm, feature.depth_mm, feature.length_mm), rot, p) for p in _offsets(feature, across)]
    if t == "grill":
        return [_placed(_stadium(feature.width_mm, feature.length_mm, feature.depth_mm), rot, p) for p in _offsets(feature, across)]
    raise GeometryError(f"{t} has no tool solid")


def _select_edges(shape, which: str) -> list:
    lo, hi = occ.bounds(shape)
    tol = max(1e-3, float(np.max(hi - lo)) * 1e-4)
    out = []
    for e in occ.edges(shape):
        pts, is_line, direction = occ.edge_samples(e)
        y_span = float(pts[:, 1].max() - pts[:, 1].min())
        if which == "all":
            out.append(e)
        elif which == "vertical" and is_line and direction is not None and abs(direction[1]) > 0.99:
            out.append(e)
        elif which == "horizontal" and y_span < tol:
            out.append(e)
        elif which == "top" and pts[:, 1].min() >= hi[1] - tol:
            out.append(e)
        elif which == "bottom" and pts[:, 1].max() <= lo[1] + tol:
            out.append(e)
    return out


def _edge_op(shape, feature: Feature):
    edges = _select_edges(shape, feature.edges)
    if not edges:
        raise GeometryError(f"no {feature.edges} edges to {feature.type}")
    last_error = "kernel rejected the operation"
    for radius in (feature.radius_mm, feature.radius_mm * 0.5):
        mk = BRepFilletAPI_MakeFillet(shape) if feature.type == "fillet" else BRepFilletAPI_MakeChamfer(shape)
        for e in edges:
            mk.Add(radius, e)
        try:
            mk.Build()
        except Exception:  # noqa: BLE001
            continue
        if mk.IsDone():
            out = mk.Shape()
            if occ.is_valid(out):
                return out, radius
        last_error = f"{feature.type} of {radius:g} mm not possible on these edges"
    raise GeometryError(last_error)


def apply_brep(solid, features: list[Feature]):
    """Apply features in order; returns (solid, statuses)."""
    statuses = []
    for f in features:
        try:
            if f.type in ("fillet", "chamfer"):
                solid, used = _edge_op(solid, f)
                note = None if used == f.radius_mm else f"reduced to {used:g} mm to fit the edges"
                statuses.append({"id": f.id, "type": f.type, "status": "applied", "note": note})
                continue
            if f.type == "shell":
                solid = hollow(solid, f.wall_mm, f.open_face)
                statuses.append({"id": f.id, "type": f.type, "status": "applied", "note": None})
                continue
            before = occ.volume(solid)
            for tool in _tools(f):
                solid = occ.fuse(solid, tool) if f.type in ("boss", "rib") else occ.cut(solid, tool)
            after = occ.volume(solid)
            if abs(after - before) < 1e-6:
                statuses.append({"id": f.id, "type": f.type, "status": "skipped", "note": "the feature does not touch the body (check its position)"})
            else:
                statuses.append({"id": f.id, "type": f.type, "status": "applied", "note": None})
        except Exception as exc:  # noqa: BLE001 - report and continue with the last valid solid
            statuses.append({"id": f.id, "type": f.type, "status": "failed", "note": str(exc) if isinstance(exc, GeometryError) else "geometry kernel error"})
    if not occ.is_valid(solid):
        raise GeometryError("features left an invalid solid")
    return solid, statuses


def _manifold_tool(feature: Feature):
    import manifold3d

    def cyl(r, length):
        return manifold3d.Manifold.cylinder(length, r, r, 48, True).rotate([-90, 0, 0])  # along Y, centred

    def box(dx, dy, dz):
        return manifold3d.Manifold.cube([dx, dy, dz], True)

    t = feature.type
    if t in ("hole", "counterbore", "boss"):
        rot = _basis(feature.axis, {"X": "Z", "Y": "Z", "Z": "X"}[feature.axis])[0]
        tools = []
        for p in _offsets(feature, feature.pattern_axis):
            tool = cyl(feature.radius_mm, feature.depth_mm)
            if t == "counterbore":
                tool = tool + cyl(feature.counterbore_radius_mm, feature.counterbore_depth_mm).translate([0, feature.depth_mm / 2 - feature.counterbore_depth_mm / 2, 0])
            tools.append(_mtransform(tool, rot, p))
        return tools
    rot, across = _basis(feature.axis, feature.pattern_axis)
    tools = []
    for p in _offsets(feature, across):
        if t in ("slot", "grill"):
            straight = max(feature.length_mm - feature.width_mm, 1e-3)
            tool = box(feature.width_mm, feature.depth_mm, straight)
            for z in (-straight / 2, straight / 2):
                tool = tool + cyl(feature.width_mm / 2, feature.depth_mm).translate([0, 0, z])
        else:
            tool = box(feature.width_mm, feature.depth_mm, feature.length_mm)
        tools.append(_mtransform(tool, rot, p))
    return tools


def _mtransform(m, rot: np.ndarray, pos: np.ndarray):
    affine = np.hstack([rot, np.asarray(pos, dtype=float).reshape(3, 1)])
    return m.transform(affine.tolist())


def apply_mesh(manifold, features: list[Feature]):
    """Subset of features on a freeform (manifold) body; returns (manifold, statuses)."""
    statuses = []
    for f in features:
        if f.type in ("fillet", "chamfer", "shell"):
            statuses.append({"id": f.id, "type": f.type, "status": "skipped", "note": f"{f.type} needs a parametric (B-rep) body; not applied to a freeform mesh"})
            continue
        try:
            before = manifold.volume()
            for tool in _manifold_tool(f):
                manifold = manifold + tool if f.type in ("boss", "rib") else manifold - tool
            changed = not math.isclose(before, manifold.volume(), rel_tol=1e-9, abs_tol=1e-6)
            statuses.append({"id": f.id, "type": f.type, "status": "applied" if changed else "skipped",
                             "note": None if changed else "the feature does not touch the body (check its position)"})
        except Exception:  # noqa: BLE001
            statuses.append({"id": f.id, "type": f.type, "status": "failed", "note": "mesh boolean failed"})
    return manifold, statuses
