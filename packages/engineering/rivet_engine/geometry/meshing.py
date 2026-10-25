"""Triangle meshes, manifold conversion, and deterministic GLB/STL encoding.

Meshes are in millimetres. GLB files are written in metres (the glTF convention); the
scene's `asset.extras` records the conversion. Encoders are byte-deterministic: the same
mesh, transforms and materials always produce the same file, so geometry digests can be
compared across runs and replays.
"""
from __future__ import annotations

import hashlib
import json
import struct
from dataclasses import dataclass, field
from typing import Any

import numpy as np

MM_PER_M = 1000.0


@dataclass
class TriMesh:
    vertices: np.ndarray  # (N, 3) float64, mm
    faces: np.ndarray  # (M, 3) int64, counter-clockwise seen from outside
    face_groups: np.ndarray | None = None  # (M,) int, B-rep face index per triangle

    def __post_init__(self):
        self.vertices = np.asarray(self.vertices, dtype=np.float64).reshape(-1, 3)
        self.faces = np.asarray(self.faces, dtype=np.int64).reshape(-1, 3)
        if self.face_groups is not None:
            self.face_groups = np.asarray(self.face_groups, dtype=np.int64).reshape(-1)

    @property
    def empty(self) -> bool:
        return len(self.faces) == 0

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        if len(self.vertices) == 0:
            return np.zeros(3), np.zeros(3)
        return self.vertices.min(axis=0), self.vertices.max(axis=0)

    def transformed(self, m: np.ndarray) -> TriMesh:
        v = self.vertices @ m[:3, :3].T + m[:3, 3]
        faces = self.faces if np.linalg.det(m[:3, :3]) > 0 else self.faces[:, ::-1]
        return TriMesh(v, faces.copy(), None if self.face_groups is None else self.face_groups.copy())

    def triangle_normals(self) -> np.ndarray:
        v = self.vertices
        n = np.cross(v[self.faces[:, 1]] - v[self.faces[:, 0]], v[self.faces[:, 2]] - v[self.faces[:, 0]])
        length = np.linalg.norm(n, axis=1, keepdims=True)
        return n / np.where(length == 0, 1, length)

    def triangle_areas(self) -> np.ndarray:
        v = self.vertices
        return 0.5 * np.linalg.norm(np.cross(v[self.faces[:, 1]] - v[self.faces[:, 0]], v[self.faces[:, 2]] - v[self.faces[:, 0]]), axis=1)

    def area(self) -> float:
        return float(self.triangle_areas().sum())

    def volume(self) -> float:
        """Signed volume (divergence theorem); positive for closed outward-wound meshes."""
        v = self.vertices
        a, b, c = v[self.faces[:, 0]], v[self.faces[:, 1]], v[self.faces[:, 2]]
        return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)

    def centroid(self) -> np.ndarray:
        v = self.vertices
        a, b, c = v[self.faces[:, 0]], v[self.faces[:, 1]], v[self.faces[:, 2]]
        vols = np.einsum("ij,ij->i", a, np.cross(b, c)) / 6.0
        total = vols.sum()
        if abs(total) < 1e-12:
            return v.mean(axis=0) if len(v) else np.zeros(3)
        return ((a + b + c) / 4.0 * vols[:, None]).sum(axis=0) / total

    def vertex_normals(self) -> np.ndarray:
        """Area-weighted vertex normals; vertices shared only within a B-rep face, so
        normals are smooth on curved faces and sharp across face boundaries."""
        v = self.vertices
        fn = np.cross(v[self.faces[:, 1]] - v[self.faces[:, 0]], v[self.faces[:, 2]] - v[self.faces[:, 0]])
        normals = np.zeros_like(v)
        for k in range(3):
            np.add.at(normals, self.faces[:, k], fn)
        length = np.linalg.norm(normals, axis=1, keepdims=True)
        bad = length[:, 0] < 1e-12
        normals = normals / np.where(length == 0, 1, length)
        normals[bad] = (0.0, 1.0, 0.0)
        return normals

    @staticmethod
    def merge(meshes: list[TriMesh]) -> TriMesh:
        meshes = [m for m in meshes if not m.empty]
        if not meshes:
            return TriMesh(np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64))
        offset, verts, faces, groups = 0, [], [], []
        group_offset = 0
        for m in meshes:
            verts.append(m.vertices)
            faces.append(m.faces + offset)
            g = m.face_groups if m.face_groups is not None else np.zeros(len(m.faces), dtype=np.int64)
            groups.append(g + group_offset)
            group_offset += int(g.max()) + 1 if len(g) else 0
            offset += len(m.vertices)
        return TriMesh(np.vstack(verts), np.vstack(faces), np.concatenate(groups))


