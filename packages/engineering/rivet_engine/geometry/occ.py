"""Thin, deterministic helpers over the OpenCascade (OCP) B-rep kernel."""
from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from pathlib import Path

import numpy as np
from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_GTransform,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_Transform,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.GeomAbs import GeomAbs_CurveType, GeomAbs_SurfaceType
from OCP.gp import gp_GTrsf, gp_Mat, gp_Pnt, gp_Trsf, gp_XYZ
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.Interface import Interface_Static
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer
from OCP.TopAbs import TopAbs_Orientation, TopAbs_ShapeEnum
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Shape

from .meshing import TriMesh

OCCT_KERNEL = "OpenCascade 7.9.3 (OCP)"


def _quiet_kernel() -> None:
    """OpenCascade prints transfer statistics to stdout; keep only failures."""
    from OCP.Message import Message, Message_Gravity

    printers = Message.DefaultMessenger_s().Printers()
    for i in range(printers.Lower(), printers.Upper() + 1):
        printers.Value(i).SetTraceLevel(Message_Gravity.Message_Fail)


_quiet_kernel()


class GeometryError(Exception):
    """A B-rep operation failed; carries a short, user-safe reason."""


def trsf_from_matrix(m: np.ndarray) -> gp_Trsf:
    t = gp_Trsf()
    t.SetValues(*[float(m[r, c]) for r in range(3) for c in range(4)])
    return t


def transform(shape: TopoDS_Shape, m: np.ndarray) -> TopoDS_Shape:
    if np.allclose(m, np.eye(4)):
        return shape
    return BRepBuilderAPI_Transform(shape, trsf_from_matrix(m), True).Shape()


def scale_xyz(shape: TopoDS_Shape, sx: float, sy: float, sz: float) -> TopoDS_Shape:
    g = gp_GTrsf()
    g.SetVectorialPart(gp_Mat(sx, 0, 0, 0, sy, 0, 0, 0, sz))
    g.SetTranslationPart(gp_XYZ(0, 0, 0))
    return BRepBuilderAPI_GTransform(shape, g, True).Shape()


def polygon_face(points: Sequence[Sequence[float]]):
    poly = BRepBuilderAPI_MakePolygon()
    last = None
    for p in points:
        q = (float(p[0]), float(p[1]), float(p[2]))
        if last is not None and np.allclose(q, last, atol=1e-7):
            continue
        poly.Add(gp_Pnt(*q))
        last = q
    poly.Close()
    if not poly.IsDone():
        raise GeometryError("profile polygon is degenerate")
    face = BRepBuilderAPI_MakeFace(poly.Wire(), True)
    if not face.IsDone():
        raise GeometryError("profile polygon does not form a planar face")
    return face.Face()


def polygon_wire(points: Sequence[Sequence[float]], closed: bool = True):
    poly = BRepBuilderAPI_MakePolygon()
    for p in points:
        poly.Add(gp_Pnt(float(p[0]), float(p[1]), float(p[2])))
    if closed:
        poly.Close()
    if not poly.IsDone():
        raise GeometryError("polyline is degenerate")
    return poly.Wire()


def unify(shape: TopoDS_Shape) -> TopoDS_Shape:
    u = ShapeUpgrade_UnifySameDomain(shape, True, True, True)
    u.Build()
    return u.Shape()


def _boolean(kind, a: TopoDS_Shape, b: TopoDS_Shape, label: str) -> TopoDS_Shape:
    op = kind(a, b)
    if not op.IsDone():
        raise GeometryError(f"{label} failed")
    out = op.Shape()
    if out.IsNull():
        raise GeometryError(f"{label} produced no solid")
    return out


def fuse(a: TopoDS_Shape, b: TopoDS_Shape) -> TopoDS_Shape:
    return unify(_boolean(BRepAlgoAPI_Fuse, a, b, "union"))


def cut(a: TopoDS_Shape, b: TopoDS_Shape) -> TopoDS_Shape:
    return unify(_boolean(BRepAlgoAPI_Cut, a, b, "difference"))


def common(a: TopoDS_Shape, b: TopoDS_Shape) -> TopoDS_Shape:
    return unify(_boolean(BRepAlgoAPI_Common, a, b, "intersection"))


def fuse_all(shapes: Iterable[TopoDS_Shape]) -> TopoDS_Shape:
    shapes = list(shapes)
    if not shapes:
        raise GeometryError("nothing to combine")
    out = shapes[0]
    for s in shapes[1:]:
        out = _boolean(BRepAlgoAPI_Fuse, out, s, "union")
    return unify(out) if len(shapes) > 1 else out


def is_valid(shape: TopoDS_Shape) -> bool:
    return not shape.IsNull() and BRepCheck_Analyzer(shape).IsValid()


def volume(shape: TopoDS_Shape) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return float(props.Mass())


def bounds(shape: TopoDS_Shape) -> tuple[np.ndarray, np.ndarray]:
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, True, False)
    if box.IsVoid():
        raise GeometryError("shape has no extent")
    x0, y0, z0, x1, y1, z1 = box.Get()
    return np.array([x0, y0, z0]), np.array([x1, y1, z1])


def count(shape: TopoDS_Shape, kind) -> int:
    n, exp = 0, TopExp_Explorer(shape, kind)
    while exp.More():
        n += 1
        exp.Next()
    return n


def faces(shape: TopoDS_Shape) -> list:
    out, exp = [], TopExp_Explorer(shape, TopAbs_ShapeEnum.TopAbs_FACE)
    while exp.More():
        out.append(TopoDS.Face_s(exp.Current()))
        exp.Next()
    return out


