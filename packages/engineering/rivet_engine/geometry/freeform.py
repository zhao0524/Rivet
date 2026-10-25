"""Path B: organic and imported geometry.

`occupancy` shapes are signed-distance blends of primitives (smooth union, difference,
intersection, optional hollowing) sampled on a regular grid and meshed with a
vectorized marching-tetrahedra pass (consistent Freudenthal split, so the surface is
closed), then Taubin-smoothed and simplified through manifold3d. `mesh_reference`
shapes load an imported GLB/STL asset and scale it uniformly into the requested box.

These meshes are visual or printable surfaces: they never produce STEP, and they are
never reported as dimensionally verified fabricated parts.
"""
from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np

from ..design_ir.models import Shape
from .meshing import TriMesh, decode_glb, decode_stl, edge_manifold_report, taubin_smooth, to_manifold, from_manifold, weld
from .occ import GeometryError
from .transforms import align_y_to, euler_xyz

MAX_CELLS_PER_AXIS = 150
_TETS = ((0, 1, 3, 7), (0, 1, 5, 7), (0, 2, 3, 7), (0, 2, 6, 7), (0, 4, 5, 7), (0, 4, 6, 7))
_CORNERS = np.array([(x, y, z) for z in (0, 1) for y in (0, 1) for x in (0, 1)])  # bit order x=1, y=2, z=4


# --- signed distance primitives (local frame, build axis +Y) ------------------------


def _len2(a, b):
    return np.sqrt(a * a + b * b)


def _sd_box(p, half):
    q = np.abs(p) - half
    outside = np.linalg.norm(np.maximum(q, 0.0), axis=-1)
    inside = np.minimum(np.max(q, axis=-1), 0.0)
    return outside + inside


def _sd_cylinder(p, r, h):
    dx = _len2(p[..., 0], p[..., 2]) - r
    dy = np.abs(p[..., 1]) - h / 2
    return np.minimum(np.maximum(dx, dy), 0.0) + _len2(np.maximum(dx, 0.0), np.maximum(dy, 0.0))