def weld(mesh: TriMesh, tolerance: float = 1e-5) -> TriMesh:
    """Merge coincident vertices (quantized) and drop degenerate triangles."""
    if mesh.empty:
        return mesh
    keys = np.round(mesh.vertices / tolerance).astype(np.int64)
    _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    order = np.argsort(first)
    remap = np.empty_like(order)
    remap[order] = np.arange(len(order))
    vertices = mesh.vertices[first[order]]
    faces = remap[inverse[mesh.faces]]
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    groups = None if mesh.face_groups is None else mesh.face_groups[keep]
    return TriMesh(vertices, faces[keep], groups)


def edge_manifold_report(mesh: TriMesh) -> dict[str, Any]:
    """Watertightness by edge counting: every undirected edge used by exactly two
    triangles, with opposite directions (consistent orientation)."""
    if mesh.empty:
        return {"watertight": False, "boundary_edges": 0, "nonmanifold_edges": 0, "inconsistent_edges": 0}
    f = mesh.faces
    directed = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    undirected = np.sort(directed, axis=1)
    _, counts = np.unique(undirected, axis=0, return_counts=True)
    uniq_directed, dcounts = np.unique(directed, axis=0, return_counts=True)
    boundary = int((counts == 1).sum())
    nonmanifold = int((counts > 2).sum())
    inconsistent = int((dcounts > 1).sum())
    return {
        "watertight": boundary == 0 and nonmanifold == 0 and inconsistent == 0,
        "boundary_edges": boundary,
        "nonmanifold_edges": nonmanifold,
        "inconsistent_edges": inconsistent,
    }


def to_manifold(mesh: TriMesh):
    """manifold3d.Manifold for a watertight mesh, or (None, reason)."""
    import manifold3d

    if mesh.empty:
        return None, "empty mesh"
    welded = weld(mesh)
    m = manifold3d.Manifold(manifold3d.Mesh(vert_properties=welded.vertices.astype(np.float32), tri_verts=welded.faces.astype(np.uint32)))
    status = m.status()
    if str(status) not in ("Error.NoError", "NoError"):
        return None, f"not a closed manifold ({status})"
    if m.is_empty():
        return None, "mesh is empty after manifold conversion"
    return m, None


def from_manifold(m) -> TriMesh:
    mesh = m.to_mesh()
    verts = np.asarray(mesh.vert_properties, dtype=np.float64)[:, :3]
    faces = np.asarray(mesh.tri_verts, dtype=np.int64)
    return TriMesh(verts, faces)


def mesh_digest(mesh: TriMesh, quantum: float = 1e-3) -> str:
    """Content hash of a mesh: vertex coordinates quantized to `quantum` mm plus faces."""
    h = hashlib.sha256()
    q = np.round(mesh.vertices / quantum).astype("<i8")
    h.update(q.tobytes())
    h.update(np.ascontiguousarray(mesh.faces, dtype="<i8").tobytes())
    return h.hexdigest()


