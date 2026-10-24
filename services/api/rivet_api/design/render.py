"""Six-camera renders of an actual generated GLB.

`raster` (default) is a deterministic, vectorized CPU z-buffer renderer: same asset, same
pixels. `chromium` runs apps/web/scripts/render-design.mjs (three.js in headless
Chromium) when Node and Playwright are installed. Both render the real geometry asset;
neither ever substitutes a reference or concept image.
"""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from rivet_engine.geometry.meshing import decode_glb

VIEWS = {"front": (0, 0, 1), "left": (-1, 0, 0), "back": (0, 0, -1), "right": (1, 0, 0), "top": (0, 1, 0), "perspective": (1, 0.7, 1)}
BACKGROUND = np.array([0xEE, 0xF1, 0xF5], dtype=float) / 255.0
RENDERER_VERSION = "rivet-raster/1"


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, 1), 1 / 2.4) - 0.055)


def load_scene(glb: bytes) -> tuple[np.ndarray, np.ndarray, list[str]]:
    doc, parts = decode_glb(glb)
    mats = doc.get("materials", [])
    tris, cols, owners = [], [], []
    for name, mesh, extras in parts:
        if mesh.empty:
            continue
        factor = mats[extras["_material"]]["pbrMetallicRoughness"]["baseColorFactor"][:3] if extras.get("_material") is not None and mats else [0.6, 0.6, 0.6]
        rgb = _linear_to_srgb(np.array(factor, dtype=float))
        t = mesh.vertices[mesh.faces]
        tris.append(t)
        cols.append(np.repeat(rgb[None, :], len(t), axis=0))
        owners += [extras.get("body_id", name)] * len(t)
    if not tris:
        raise ValueError("scene has no triangles")
    return np.concatenate(tris), np.concatenate(cols), owners


def _camera(view: str, centre: np.ndarray, radius: float):
    d = np.array(VIEWS[view], dtype=float)
    d /= np.linalg.norm(d)
    up = np.array([0.0, 0.0, -1.0]) if view == "top" else np.array([0.0, 1.0, 0.0])
    forward = -d
    right = np.cross(forward, up)
    right /= np.linalg.norm(right)
    true_up = np.cross(right, forward)
    return d, forward, right, true_up