def _sd_cone(p, r1, r2, h):
    hh = h / 2
    qx = _len2(p[..., 0], p[..., 2])
    qy = p[..., 1]
    k1x, k1y = r2, hh
    k2x, k2y = r2 - r1, 2 * hh
    cax = qx - np.minimum(qx, np.where(qy < 0, r1, r2))
    cay = np.abs(qy) - hh
    t = np.clip(((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y), 0.0, 1.0)
    cbx = qx - k1x + k2x * t
    cby = qy - k1y + k2y * t
    s = np.where((cbx < 0) & (cay < 0), -1.0, 1.0)
    return s * np.sqrt(np.minimum(cax * cax + cay * cay, cbx * cbx + cby * cby))


def _sd_capsule(p, r, length):
    a = max(length / 2 - r, 0.0)
    y = np.clip(p[..., 1], -a, a)
    return np.sqrt(p[..., 0] ** 2 + (p[..., 1] - y) ** 2 + p[..., 2] ** 2) - r


def _sd_torus(p, big, small):
    return _len2(_len2(p[..., 0], p[..., 2]) - big, p[..., 1]) - small


def _sd_ellipsoid(p, radii):
    r = np.asarray(radii, dtype=float)
    k0 = np.linalg.norm(p / r, axis=-1)
    k1 = np.linalg.norm(p / (r * r), axis=-1)
    return np.where(k1 > 1e-12, k0 * (k0 - 1.0) / np.maximum(k1, 1e-12), -np.min(r))


def primitive_sdf(shape: Shape) -> tuple[Callable[[np.ndarray], np.ndarray], float]:
    """(sdf(points) -> distances, bounding radius) for one occupancy child, in the parent frame."""
    t = shape.type
    if t in ("box", "plate"):
        half = np.array(shape.dimensions_mm) / 2
        local, radius = (lambda p: _sd_box(p, half)), float(np.linalg.norm(half))
    elif t == "rounded_box":
        half = np.array(shape.dimensions_mm) / 2
        r = shape.radius_mm
        local, radius = (lambda p: _sd_box(p, half - r) - r), float(np.linalg.norm(half))
    elif t == "sphere":
        local, radius = (lambda p: np.linalg.norm(p, axis=-1) - shape.radius_mm), shape.radius_mm
    elif t == "ellipsoid":
        radii = np.array(shape.dimensions_mm) / 2
        local, radius = (lambda p: _sd_ellipsoid(p, radii)), float(radii.max())
    elif t == "cylinder":
        local, radius = (lambda p: _sd_cylinder(p, shape.radius_mm, shape.height_mm)), math.hypot(shape.radius_mm, shape.height_mm / 2)
    elif t == "cone":
        local, radius = (lambda p: _sd_cone(p, shape.radius_mm, shape.radius_top_mm, shape.height_mm)), math.hypot(max(shape.radius_mm, shape.radius_top_mm), shape.height_mm / 2)
    elif t == "capsule":
        local, radius = (lambda p: _sd_capsule(p, shape.radius_mm, shape.height_mm)), max(shape.height_mm / 2, shape.radius_mm)
    elif t == "torus":
        local, radius = (lambda p: _sd_torus(p, shape.radius_mm, shape.minor_radius_mm)), shape.radius_mm + shape.minor_radius_mm
    else:
        raise GeometryError(f"{t} cannot be used inside an occupancy shape")
    axis_r = align_y_to(shape.resolved_axis) if t in ("cylinder", "cone", "capsule", "torus") else np.eye(3)
    frame_r = euler_xyz(shape.frame.rotation_deg)
    rot = frame_r @ axis_r
    centre = np.array(shape.frame.position_mm, dtype=float)

    def sdf(points: np.ndarray) -> np.ndarray:
        return local((points - centre) @ rot)  # world -> local is R^T p, written row-wise

    return sdf, float(np.linalg.norm(centre)) + radius


def _smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def _smax(a, b, k):
    return -_smin(-a, -b, k)


def occupancy_sdf(shape: Shape) -> tuple[Callable[[np.ndarray], np.ndarray], float]:
    fields = [primitive_sdf(c) for c in shape.children]
    k = shape.smoothing_mm
    op = shape.operation

    def sdf(points):
        d = fields[0][0](points)
        for f, _ in fields[1:]:
            v = f(points)
            if op in ("union", "smooth_union"):
                d = _smin(d, v, k)
            elif op == "difference":
                d = _smax(d, -v, k)
            else:
                d = _smax(d, v, k)
        if shape.hollow:
            d = np.maximum(d, -(d + shape.wall_mm))
        return d

    return sdf, max(r for _, r in fields) + k


def marching_tetrahedra(values: np.ndarray, origin: np.ndarray, pitch: float) -> TriMesh:
    """Closed, consistently oriented iso-surface (value < 0 is inside) of a scalar grid."""
    v = np.array(values, dtype=np.float64)
    v[v == 0] = 1e-9
    nx, ny, nz = v.shape
    flat = v.reshape(-1)
    ii, jj, kk = np.meshgrid(np.arange(nx - 1), np.arange(ny - 1), np.arange(nz - 1), indexing="ij")
    base = ((ii * ny + jj) * nz + kk).reshape(-1)
    offs = np.array([(dx * ny + dy) * nz + dz for dx, dy, dz in _CORNERS])
    corner_idx = base[:, None] + offs[None, :]
    corner_val = flat[corner_idx]
    active = (corner_val.min(axis=1) < 0) & (corner_val.max(axis=1) >= 0)
    corner_idx, corner_val = corner_idx[active], corner_val[active]
    if len(corner_idx) == 0:
        return TriMesh(np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64))

    def grid_point(index: np.ndarray) -> np.ndarray:
        x = index // (ny * nz)
        y = (index // nz) % ny
        z = index % nz
        return origin + pitch * np.stack([x, y, z], axis=-1).astype(np.float64)

    tri_edges = []  # (T, 3, 2) global grid indices of each triangle corner's edge
    tri_dirs = []  # outward reference direction per triangle
    for tet in _TETS:
        idx = corner_idx[:, tet]
        val = corner_val[:, tet]
        inside = val < 0
        case = inside[:, 0] * 1 + inside[:, 1] * 2 + inside[:, 2] * 4 + inside[:, 3] * 8
        pos = grid_point(idx)
        for c in range(1, 15):
            sel = case == c
            if not sel.any():
                continue
            ins = [i for i in range(4) if c >> i & 1]
            outs = [i for i in range(4) if not c >> i & 1]
            I, V, P = idx[sel], val[sel], pos[sel]
            out_dir = P[:, outs].mean(axis=1) - P[:, ins].mean(axis=1)
            if len(ins) == 1 or len(outs) == 1:
                lone, rest = (ins[0], outs) if len(ins) == 1 else (outs[0], ins)
                e = np.stack([np.stack([I[:, lone], I[:, r]], axis=-1) for r in rest], axis=1)
                tri_edges.append(e)
                tri_dirs.append(out_dir)
            else:
                a, b = ins
                k, l = outs
                q = [np.stack([I[:, a], I[:, k]], -1), np.stack([I[:, a], I[:, l]], -1), np.stack([I[:, b], I[:, l]], -1), np.stack([I[:, b], I[:, k]], -1)]
                tri_edges.append(np.stack([q[0], q[1], q[2]], axis=1))
                tri_edges.append(np.stack([q[0], q[2], q[3]], axis=1))
                tri_dirs.extend([out_dir, out_dir])
    edges = np.concatenate(tri_edges)  # (T, 3, 2)
    dirs = np.concatenate(tri_dirs)
    lo = np.minimum(edges[..., 0], edges[..., 1])
    hi = np.maximum(edges[..., 0], edges[..., 1])
    total = nx * ny * nz
    keys = (lo * total + hi).reshape(-1)
    uniq, first, inverse = np.unique(keys, return_index=True, return_inverse=True)
    ep = lo.reshape(-1)[first]
    eq = hi.reshape(-1)[first]
    vp, vq = flat[ep], flat[eq]
    t = np.clip(vp / (vp - vq), 0.0, 1.0)[:, None]
    verts = grid_point(ep) + t * (grid_point(eq) - grid_point(ep))
    faces = inverse.reshape(-1, 3)
    n = np.cross(verts[faces[:, 1]] - verts[faces[:, 0]], verts[faces[:, 2]] - verts[faces[:, 0]])
    flip = np.einsum("ij,ij->i", n, dirs) < 0
    faces[flip] = faces[flip][:, ::-1]
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    return TriMesh(verts, faces[keep])


def mesh_sdf(sdf: Callable[[np.ndarray], np.ndarray], centre: np.ndarray, radius: float, pitch: float) -> tuple[TriMesh, float, list[str]]:
    warnings = []
    extent = 2 * radius + 4 * pitch
    if extent / pitch > MAX_CELLS_PER_AXIS:
        new_pitch = extent / MAX_CELLS_PER_AXIS
        warnings.append(f"voxel pitch raised from {pitch:g} to {new_pitch:.2f} mm to bound memory")
        pitch = new_pitch
    n = int(math.ceil(extent / pitch)) + 1
    origin = centre - (n - 1) * pitch / 2
    axis = origin[None, :] + pitch * np.arange(n)[:, None]
    gx, gy, gz = np.meshgrid(axis[:, 0], axis[:, 1], axis[:, 2], indexing="ij")
    points = np.stack([gx, gy, gz], axis=-1).reshape(-1, 3)
    values = sdf(points).reshape(n, n, n)
    values[0, :, :] = values[-1, :, :] = np.maximum(values[0, :, :], pitch)
    values[:, 0, :] = values[:, -1, :] = np.maximum(values[:, 0, :], pitch)
    values[:, :, 0] = values[:, :, -1] = np.maximum(values[:, :, 0], pitch)
    mesh = marching_tetrahedra(values, origin, pitch)
    if mesh.empty:
        raise GeometryError("occupancy shape has no inside region at this resolution")
    return mesh, pitch, warnings


def build_occupancy(shape: Shape) -> tuple[TriMesh, dict]:
    sdf, radius = occupancy_sdf(shape)
    centre = np.zeros(3)
    mesh, pitch, warnings = mesh_sdf(sdf, centre, radius, shape.pitch_mm)
    mesh = taubin_smooth(mesh, iterations=6)
    manifold, reason = to_manifold(mesh)
    if manifold is not None:
        simplified = manifold.simplify(pitch * 0.15)
        if not simplified.is_empty() and simplified.volume() > 0.9 * manifold.volume():
            manifold = simplified
        mesh = from_manifold(manifold)
    report = edge_manifold_report(mesh)
    rot = euler_xyz(shape.frame.rotation_deg)
    mesh = TriMesh(mesh.vertices @ rot.T + np.array(shape.frame.position_mm), mesh.faces)
    return mesh, {"pitch_mm": round(pitch, 4), "warnings": warnings, "watertight": report["watertight"], "manifold_reason": reason}


def load_mesh_asset(data: bytes) -> TriMesh:
    if data[:4] == b"glTF":
        _, parts = decode_glb(data)
        if not parts:
            raise GeometryError("imported GLB has no triangle meshes")
        return weld(TriMesh.merge([m for _, m, _ in parts]))
    return decode_stl(data)


def build_mesh_reference(shape: Shape, loader: Callable[[str], bytes] | None) -> tuple[TriMesh, dict]:
    if loader is None:
        raise GeometryError("no asset loader was provided for mesh_reference shapes")
    try:
        data = loader(shape.asset_id or "")
    except Exception:  # noqa: BLE001
        raise GeometryError(f"imported mesh {shape.asset_id!r} is not available") from None
    if len(data) > 50 * 1024 * 1024:
        raise GeometryError("imported mesh exceeds 50 MB")
    try:
        mesh = load_mesh_asset(data)
    except ValueError as exc:
        raise GeometryError(f"imported mesh could not be read: {exc}") from None
    if len(mesh.faces) > 400_000:
        raise GeometryError("imported mesh exceeds 400k triangles")
    lo, hi = mesh.bounds()
    extent = np.maximum(hi - lo, 1e-9)
    target = np.array(shape.dimensions_mm, dtype=float)
    scale = float(np.min(target / extent))
    if not math.isfinite(scale) or scale <= 0:
        raise GeometryError("imported mesh has no extent")
    centre = (lo + hi) / 2
    verts = (mesh.vertices - centre) * scale
    rot = euler_xyz(shape.frame.rotation_deg)
    mesh = TriMesh(verts @ rot.T + np.array(shape.frame.position_mm), mesh.faces)
    report = edge_manifold_report(mesh)
    return mesh, {"scale": round(scale, 6), "watertight": report["watertight"], "source_extent_mm": [round(float(v), 4) for v in extent]}