def taubin_smooth(mesh: TriMesh, iterations: int = 8, lam: float = 0.5, mu: float = -0.53) -> TriMesh:
    """Volume-preserving-ish Laplacian smoothing for welded freeform meshes."""
    if mesh.empty:
        return mesh
    v = mesh.vertices.copy()
    f = mesh.faces
    edges = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    deg = np.zeros(len(v))
    np.add.at(deg, edges[:, 0], 1)
    np.add.at(deg, edges[:, 1], 1)
    deg = np.maximum(deg, 1)[:, None]
    for _ in range(iterations):
        for factor in (lam, mu):
            acc = np.zeros_like(v)
            np.add.at(acc, edges[:, 0], v[edges[:, 1]])
            np.add.at(acc, edges[:, 1], v[edges[:, 0]])
            v = v + factor * (acc / deg - v)
    return TriMesh(v, f.copy(), mesh.face_groups)


def ray_hits(mesh: TriMesh, origins: np.ndarray, directions: np.ndarray, max_distance: float) -> np.ndarray:
    """Distance to the first hit for each ray (inf when nothing is hit within range).
    Vectorized Moller-Trumbore over all triangles; meant for small access checks."""
    origins = np.asarray(origins, dtype=float).reshape(-1, 3)
    directions = np.asarray(directions, dtype=float).reshape(-1, 3)
    out = np.full(len(origins), np.inf)
    if mesh.empty:
        return out
    v0 = mesh.vertices[mesh.faces[:, 0]]
    e1 = mesh.vertices[mesh.faces[:, 1]] - v0
    e2 = mesh.vertices[mesh.faces[:, 2]] - v0
    for i, (o, d) in enumerate(zip(origins, directions)):
        p = np.cross(d, e2)
        det = np.einsum("ij,ij->i", e1, p)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
        s = o - v0
        u = np.einsum("ij,ij->i", s, p) * inv
        q = np.cross(s, e1)
        w = (q @ d) * inv
        t = np.einsum("ij,ij->i", e2, q) * inv
        hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1) & (t > 1e-6) & (t <= max_distance)
        if hit.any():
            out[i] = float(t[hit].min())
    return out


# --- materials -----------------------------------------------------------------


def srgb_to_linear(hex_color: str) -> list[float]:
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return [round(v, 6) for v in out]


@dataclass(frozen=True)
class RenderMaterial:
    name: str
    color: str = "#a8b4c0"
    metallic: float = 0.0
    roughness: float = 0.5
    opacity: float = 1.0

    def key(self) -> tuple:
        return (self.name, self.color.lower(), round(self.metallic, 4), round(self.roughness, 4), round(self.opacity, 4))


@dataclass
class GlbNode:
    name: str
    primitives: list[tuple[TriMesh, RenderMaterial]]
    matrix_mm: np.ndarray | None = None  # world (or parent-relative) transform in mm
    extras: dict[str, Any] = field(default_factory=dict)