def rasterize(tris: np.ndarray, colors: np.ndarray, view: str, size: int = 512) -> tuple[np.ndarray, np.ndarray, dict]:
    lo, hi = tris.reshape(-1, 3).min(axis=0), tris.reshape(-1, 3).max(axis=0)
    centre = (lo + hi) / 2
    radius = max(float(np.linalg.norm(hi - lo)) / 2, 1e-3)
    d, forward, right, up = _camera(view, centre, radius)
    perspective = view == "perspective"
    rel = tris - centre
    x = rel @ right
    y = rel @ up
    depth = rel @ forward
    half = max(float(np.abs(x).max()), float(np.abs(y).max()), 1e-3) * 1.12
    if perspective:
        dist = radius * 4.0
        z = dist + depth
        f = 1.0 / np.tan(np.radians(35.0) / 2)
        x, y = x * f / z, y * f / z
        scale = 1.0
    else:
        scale = 1.0 / half
    sx = (x * scale * 0.5 + 0.5) * size
    sy = (0.5 - y * scale * 0.5) * size
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    facing = n @ d
    n = np.where(facing[:, None] < 0, -n, n)
    key = np.array([0.45, 0.8, 0.4])
    key = key / np.linalg.norm(key)
    fill = -d * 0.6 + np.array([0.0, 0.3, 0.0])
    fill = fill / np.linalg.norm(fill)
    shade = 0.38 + 0.52 * np.clip(n @ key, 0, 1) + 0.22 * np.clip(n @ fill, 0, 1) + 0.12 * np.abs(facing)
    lit = np.clip(colors * shade[:, None], 0, 1)
    x0 = np.clip(np.floor(sx.min(axis=1)), 0, size - 1).astype(np.int64)
    x1 = np.clip(np.ceil(sx.max(axis=1)), 0, size - 1).astype(np.int64)
    y0 = np.clip(np.floor(sy.min(axis=1)), 0, size - 1).astype(np.int64)
    y1 = np.clip(np.ceil(sy.max(axis=1)), 0, size - 1).astype(np.int64)
    w, h = x1 - x0 + 1, y1 - y0 + 1
    area = 0.5 * ((sx[:, 1] - sx[:, 0]) * (sy[:, 2] - sy[:, 0]) - (sx[:, 2] - sx[:, 0]) * (sy[:, 1] - sy[:, 0]))
    keep = np.abs(area) > 1e-9
    counts = np.where(keep, w * h, 0)
    total = int(counts.sum())
    if total > 12_000_000:
        raise ValueError("scene too detailed for the CPU renderer at this size")
    tri = np.repeat(np.arange(len(tris)), counts)
    start = np.repeat(np.cumsum(counts) - counts, counts)
    local = np.arange(total) - start
    px = x0[tri] + local % w[tri]
    py = y0[tri] + local // w[tri]
    cx, cy = px + 0.5, py + 0.5
    ax, ay, bx, by, qx, qy = sx[tri, 0], sy[tri, 0], sx[tri, 1], sy[tri, 1], sx[tri, 2], sy[tri, 2]
    inv = 1.0 / (2 * area[tri])
    w0 = ((bx - cx) * (qy - cy) - (qx - cx) * (by - cy)) * inv
    w1 = ((qx - cx) * (ay - cy) - (ax - cx) * (qy - cy)) * inv
    w2 = 1.0 - w0 - w1
    inside = (w0 >= -1e-9) & (w1 >= -1e-9) & (w2 >= -1e-9)
    z = w0 * depth[tri, 0] + w1 * depth[tri, 1] + w2 * depth[tri, 2]
    pix = (py * size + px)[inside]
    z, owner = z[inside], tri[inside]
    order = np.lexsort((z, pix))
    pix, owner = pix[order], owner[order]
    first = np.ones(len(pix), dtype=bool)
    first[1:] = pix[1:] != pix[:-1]
    image = np.tile(BACKGROUND, (size * size, 1))
    image[pix[first]] = lit[owner[first]]
    mask = np.zeros(size * size, dtype=bool)
    mask[pix[first]] = True
    rgb = (np.clip(image, 0, 1) * 255 + 0.5).astype(np.uint8).reshape(size, size, 3)
    camera = {"view": view, "projection": "perspective" if perspective else "orthographic", "direction": [round(float(v), 6) for v in d],
              "target_mm": [round(float(v), 3) for v in centre], "up": [round(float(v), 6) for v in up], "orthographic_size_mm": None if perspective else round(2 * half, 3),
              "fov_deg": 35.0 if perspective else None, "distance_mm": round(radius * 4.0, 3) if perspective else None, "width": size, "height": size, "units": "mm",
              "renderer": RENDERER_VERSION}
    return rgb, mask.reshape(size, size), camera


def png(rgb: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "PNG", optimize=False, compress_level=6)
    return buf.getvalue()


def render_six(glb: bytes, size: int = 512) -> dict:
    tris, colors, _ = load_scene(glb)
    shots, digest = [], hashlib.sha256()
    for view in VIEWS:
        rgb, mask, camera = rasterize(tris, colors, view, size)
        data = png(rgb)
        digest.update(data)
        shots.append({"view": view, "png": data, "mask": mask, "camera": camera})
    return {"shots": shots, "render_digest": digest.hexdigest(), "renderer": RENDERER_VERSION}


def chromium_available(web_root: Path) -> bool:
    return shutil.which("node") is not None and (web_root / "node_modules" / "@playwright" / "test").exists() and (web_root / "scripts" / "render-design.mjs").exists()


def render_six_chromium(glb: bytes, web_root: Path, size: int = 768) -> dict:
    """three.js/WebGL renders through headless Chromium (optional, slower)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "scene.glb").write_bytes(glb)
        request = {"scene_asset_path": str(tmp_path / "scene.glb"), "output_dir": str(tmp_path / "shots"), "width": size, "height": size}
        (tmp_path / "req.json").write_text(json.dumps(request))
        subprocess.run(["node", "scripts/render-design.mjs", "--input", str(tmp_path / "req.json"), "--output", str(tmp_path / "res.json")],
                       cwd=web_root, check=True, timeout=180, capture_output=True)
        res = json.loads((tmp_path / "res.json").read_text())
        shots = []
        for s in res["shots"]:
            data = Path(s["path"]).read_bytes()
            img = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(float) / 255.0
            mask = np.linalg.norm(img - BACKGROUND, axis=2) > 0.02
            shots.append({"view": s["view"], "png": data, "mask": mask, "camera": {**s["camera"], "renderer": "three-chromium"}})
        return {"shots": shots, "render_digest": res["render_digest"], "renderer": "three-chromium"}