def edges(shape: TopoDS_Shape) -> list:
    out, seen, exp = [], [], TopExp_Explorer(shape, TopAbs_ShapeEnum.TopAbs_EDGE)
    while exp.More():
        e = TopoDS.Edge_s(exp.Current())
        if not any(e.IsSame(s) for s in seen):
            seen.append(e)
            out.append(e)
        exp.Next()
    return out


def edge_samples(edge, n: int = 5) -> tuple[np.ndarray, bool, np.ndarray | None]:
    """Sample points along an edge; returns (points, is_line, line_direction)."""
    curve = BRepAdaptor_Curve(edge)
    a, b = curve.FirstParameter(), curve.LastParameter()
    pts = []
    for i in range(n):
        p = curve.Value(a + (b - a) * i / (n - 1))
        pts.append((p.X(), p.Y(), p.Z()))
    is_line = curve.GetType() == GeomAbs_CurveType.GeomAbs_Line
    direction = None
    if is_line:
        d = curve.Line().Direction()
        direction = np.array([d.X(), d.Y(), d.Z()])
    return np.array(pts), is_line, direction


def planar_face_normal(face) -> tuple[np.ndarray, np.ndarray] | None:
    """(outward normal, centre) for planar faces, else None."""
    surf = BRepAdaptor_Surface(face)
    if surf.GetType() != GeomAbs_SurfaceType.GeomAbs_Plane:
        return None
    d = surf.Plane().Axis().Direction()
    n = np.array([d.X(), d.Y(), d.Z()])
    if face.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
        n = -n
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    c = props.CentreOfMass()
    return n, np.array([c.X(), c.Y(), c.Z()])


def tessellate(shape: TopoDS_Shape, linear_deflection: float, angular_deflection: float = 0.35) -> TriMesh:
    """Deterministic (single-threaded) triangulation; one face group per B-rep face."""
    BRepMesh_IncrementalMesh(shape, float(linear_deflection), False, float(angular_deflection), False)
    verts: list[np.ndarray] = []
    tris: list[np.ndarray] = []
    groups: list[np.ndarray] = []
    offset = 0
    for index, face in enumerate(faces(shape)):
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            continue
        trsf = loc.Transformation()
        nodes = np.empty((tri.NbNodes(), 3))
        for i in range(1, tri.NbNodes() + 1):
            p = tri.Node(i).Transformed(trsf)
            nodes[i - 1] = (p.X(), p.Y(), p.Z())
        t = np.empty((tri.NbTriangles(), 3), dtype=np.int64)
        for i in range(1, tri.NbTriangles() + 1):
            t[i - 1] = tri.Triangle(i).Get()
        t -= 1
        if face.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
            t = t[:, ::-1]
        verts.append(nodes)
        tris.append(t + offset)
        groups.append(np.full(len(t), index, dtype=np.int64))
        offset += len(nodes)
    if not tris:
        raise GeometryError("shape produced no triangles")
    return TriMesh(np.vstack(verts), np.vstack(tris), np.concatenate(groups))


_STEP_STAMP = re.compile(rb"(FILE_NAME\('[^']*',')[^']*(')")


def write_step(shape: TopoDS_Shape, path: Path) -> None:
    """Single-shape STEP (AP214) with a fixed header timestamp so files are reproducible."""
    writer = STEPControl_Writer()
    Interface_Static.SetCVal_s("write.step.schema", "AP214")
    Interface_Static.SetCVal_s("write.step.unit", "MM")
    if writer.Transfer(shape, STEPControl_StepModelType.STEPControl_AsIs) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise GeometryError("STEP transfer failed")
    if writer.Write(str(path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise GeometryError("STEP write failed")
    normalize_step(path)


def normalize_step(path: Path) -> None:
    data = Path(path).read_bytes()
    Path(path).write_bytes(_STEP_STAMP.sub(rb"\g<1>2026-01-01T00:00:00\g<2>", data, count=1))


def write_step_assembly(parts: list[tuple[str, TopoDS_Shape, np.ndarray, str]], path: Path) -> None:
    """Named, coloured STEP assembly (XCAF): parts are (name, local shape, world matrix mm, hex colour)."""
    from OCP.Quantity import Quantity_Color, Quantity_TypeOfColor
    from OCP.STEPCAFControl import STEPCAFControl_Writer
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDataStd import TDataStd_Name
    from OCP.TDocStd import TDocStd_Document
    from OCP.XCAFDoc import XCAFDoc_ColorType, XCAFDoc_DocumentTool

    doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    assembly = shape_tool.NewShape()
    TDataStd_Name.Set_s(assembly, TCollection_ExtendedString("rivet-assembly"))
    for name, shape, world, color in parts:
        label = shape_tool.AddShape(shape, False)
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(name))
        h = color.lstrip("#")
        rgb = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
        color_tool.SetColor(label, Quantity_Color(rgb[0], rgb[1], rgb[2], Quantity_TypeOfColor.Quantity_TOC_sRGB), XCAFDoc_ColorType.XCAFDoc_ColorGen)
        component = shape_tool.AddComponent(assembly, label, TopLoc_Location(trsf_from_matrix(world)))
        TDataStd_Name.Set_s(component, TCollection_ExtendedString(name))
    shape_tool.UpdateAssemblies()
    Interface_Static.SetCVal_s("write.step.schema", "AP214")
    Interface_Static.SetCVal_s("write.step.unit", "MM")
    writer = STEPCAFControl_Writer()
    writer.SetNameMode(True)
    writer.SetColorMode(True)
    if not writer.Transfer(doc, STEPControl_StepModelType.STEPControl_AsIs):
        raise GeometryError("STEP assembly transfer failed")
    if writer.Write(str(path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise GeometryError("STEP assembly write failed")
    normalize_step(path)