def _pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def encode_glb(nodes: list[GlbNode], *, scene_extras: dict[str, Any] | None = None, generator: str = "Rivet design compiler") -> bytes:
    """Deterministic binary glTF 2.0: one node per entry (flat, under a root), one mesh per
    node with one primitive per material region. Positions are written in metres."""
    blob = bytearray()
    buffer_views: list[dict] = []
    accessors: list[dict] = []
    materials: list[dict] = []
    material_index: dict[tuple, int] = {}
    meshes: list[dict] = []
    gl_nodes: list[dict] = []

    def add_view(data: bytes, target: int) -> int:
        nonlocal blob
        blob = bytearray(_pad(bytes(blob), b"\x00"))
        buffer_views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob.extend(data)
        return len(buffer_views) - 1

    for node in nodes:
        primitives = []
        for mesh, mat in node.primitives:
            if mesh.empty:
                continue
            key = mat.key()
            if key not in material_index:
                rgb = srgb_to_linear(mat.color)
                entry: dict[str, Any] = {
                    "name": mat.name,
                    "pbrMetallicRoughness": {
                        "baseColorFactor": [*rgb, round(mat.opacity, 4)],
                        "metallicFactor": round(mat.metallic, 4),
                        "roughnessFactor": round(mat.roughness, 4),
                    },
                }
                if mat.opacity < 1:
                    entry["alphaMode"] = "BLEND"
                material_index[key] = len(materials)
                materials.append(entry)
            positions = (mesh.vertices / MM_PER_M).astype("<f4")
            normals = mesh.vertex_normals().astype("<f4")
            indices = mesh.faces.astype("<u4").reshape(-1)
            pv = add_view(positions.tobytes(), 34962)
            accessors.append({
                "bufferView": pv, "componentType": 5126, "count": len(positions), "type": "VEC3",
                "min": [round(float(x), 7) for x in positions.min(axis=0)],
                "max": [round(float(x), 7) for x in positions.max(axis=0)],
            })
            pa = len(accessors) - 1
            nv = add_view(normals.tobytes(), 34962)
            accessors.append({"bufferView": nv, "componentType": 5126, "count": len(normals), "type": "VEC3"})
            na = len(accessors) - 1
            iv = add_view(indices.tobytes(), 34963)
            accessors.append({"bufferView": iv, "componentType": 5125, "count": int(len(indices)), "type": "SCALAR"})
            ia = len(accessors) - 1
            primitives.append({"attributes": {"POSITION": pa, "NORMAL": na}, "indices": ia, "material": material_index[key], "mode": 4})
        gl_node: dict[str, Any] = {"name": node.name, "extras": node.extras}
        if primitives:
            meshes.append({"name": node.name, "primitives": primitives})
            gl_node["mesh"] = len(meshes) - 1
        if node.matrix_mm is not None and not np.allclose(node.matrix_mm, np.eye(4)):
            m = np.array(node.matrix_mm, dtype=float).copy()
            m[:3, 3] /= MM_PER_M
            gl_node["matrix"] = [round(float(x), 9) + 0.0 for x in m.T.reshape(-1)]  # column-major
        gl_nodes.append(gl_node)

    root = {"name": "rivet-assembly", "children": list(range(1, len(gl_nodes) + 1)), "extras": scene_extras or {}}
    all_nodes = [root] + gl_nodes
    doc: dict[str, Any] = {
        "asset": {"version": "2.0", "generator": generator, "extras": {"units": "m", "source_units": "mm", "up": "Y"}},
        "scene": 0,
        "scenes": [{"name": "rivet", "nodes": [0]}],
        "nodes": all_nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(_pad(bytes(blob), b"\x00"))}],
    }
    if not meshes:
        doc.pop("meshes")
        doc.pop("materials")
        doc.pop("accessors")
        doc.pop("bufferViews")
        doc["buffers"] = [{"byteLength": 4}]
        blob = bytearray(b"\x00\x00\x00\x00")
    json_bytes = _pad(json.dumps(doc, sort_keys=True, separators=(",", ":"), allow_nan=False).encode(), b" ")
    bin_bytes = _pad(bytes(blob), b"\x00")
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray(struct.pack("<III", 0x46546C67, 2, total))
    out += struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    out += struct.pack("<II", len(bin_bytes), 0x004E4942) + bin_bytes
    return bytes(out)


