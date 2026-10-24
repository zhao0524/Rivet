"""Path A: dimensioned B-rep solids from semantic shapes (OpenCascade).

Every axis-oriented primitive is built along local +Y and then turned onto its axis, so
profiles map consistently (see transforms.align_y_to). Builders return named regions so
one body can carry several material zones (a wheel's tyre and hub).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_TransitionMode
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepOffsetAPI import (
    BRepOffsetAPI_MakeOffsetShape,
    BRepOffsetAPI_MakePipeShell,
    BRepOffsetAPI_MakeThickSolid,
    BRepOffsetAPI_ThruSections,
)
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeRevol,
    BRepPrimAPI_MakeSphere,
    BRepPrimAPI_MakeTorus,
)
from OCP.gp import gp_Ax1, gp_Ax2, gp_Circ, gp_Dir, gp_Pnt, gp_Vec
from OCP.TopTools import TopTools_ListOfShape

from ..design_ir.models import Shape
from . import occ
from .occ import GeometryError
from .transforms import align_y_to, from_rotation, matrix

TYRE_MATERIAL = {"name": "rubber", "color": "#1d2024", "metallic": 0.0, "roughness": 0.92}


@dataclass
class BrepRegion:
    name: str
    shape: object  # TopoDS_Shape
    material: dict | None = None


def _axis_matrix(axis: str) -> np.ndarray:
    return from_rotation(align_y_to(axis))


def _box(dx: float, dy: float, dz: float):
    return BRepPrimAPI_MakeBox(gp_Pnt(-dx / 2, -dy / 2, -dz / 2), dx, dy, dz).Shape()


def _cylinder_y(r: float, h: float, y0: float | None = None):
    base = -h / 2 if y0 is None else y0
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, base, 0), gp_Dir(0, 1, 0)), r, h).Shape()


def fillet_all(shape, radius: float):
    mk = BRepFilletAPI_MakeFillet(shape)
    for e in occ.edges(shape):
        mk.Add(radius, e)
    mk.Build()
    if not mk.IsDone():
        raise GeometryError("fillet failed")
    return mk.Shape()


def _rounded_box(dims, radius: float):
    solid = _box(*dims)
    try:
        return fillet_all(solid, radius)
    except Exception:  # noqa: BLE001 - kernel exceptions are opaque
        return fillet_all(solid, radius * 0.5)


def _capsule_y(r: float, length: float):
    straight = max(0.0, length - 2 * r)
    if straight < 1e-6:
        return BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), r).Shape()
    body = _cylinder_y(r, straight)
    top = BRepPrimAPI_MakeSphere(gp_Pnt(0, straight / 2, 0), r).Shape()
    bottom = BRepPrimAPI_MakeSphere(gp_Pnt(0, -straight / 2, 0), r).Shape()
    return occ.fuse(occ.fuse(body, top), bottom)


def _cone_y(r1: float, r2: float, h: float):
    if abs(r1 - r2) < 1e-6:
        return _cylinder_y(r1, h)
    return BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, -h / 2, 0), gp_Dir(0, 1, 0)), r1, r2, h).Shape()


def _extrude_y(profile, h: float):
    face = occ.polygon_face([(a, -h / 2, b) for a, b in profile])
    return BRepPrimAPI_MakePrism(face, gp_Vec(0, h, 0)).Shape()


def _revolve_y(profile, angle_deg: float):
    pts = [(max(0.0, r), y, 0.0) for r, y in profile]
    face = occ.polygon_face(pts)
    solid = BRepPrimAPI_MakeRevol(face, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), math.radians(angle_deg)).Shape()
    if occ.volume(solid) <= 0:
        raise GeometryError("revolved profile has no volume (profile lies on the axis?)")
    return solid


def _resample(poly: list[tuple[float, float]], n: int) -> list[tuple[float, float]]:
    pts = np.array(poly, dtype=float)
    area = 0.5 * float(np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1]))
    if area < 0:
        pts = pts[::-1]
    centre = pts.mean(axis=0)
    start = int(np.argmin(np.abs(np.arctan2(pts[:, 1] - centre[1], pts[:, 0] - centre[0]))))
    pts = np.roll(pts, -start, axis=0)
    closed = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    total = cum[-1]
    if total <= 0:
        raise GeometryError("loft section has no perimeter")
    out = []
    for t in np.linspace(0, total, n, endpoint=False):
        i = int(np.searchsorted(cum, t, side="right") - 1)
        i = min(i, len(seg) - 1)
        f = (t - cum[i]) / seg[i] if seg[i] > 0 else 0
        out.append(tuple(closed[i] + f * (closed[i + 1] - closed[i])))
    return out


def _loft_y(sections, heights, ruled: bool):
    n = max(8, max(len(s) for s in sections) * 2)
    ts = BRepOffsetAPI_ThruSections(True, ruled, 1e-6)
    for section, y in zip(sections, heights):
        pts = _resample([tuple(p) for p in section], n)
        ts.AddWire(occ.polygon_wire([(a, y, b) for a, b in pts]))
    ts.Build()
    if not ts.IsDone():
        raise GeometryError("loft failed")
    shape = ts.Shape()
    mid = (heights[0] + heights[-1]) / 2
    return occ.transform(shape, matrix((0, -mid, 0)))


def _sweep(shape: Shape):
    path = [np.array(p, dtype=float) for p in shape.path_mm]
    clean = [path[0]]
    for p in path[1:]:
        if np.linalg.norm(p - clean[-1]) > 1e-6:
            clean.append(p)
    if len(clean) < 2:
        raise GeometryError("sweep path has no length")
    first = clean[1] - clean[0]
    first /= np.linalg.norm(first)
    try:
        spine = occ.polygon_wire([tuple(p) for p in clean], closed=False)
        if shape.profile_mm:
            ref = np.array([0.0, 1.0, 0.0]) if abs(first[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
            u = np.cross(ref, first)
            u /= np.linalg.norm(u)
            v = np.cross(first, u)
            profile = occ.polygon_wire([tuple(clean[0] + a * u + b * v) for a, b in shape.profile_mm])
        else:
            circ = gp_Circ(gp_Ax2(gp_Pnt(*clean[0]), gp_Dir(*first)), shape.radius_mm)
            profile = BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circ).Edge()).Wire()
        pipe = BRepOffsetAPI_MakePipeShell(spine)
        pipe.SetTransitionMode(BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RoundCorner)
        pipe.Add(profile, False, True)
        pipe.Build()
        if not pipe.IsDone() or not pipe.MakeSolid():
            raise GeometryError("pipe failed")
        solid = pipe.Shape()
        if not occ.is_valid(solid) or occ.volume(solid) <= 0:
            raise GeometryError("pipe produced an invalid solid")
        return solid
    except Exception:  # noqa: BLE001 - fall back to a segment chain (same centreline)
        if shape.profile_mm:
            raise GeometryError("polygon-profile sweep failed on this path") from None
        r = shape.radius_mm
        parts = []
        for a, b in zip(clean, clean[1:]):
            d = b - a
            length = float(np.linalg.norm(d))
            cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*a), gp_Dir(*(d / length))), r, length).Shape()
            parts.append(cyl)
        for p in clean:
            parts.append(BRepPrimAPI_MakeSphere(gp_Pnt(*p), r).Shape())
        return occ.fuse_all(parts)


def _open_face(solid, direction: str):
    axis = {"top": (1, 1), "bottom": (1, -1), "right": (0, 1), "left": (0, -1), "front": (2, 1), "back": (2, -1)}[direction]
    want = np.zeros(3)
    want[axis[0]] = axis[1]
    best, best_coord = None, -math.inf
    for f in occ.faces(solid):
        info = occ.planar_face_normal(f)
        if info is None:
            continue
        n, c = info
        if float(np.dot(n, want)) > 0.98 and c[axis[0]] * axis[1] > best_coord:
            best, best_coord = f, c[axis[0]] * axis[1]
    if best is None:
        raise GeometryError(f"no flat {direction} face to open")
    return best


_OPEN_DIR = {"top": (0, 1, 0), "bottom": (0, -1, 0), "right": (1, 0, 0), "left": (-1, 0, 0), "front": (0, 0, 1), "back": (0, 0, -1)}


def hollow(solid, wall: float, open_face: str):
    original = occ.volume(solid)
    if open_face != "none":
        out = None
        try:
            removed = TopTools_ListOfShape()
            removed.Append(_open_face(solid, open_face))
            mk = BRepOffsetAPI_MakeThickSolid()
            mk.MakeThickSolidByJoin(solid, removed, -wall, 1e-3)
            mk.Build()
            if mk.IsDone():
                out = mk.Shape()
        except Exception:  # noqa: BLE001 - fall back below
            out = None
        # The kernel can return the input unchanged (e.g. on filleted faces): treat as failure.
        if out is None or not occ.is_valid(out) or occ.volume(out) > 0.995 * original:
            closed = hollow(solid, wall, "none")
            inner = occ.cut(solid, closed)
            push = np.array(_OPEN_DIR[open_face], dtype=float) * (wall + 0.5)
            out = occ.cut(closed, occ.transform(inner, matrix(tuple(push))))
            if occ.volume(out) >= occ.volume(closed) - 1e-6:
                raise GeometryError(f"could not open the {open_face} face of the shell")
    else:
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid
        from OCP.BRepLib import BRepLib
        from OCP.TopAbs import TopAbs_ShapeEnum
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopoDS import TopoDS

        def as_solid(shape):
            if shape.ShapeType() == TopAbs_ShapeEnum.TopAbs_SOLID:
                return shape
            exp = TopExp_Explorer(shape, TopAbs_ShapeEnum.TopAbs_SOLID)
            if exp.More():
                return TopoDS.Solid_s(exp.Current())
            exp = TopExp_Explorer(shape, TopAbs_ShapeEnum.TopAbs_SHELL)
            if not exp.More():
                return None
            made = BRepBuilderAPI_MakeSolid(TopoDS.Shell_s(exp.Current())).Solid()
            BRepLib.OrientClosedSolid_s(made)
            return made

        inner = None
        for method in ("join", "simple"):
            try:
                mk = BRepOffsetAPI_MakeOffsetShape()
                if method == "join":
                    mk.PerformByJoin(solid, -wall, 1e-3)
                else:
                    mk.PerformBySimple(solid, -wall)
                if mk.IsDone():
                    inner = as_solid(mk.Shape())
            except Exception:  # noqa: BLE001 - try the next offset algorithm
                inner = None
            if inner is not None and 0 < occ.volume(inner) < original:
                break
            inner = None
        if inner is None:
            raise GeometryError("inner offset failed")
        out = occ.cut(solid, inner)
    if not occ.is_valid(out) or occ.volume(out) <= 0:
        raise GeometryError("shelling produced an invalid solid")
    return out


def _wheel(shape: Shape) -> list[BrepRegion]:
    R, w, t = shape.radius_mm, shape.height_mm, shape.wall_mm
    c = min(t, w) * 0.3
    inner = R - t
    tyre_profile = [(inner, -w / 2), (R - c, -w / 2), (R, -w / 2 + c), (R, w / 2 - c), (R - c, w / 2), (inner, w / 2)]
    tyre = _revolve_y(tyre_profile, 360)
    hub_w = w * 0.72
    if shape.spokes > 0:
        rim = occ.cut(_cylinder_y(inner, hub_w), _cylinder_y(inner * 0.8, hub_w * 1.2))
        boss_r = max(inner * 0.22, 1.0)
        parts = [rim, _cylinder_y(boss_r, w * 0.86)]
        for i in range(shape.spokes):
            ang = 2 * math.pi * i / shape.spokes
            length = inner * 0.82 - boss_r * 0.6
            spoke = _box(max(inner * 0.12, 1.0), hub_w * 0.45, length)
            mid = boss_r * 0.6 + length / 2
            m = matrix((math.sin(ang) * mid, 0, math.cos(ang) * mid), (0, math.degrees(ang), 0))
            parts.append(occ.transform(spoke, m))
        hub = occ.fuse_all(parts)
    else:
        hub = occ.fuse(_cylinder_y(inner, hub_w * 0.6), _cylinder_y(max(inner * 0.28, 1.0), w * 0.86))
    return [BrepRegion("tyre", tyre, dict(TYRE_MATERIAL)), BrepRegion("hub", hub, None)]


def build_regions(shape: Shape) -> list[BrepRegion]:
    """Build a shape (in its own frame) into one or more named B-rep regions."""
    t = shape.type
    axis_m = _axis_matrix(shape.resolved_axis)
    if t in ("box", "plate"):
        regions = [BrepRegion("main", _box(*shape.dimensions_mm))]
    elif t == "rounded_box":
        regions = [BrepRegion("main", _rounded_box(shape.dimensions_mm, shape.radius_mm))]
    elif t == "sphere":
        regions = [BrepRegion("main", BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), shape.radius_mm).Shape())]
    elif t == "ellipsoid":
        unit = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 1.0).Shape()
        dx, dy, dz = (d / 2 for d in shape.dimensions_mm)
        regions = [BrepRegion("main", occ.scale_xyz(unit, dx, dy, dz))]
    elif t == "cylinder":
        regions = [BrepRegion("main", occ.transform(_cylinder_y(shape.radius_mm, shape.height_mm), axis_m))]
    elif t == "tube":
        outer = _cylinder_y(shape.radius_mm, shape.height_mm)
        inner = _cylinder_y(shape.radius_mm - shape.wall_mm, shape.height_mm * 1.01 + 0.2)
        regions = [BrepRegion("main", occ.transform(occ.cut(outer, inner), axis_m))]
    elif t == "cone":
        regions = [BrepRegion("main", occ.transform(_cone_y(shape.radius_mm, shape.radius_top_mm, shape.height_mm), axis_m))]
    elif t == "capsule":
        regions = [BrepRegion("main", occ.transform(_capsule_y(shape.radius_mm, shape.height_mm), axis_m))]
    elif t == "torus":
        tor = BRepPrimAPI_MakeTorus(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), shape.radius_mm, shape.minor_radius_mm).Shape()
        regions = [BrepRegion("main", occ.transform(tor, axis_m))]
    elif t == "wheel":
        regions = [BrepRegion(r.name, occ.transform(r.shape, axis_m), r.material) for r in _wheel(shape)]
    elif t == "extrude_profile":
        regions = [BrepRegion("main", occ.transform(_extrude_y(shape.profile_mm, shape.height_mm), axis_m))]
    elif t == "revolve_profile":
        regions = [BrepRegion("main", occ.transform(_revolve_y(shape.profile_mm, shape.angle_deg), axis_m))]
    elif t == "loft":
        regions = [BrepRegion("main", occ.transform(_loft_y(shape.sections, shape.section_heights_mm, shape.ruled), axis_m))]
    elif t == "sweep":
        regions = [BrepRegion("main", _sweep(shape))]
    elif t == "shell":
        child = merge_regions(build_regions(shape.children[0]))
        regions = [BrepRegion("main", hollow(child, shape.wall_mm, shape.open_face))]
    elif t == "boolean":
        solids = [merge_regions(build_regions(c)) for c in shape.children]
        out = solids[0]
        for s in solids[1:]:
            out = occ.fuse(out, s) if shape.operation == "union" else occ.cut(out, s) if shape.operation == "difference" else occ.common(out, s)
        if occ.volume(out) <= 1e-6:
            raise GeometryError(f"{shape.operation} left no material")
        regions = [BrepRegion("main", out)]
    else:
        raise GeometryError(f"{t} is not a parametric shape")
    m = matrix(shape.frame.position_mm, shape.frame.rotation_deg)
    out = []
    for r in regions:
        s = occ.transform(r.shape, m)
        if not occ.is_valid(s):
            s = _fix(s)
        out.append(BrepRegion(r.name, s, r.material))
    return out


def _fix(shape):
    from OCP.ShapeFix import ShapeFix_Shape

    fixer = ShapeFix_Shape(shape)
    fixer.Perform()
    fixed = fixer.Shape()
    if not occ.is_valid(fixed):
        raise GeometryError("solid is not valid after construction")
    return fixed


def merge_regions(regions: list[BrepRegion]):
    return occ.fuse_all([r.shape for r in regions]) if len(regions) > 1 else regions[0].shape