def decode_glb(data: bytes) -> tuple[dict[str, Any], list[tuple[str, TriMesh, dict]]]:
    """Parse a GLB (positions + indices, node matrices/TRS applied) into world meshes in mm.
    Supports the subset Rivet writes and common uncompressed exports; refuses extensions
    that need decompression."""
    if len(data) < 20:
        raise ValueError("not a GLB file")
    magic, version, total = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError("not a glTF 2.0 binary file")
    offset, doc, blob = 12, None, b""
    while offset < min(total, len(data)):
        length, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + length]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk.decode())
        elif kind == 0x004E4942:
            blob = chunk
        offset += 8 + length
    if doc is None:
        raise ValueError("GLB has no JSON chunk")
    if doc.get("extensionsRequired"):
        raise ValueError(f"unsupported glTF extensions: {doc['extensionsRequired']}")
    accessors, views = doc.get("accessors", []), doc.get("bufferViews", [])
    ctype = {5126: ("<f4", 4), 5125: ("<u4", 4), 5123: ("<u2", 2), 5121: ("u1", 1)}
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

    def read(ai: int) -> np.ndarray:
        acc = accessors[ai]
        view = views[acc["bufferView"]]
        dtype, size = ctype[acc["componentType"]]
        comps = ncomp[acc["type"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride") or size * comps
        count = acc["count"]
        if stride == size * comps:
            arr = np.frombuffer(blob, dtype=dtype, count=count * comps, offset=start)
        else:
            arr = np.concatenate([np.frombuffer(blob, dtype=dtype, count=comps, offset=start + i * stride) for i in range(count)])
        return arr.reshape(count, comps) if comps > 1 else arr

    def node_matrix(node: dict) -> np.ndarray:
        if "matrix" in node:
            return np.array(node["matrix"], dtype=float).reshape(4, 4).T
        m = np.eye(4)
        t = node.get("translation", [0, 0, 0])
        r = node.get("rotation", [0, 0, 0, 1])
        s = node.get("scale", [1, 1, 1])
        x, y, z, w = r
        rot = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ])
        m[:3, :3] = rot * np.array(s)
        m[:3, 3] = t
        return m

    out: list[tuple[str, TriMesh, dict]] = []
    nodes = doc.get("nodes", [])

    def walk(index: int, parent: np.ndarray, depth: int):
        if depth > 64:
            raise ValueError("glTF node hierarchy too deep")
        node = nodes[index]
        world = parent @ node_matrix(node)
        if "mesh" in node:
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                pos = read(prim["attributes"]["POSITION"]).astype(np.float64)
                idx = read(prim["indices"]).astype(np.int64).reshape(-1, 3) if "indices" in prim else np.arange(len(pos)).reshape(-1, 3)
                mesh = TriMesh(pos, idx)
                scaled = world.copy()
                mesh = mesh.transformed(scaled)
                mesh.vertices *= MM_PER_M
                out.append((node.get("name", f"node{index}"), mesh, {**node.get("extras", {}), "_material": prim.get("material")}))
        for child in node.get("children", []):
            walk(child, world, depth + 1)

    scene = doc.get("scenes", [{}])[doc.get("scene", 0)] if doc.get("scenes") else {"nodes": list(range(len(nodes)))}
    for root in scene.get("nodes", []):
        walk(root, np.eye(4), 0)
    return doc, out


def encode_stl(mesh: TriMesh, name: str = "rivet") -> bytes:
    """Binary STL in millimetres (deterministic header)."""
    header = f"Rivet STL {name}"[:80].encode().ljust(80, b" ")
    normals = mesh.triangle_normals().astype("<f4")
    tri = mesh.vertices[mesh.faces].astype("<f4")
    records = np.zeros(len(mesh.faces), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    records["n"] = normals
    records["v"] = tri
    return header + struct.pack("<I", len(mesh.faces)) + records.tobytes()


def decode_stl(data: bytes) -> TriMesh:
    if len(data) >= 84:
        count = struct.unpack_from("<I", data, 80)[0]
        if 84 + count * 50 == len(data):
            rec = np.frombuffer(data, dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")], count=count, offset=84)
            verts = rec["v"].reshape(-1, 3).astype(np.float64)
            return weld(TriMesh(verts, np.arange(len(verts)).reshape(-1, 3)))
    text = data.decode("ascii", errors="ignore")
    if "facet" not in text:
        raise ValueError("not an STL file")
    nums = [list(map(float, line.split()[1:4])) for line in text.splitlines() if line.strip().startswith("vertex")]
    if not nums or len(nums) % 3:
        raise ValueError("malformed ASCII STL")
    verts = np.array(nums)
    return weld(TriMesh(verts, np.arange(len(verts)).reshape(-1, 3)))
