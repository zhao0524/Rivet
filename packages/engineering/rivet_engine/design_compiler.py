"""Rivet design compiler: DesignSpec -> placed, checked, exported geometry.

Pure and offline: no model, network or shopping calls. The same spec, catalog and
kernel version give the same manifest and geometry digest.

    compile_design(spec, catalog, output_dir=..., seed=0) -> {
        scene_asset_path, part_manifest, joints, geometry_digest, geometry_report,
        manufacturing_assets, preview_snapshots, bom, assembly_steps, warnings, kernel
    }
"""
from __future__ import annotations

import copy
import hashlib
import json
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from pydantic import ValidationError

from .design_ir.models import DesignBody, DesignSpec, canonical_json, spec_digest
from .geometry import collision, constraints, exports, freeform, manufacturing, stability
from .geometry.catalog_geometry import catalog_regions
from .geometry.features import apply_brep, apply_mesh
from .geometry.meshing import RenderMaterial, TriMesh, edge_manifold_report, mesh_digest, to_manifold, weld, from_manifold
from .geometry.occ import GeometryError, bounds as brep_bounds, tessellate, volume as brep_volume
from .geometry.parametric import build_regions
from .geometry.transforms import apply, quantize, translation

KERNEL_VERSION = "rivet-geometry/1.0"
PREVIEW_CHUNK = 6


def kernel_versions() -> dict[str, str]:
    import manifold3d  # noqa: F401
    from importlib.metadata import PackageNotFoundError, version

    def v(name: str) -> str:
        try:
            return version(name)
        except PackageNotFoundError:
            return "unknown"

    return {"geometry": KERNEL_VERSION, "occt_bindings": f"cadquery-ocp-novtk {v('cadquery-ocp-novtk')}", "manifold3d": v("manifold3d"), "numpy": v("numpy")}


class DesignValidationError(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__("; ".join(e["message"] for e in errors[:5]))
        self.errors = errors


@dataclass
class BuiltBody:
    body_id: str
    representation: str  # brep | mesh | catalog
    geometry_source: str
    regions: list[tuple[str, TriMesh, RenderMaterial, Any]] = field(default_factory=list)
    local_mesh: TriMesh | None = None
    manifold: Any = None
    local_bounds: tuple[np.ndarray, np.ndarray] | None = None
    volume_mm3: float = 0.0
    watertight: bool = False
    brep: Any = None
    face_count: int = 0
    features: list[dict] = field(default_factory=list)
    catalog_info: dict | None = None
    warnings: list[str] = field(default_factory=list)
    error: str | None = None
    digest: str | None = None


class GeometryCache:
    """Thread-safe cache of built body geometry keyed by its geometry inputs."""

    def __init__(self):
        self._items: dict[str, BuiltBody] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> BuiltBody | None:
        with self._lock:
            return self._items.get(key)

    def put(self, key: str, value: BuiltBody) -> None:
        with self._lock:
            self._items[key] = value


def _material(body: DesignBody, override: dict | None) -> RenderMaterial:
    if override:
        return RenderMaterial(override.get("name", "material"), override.get("color", body.material.color), float(override.get("metallic", 0.0)),
                              float(override.get("roughness", 0.5)), float(override.get("opacity", 1.0)))
    m = body.material
    return RenderMaterial(m.name, m.color, m.metallic, m.roughness, m.opacity)


def geometry_key(body: DesignBody, catalog_entry: dict | None, tolerance: float) -> str:
    payload = {
        "kernel": KERNEL_VERSION,
        "kind": body.kind,
        "shape": body.shape.model_dump(mode="json") if body.shape else None,
        "features": [f.model_dump(mode="json") for f in body.features],
        "material": body.material.model_dump(mode="json"),
        "catalog": {"id": body.catalog_id, "dims": (catalog_entry or {}).get("physical", {}).get("dimensions_mm")} if body.kind == "purchased" else None,
        "tolerance": tolerance,
    }
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def _deflection(lo: np.ndarray, hi: np.ndarray, tolerance: float) -> float:
    diag = float(np.linalg.norm(hi - lo))
    return max(tolerance * 0.5, min(tolerance * 4, diag * 0.002))


def build_body(body: DesignBody, catalog_entry: dict | None, tolerance: float, asset_loader: Callable[[str], bytes] | None) -> BuiltBody:
    try:
        if body.kind == "purchased":
            if catalog_entry is None:
                raise GeometryError(f"catalog id {body.catalog_id!r} is not in the catalog")
            regions, info = catalog_regions(catalog_entry)
            out = BuiltBody(body.id, "catalog", info["geometry_source"], catalog_info=info, warnings=list(info["notes"]))
            return _finish_brep(out, body, regions, tolerance)
        assert body.shape is not None
        if body.shape.type == "occupancy":
            mesh, info = freeform.build_occupancy(body.shape)
            out = BuiltBody(body.id, "mesh", "freeform_occupancy", warnings=list(info["warnings"]))
            return _finish_mesh(out, body, mesh, info)
        if body.shape.type == "mesh_reference":
            mesh, info = freeform.build_mesh_reference(body.shape, asset_loader)
            out = BuiltBody(body.id, "mesh", "imported_mesh")
            return _finish_mesh(out, body, mesh, info)
        regions = build_regions(body.shape)
        out = BuiltBody(body.id, "brep", "parametric")
        if body.features:
            primary = regions[0]
            solid, statuses = apply_brep(primary.shape, body.features)
            regions[0] = type(primary)(primary.name, solid, primary.material)
            out.features = statuses
        return _finish_brep(out, body, regions, tolerance)
    except GeometryError as exc:
        return BuiltBody(body.id, "failed", "none", error=str(exc))
    except Exception as exc:  # noqa: BLE001 - kernel exceptions carry no user-safe text
        return BuiltBody(body.id, "failed", "none", error=f"geometry kernel error ({type(exc).__name__})")


def _finish_brep(out: BuiltBody, body: DesignBody, regions, tolerance: float) -> BuiltBody:
    from .geometry.occ import fuse_all

    lo = hi = None
    for r in regions:
        a, b = brep_bounds(r.shape)
        lo = a if lo is None else np.minimum(lo, a)
        hi = b if hi is None else np.maximum(hi, b)
    deflection = _deflection(lo, hi, tolerance)
    meshes = []
    for r in regions:
        mesh = tessellate(r.shape, deflection)
        out.regions.append((r.name, mesh, _material(body, r.material), r.shape))
        meshes.append(mesh)
        out.face_count += int(mesh.face_groups.max()) + 1 if mesh.face_groups is not None and len(mesh.face_groups) else 0
    out.brep = fuse_all([r.shape for r in regions]) if len(regions) > 1 else regions[0].shape
    out.volume_mm3 = float(brep_volume(out.brep))
    welded = weld(TriMesh.merge(meshes))
    out.local_mesh = welded
    manifold, reason = to_manifold(welded)
    if manifold is None and len(meshes) > 1:  # multi-region parts: union the region meshes
        parts = [to_manifold(weld(m))[0] for m in meshes]
        if all(p is not None for p in parts):
            import manifold3d

            manifold = manifold3d.Manifold.batch_boolean(parts, manifold3d.OpType.Add)
            reason = None
    out.manifold = manifold
    out.watertight = manifold is not None
    if manifold is None:
        out.warnings.append(f"collision checks use bounding boxes for this body: {reason}")
    out.local_bounds = (lo, hi)
    out.digest = hashlib.sha256((mesh_digest(welded) + "|" + "|".join(f"{n}:{m.key()}" for n, _, m, _ in out.regions)).encode()).hexdigest()
    return out


def _finish_mesh(out: BuiltBody, body: DesignBody, mesh: TriMesh, info: dict) -> BuiltBody:
    manifold, reason = to_manifold(mesh)
    if manifold is not None and body.features:
        manifold, statuses = apply_mesh(manifold, body.features)
        out.features = statuses
        mesh = from_manifold(manifold)
    elif body.features:
        out.features = [{"id": f.id, "type": f.type, "status": "skipped", "note": "freeform mesh is not closed; features need a closed body"} for f in body.features]
    out.regions.append(("main", mesh, _material(body, None), None))
    out.local_mesh = weld(mesh)
    out.manifold = manifold
    out.watertight = manifold is not None and edge_manifold_report(out.local_mesh)["watertight"]
    out.volume_mm3 = float(manifold.volume()) if manifold is not None else abs(out.local_mesh.volume())
    if manifold is None:
        out.warnings.append(f"freeform mesh is visual-only for checks: {reason}")
    out.local_bounds = out.local_mesh.bounds()
    out.digest = hashlib.sha256((mesh_digest(out.local_mesh) + "|" + out.regions[0][2].key().__repr__()).encode()).hexdigest()
    out.warnings.extend(f"{k}: {v}" for k, v in info.items() if k in ("scale",))
    return out


def _validate(spec: dict | DesignSpec, catalog: dict[str, dict]) -> DesignSpec:
    try:
        model = DesignSpec.model_validate(spec)
    except ValidationError as exc:
        raise DesignValidationError([
            {"loc": ".".join(str(p) for p in e["loc"]), "message": e["msg"], "type": e["type"]} for e in exc.errors()
        ]) from None
    errors = []
    for b in model.bodies:
        if b.kind == "purchased" and b.catalog_id not in catalog:
            errors.append({"loc": f"bodies.{b.id}.catalog_id", "message": f"{b.catalog_id!r} is not a Rivet catalog product (ungrounded product id)", "type": "ungrounded_product"})
    if errors:
        raise DesignValidationError(errors)
    return model


def _placed(spec: DesignSpec, built: dict[str, BuiltBody], world: dict[str, np.ndarray]) -> list[collision.PlacedBody]:
    out = []
    for body in spec.bodies:
        b = built.get(body.id)
        if b is None or b.local_mesh is None or body.id not in world:
            continue
        m = world[body.id]
        mesh = b.local_mesh.transformed(m)
        manifold = b.manifold.transform(m[:3, :].tolist()) if b.manifold is not None else None
        lo, hi = mesh.bounds()
        out.append(collision.PlacedBody(body.id, body.kind, body.parent_id, body.attachment.contact if body.attachment else None,
                                        body.attachment.clearance_mm if body.attachment else 0.0, mesh, manifold, b.volume_mm3, lo, hi, body.role, body.internal))
    return out


def _ground(spec: DesignSpec, built: dict[str, BuiltBody], solve: constraints.SolveResult) -> None:
    pts = [apply(solve.world[b.id], built[b.id].local_mesh.vertices) for b in spec.bodies if b.id in solve.world and built[b.id].local_mesh is not None]
    if not pts:
        return
    allp = np.vstack(pts)
    lo, hi = allp.min(axis=0), allp.max(axis=0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    t = translation(shift)
    for k in solve.world:
        solve.world[k] = t @ solve.world[k]
    for j in solve.joints:
        j["position_mm"] = [round(float(v + s), 4) for v, s in zip(j["position_mm"], shift)]
    solve.grounding_shift_mm = [round(float(v), 4) for v in shift]


def solve_and_ground(spec: DesignSpec, built: dict[str, BuiltBody], joint_values: dict[str, float] | None = None) -> constraints.SolveResult:
    bounds = {k: v.local_bounds for k, v in built.items() if v.local_bounds is not None}
    result = constraints.solve(spec, bounds, joint_values, ground=False)
    _ground(spec, built, result)
    return result


def _scene_extras(spec: DesignSpec, digest: str | None, partial: bool) -> dict:
    return {"rivet_schema": "2.0", "subject": spec.subject, "mode": spec.mode, "strategy": spec.strategy, "spec_digest": digest, "is_partial": partial}


def _sweeps(spec: DesignSpec, built: dict[str, BuiltBody], solve: constraints.SolveResult, placed: list[collision.PlacedBody]) -> list[dict]:
    hits = []
    for body in spec.bodies:
        att = body.attachment
        if att is None or att.joint not in ("hinge", "shaft", "slide") or att.limits[1] - att.limits[0] <= 1e-9 or body.id not in solve.world:
            continue
        moving_ids = set(solve.subtree(body.id, spec))
        static = [p for p in placed if p.id not in moving_ids]
        samples = []
        for value in np.linspace(att.limits[0], att.limits[1], 9):
            alt = solve_and_ground(spec, built, {body.id: float(value)})
            # keep the static bodies fixed: undo any grounding difference
            delta = solve.world[body.parent_id] @ np.linalg.inv(alt.world[body.parent_id]) if body.parent_id in alt.world else np.eye(4)
            world = {k: delta @ alt.world[k] for k in moving_ids if k in alt.world}
            samples.append((float(value), _placed(spec, built, world)))
        hits.extend(collision.moving_sweep(static, samples, body.id, body.parent_id or ""))
    return hits


def compile_design(
    spec: dict | DesignSpec,
    catalog: list[dict],
    *,
    output_dir: str | Path,
    seed: int = 0,
    progress: Callable[[dict], None] | None = None,
    asset_loader: Callable[[str], bytes] | None = None,
    cache: GeometryCache | None = None,
    write_exports: bool = True,
) -> dict:
    """Compile a DesignSpec into placed geometry, checks and exports (see module docstring)."""
    catalog_map = {c["catalog_id"]: c for c in catalog}
    model = _validate(spec, catalog_map)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    digest_spec = spec_digest(model)
    emit = progress or (lambda event: None)
    tolerance = model.constraints.mesh_tolerance_mm
    built: dict[str, BuiltBody] = {}
    order = constraints.topological_order(model)
    by_depth: dict[int, list[DesignBody]] = {}
    depth_of: dict[str, int] = {}
    for b in order:
        depth_of[b.id] = 0 if b.parent_id is None else depth_of[b.parent_id] + 1
        by_depth.setdefault(depth_of[b.id], []).append(b)
    chunks: list[list[DesignBody]] = []
    for d in sorted(by_depth):
        group = by_depth[d]
        for i in range(0, len(group), PREVIEW_CHUNK):
            chunks.append(group[i : i + PREVIEW_CHUNK])
    previews: list[dict] = []
    preview_dir = out / "previews"
    for ci, chunk in enumerate(chunks):
        for body in chunk:
            entry = catalog_map.get(body.catalog_id) if body.catalog_id else None
            key = geometry_key(body, entry, tolerance)
            hit = cache.get(key) if cache else None
            if hit is None:
                hit = build_body(body, entry, tolerance, asset_loader)
                if cache and hit.error is None:
                    cache.put(key, hit)
            built[body.id] = hit
            emit({"event": "body_built", "body_id": body.id, "status": "failed" if hit.error else "ok", "error": hit.error})
        partial = solve_and_ground(model, built)
        placed_ids = [b.id for b in model.bodies if b.id in partial.world and built.get(b.id) and built[b.id].local_mesh is not None]
        if not placed_ids or ci == len(chunks) - 1:
            continue
        nodes = [exports.node_for(b, built[b.id], partial.world[b.id], exports.body_extras(b, built[b.id], "built")) for b in model.bodies if b.id in placed_ids]
        path = preview_dir / f"preview-{len(previews) + 1}.glb"
        sha = exports.write_glb(path, nodes, _scene_extras(model, digest_spec, True))
        snap = {"index": len(previews) + 1, "path": str(path), "sha256": sha, "body_ids": placed_ids, "is_partial": True,
                "new_body_ids": [b.id for b in chunk if b.id in placed_ids]}
        previews.append(snap)
        emit({"event": "geometry_preview", **snap})

    solve = solve_and_ground(model, built)
    placed = _placed(model, built, solve.world)
    warnings: list[str] = []
    failed = [{"body_id": k, "error": v.error, "required": next(b.required for b in model.bodies if b.id == k)} for k, v in built.items() if v.error]
    failed_features = []
    for body in model.bodies:
        b = built.get(body.id)
        for st in (b.features if b else []):
            if st["status"] != "applied":
                req = next((f.required for f in body.features if f.id == st["id"]), False)
                failed_features.append({"body_id": body.id, **st, "required": req})
    for body in model.bodies:
        for w in (built[body.id].warnings if body.id in built else []):
            warnings.append(f"{body.id}: {w}")

    collisions = collision.check(placed, model.constraints.min_general_clearance_mm)
    sweeps = _sweeps(model, built, solve, placed)
    catalog_masses = {b.id: (catalog_map.get(b.catalog_id) or {}).get("physical", {}).get("mass_g") for b in model.bodies if b.kind == "purchased"}
    masses = {}
    for body in model.bodies:
        b = built.get(body.id)
        if b is None or b.error:
            continue
        masses[body.id] = stability.body_mass(body.kind, b.volume_mm3, body.material.name, body.material.density_g_cm3, catalog_masses.get(body.id))
    stab = stability.analyze(placed, masses)
    children: dict[str, list[str]] = {}
    for b in model.bodies:
        if b.parent_id:
            children.setdefault(b.parent_id, []).append(b.id)
    mfg = manufacturing.analyze(model, {k: {"representation": v.representation, "volume_mm3": v.volume_mm3, "local_bounds": v.local_bounds,
                                              "watertight": v.watertight, "mesh": v.local_mesh} for k, v in built.items() if v.local_mesh is not None}, children, masses)
    access = {}
    if model.mode == "engineered":
        for p in placed:
            body = next(b for b in model.bodies if b.id == p.id)
            if body.kind == "purchased" and (catalog_map.get(body.catalog_id) or {}).get("ports"):
                access[p.id] = collision.access_rays(p, placed)
    all_lo = np.min([p.lo for p in placed], axis=0) if placed else np.zeros(3)
    all_hi = np.max([p.hi for p in placed], axis=0) if placed else np.zeros(3)
    size = all_hi - all_lo
    within = bool(np.all(size <= np.array(model.constraints.max_bounds_mm) + 1e-6))
    unresolved_required = [u for u in solve.unresolved if next(b.required for b in model.bodies if b.id == u["body_id"])]
    roots = [b.id for b in model.bodies if b.parent_id is None]
    counts = {
        "hard_collisions": len(collisions["hard_collisions"]),
        "sweep_collisions": len(sweeps),
        "clearance_violations": len(collisions["clearance_violations"]),
        "cosmetic_overlaps": len(collisions["cosmetic_overlaps"]),
        "unresolved_required_mounts": len(unresolved_required),
        "invalid_hierarchy_cycles": 0,
        "failed_bodies": len(failed),
        "failed_required_bodies": sum(1 for f in failed if f["required"]),
        "failed_required_features": sum(1 for f in failed_features if f["required"]),
        "floating_bodies": 0,
        "blocking_manufacturing_issues": sum(1 for i in mfg["issues"] if i["severity"] == "blocking"),
        "missing_purchased_part_geometry_source": sum(1 for b in built.values() if b.catalog_info and b.catalog_info["geometry_source"] == "catalog_bounding_box"),
        "blocked_access": sum(1 for a in access.values() if not a["open"]),
    }
    blocking = []
    if counts["hard_collisions"]:
        blocking.append("hard collisions between physical parts")
    if counts["sweep_collisions"]:
        blocking.append("moving joints collide within their range")
    if counts["unresolved_required_mounts"]:
        blocking.append("required parts could not be attached")
    if counts["failed_required_bodies"]:
        blocking.append("required parts failed to build")
    if counts["failed_required_features"]:
        blocking.append("required features failed")
    if not within:
        blocking.append("design exceeds its maximum bounds")
    if model.constraints.must_be_stable and stab.get("verdict") == "unstable":
        blocking.append("design is statically unstable")
    if model.mode == "engineered" and counts["blocking_manufacturing_issues"]:
        blocking.append("blocking manufacturability issues")
    report = {
        "status": "valid" if not blocking else "invalid",
        "blocking": blocking,
        "counts": counts,
        "collisions": collisions,
        "sweeps": sweeps,
        "connectivity": {
            "roots": roots,
            "standalone": [b.id for b in model.bodies if b.parent_id is None and b.standalone],
            "unresolved": solve.unresolved,
            "max_depth": max(solve.depth.values()) if solve.depth else 0,
            "connected": not solve.unresolved,
            "note": "every placed body is attached through a named anchor chain to a root",
        },
        "stability": stab,
        "manufacturing": mfg,
        "access": access,
        "failed_bodies": failed,
        "feature_issues": failed_features,
        "bounds_mm": {"min": [round(float(v), 3) for v in all_lo], "max": [round(float(v), 3) for v in all_hi], "size": [round(float(v), 3) for v in size]},
        "within_max_bounds": within,
        "units": "mm",
        "frame": "right-handed, Y up, Z toward the front; grounded on y = 0 and centred on x = z = 0",
    }

    manifest = []
    for body in model.bodies:
        b = built.get(body.id)
        status = "failed" if b is None or b.error else "unplaced" if body.id not in solve.world else "placed"
        entry = {
            "body_id": body.id,
            "name": body.name,
            "role": body.role,
            "tags": body.tags,
            "kind": body.kind,
            "parent_id": body.parent_id,
            "internal": body.internal,
            "required": body.required,
            "status": status,
            "error": b.error if b else None,
            "representation": b.representation if b else None,
            "geometry_source": b.geometry_source if b else None,
            "transform_mm": quantize(solve.world[body.id]) if body.id in solve.world else None,
            "local_bounds_mm": {"min": [round(float(v), 4) for v in b.local_bounds[0]], "max": [round(float(v), 4) for v in b.local_bounds[1]]} if b and b.local_bounds else None,
            "bounds_mm": None,
            "geometry_digest": b.digest if b else None,
            "volume_mm3": round(b.volume_mm3, 3) if b else None,
            "face_count": b.face_count if b else 0,
            "triangles": int(len(b.local_mesh.faces)) if b and b.local_mesh is not None else 0,
            "watertight": b.watertight if b else False,
            "mass": masses.get(body.id),
            "material": body.material.model_dump(mode="json"),
            "regions": [{"name": n, "material": {"name": m.name, "color": m.color, "metallic": m.metallic, "roughness": m.roughness}} for n, _, m, _ in (b.regions if b else [])],
            "features": b.features if b else [],
            "manufacturing": body.manufacturing,
            "catalog": b.catalog_info if b else None,
            "catalog_id": body.catalog_id,
            "provenance": body.provenance.model_dump(mode="json"),
            "warnings": b.warnings if b else [],
        }
        p = next((x for x in placed if x.id == body.id), None)
        if p is not None:
            entry["bounds_mm"] = {"min": [round(float(v), 4) for v in p.lo], "max": [round(float(v), 4) for v in p.hi]}
        manifest.append(entry)

    digest_payload = {
        "kernel": KERNEL_VERSION,
        "spec": digest_spec,
        "bodies": [[e["body_id"], e["geometry_digest"], e["transform_mm"], e["status"]] for e in manifest],
    }
    geometry_digest = hashlib.sha256(canonical_json(digest_payload)).hexdigest()
    scene_path = out / "scene.glb"
    nodes = [exports.node_for(b, built[b.id], solve.world[b.id], exports.body_extras(b, built[b.id], "placed")) for b in model.bodies if b.id in solve.world and built[b.id].local_mesh is not None]
    scene_sha = exports.write_glb(scene_path, nodes, {**_scene_extras(model, digest_spec, False), "geometry_digest": geometry_digest})
    final_snap = {"index": len(previews) + 1, "path": str(scene_path), "sha256": scene_sha, "body_ids": [n.name for n in nodes], "is_partial": False,
                  "new_body_ids": chunks[-1] and [b.id for b in chunks[-1]] or []}
    previews.append(final_snap)
    emit({"event": "geometry_preview", **final_snap})

    assets: list[dict] = []
    if write_exports:
        for body in model.bodies:
            b = built.get(body.id)
            if b is None or b.error or b.local_mesh is None:
                continue
            assets.extend(exports.write_part_assets(out, body, b))
        assets.append(exports.write_assembly_step(out / "assembly.step", model, built, solve.world))
    bom = exports.bom_rows(model, catalog_map, masses, mfg)
    steps = exports.assembly_steps(model, solve)
    result = {
        "schema_version": "2.0",
        "kernel": kernel_versions(),
        "seed": seed,
        "spec_digest": digest_spec,
        "geometry_digest": geometry_digest,
        "scene_asset_path": str(scene_path),
        "scene_sha256": scene_sha,
        "part_manifest": manifest,
        "joints": solve.joints,
        "geometry_report": report,
        "manufacturing_assets": assets,
        "preview_snapshots": previews,
        "bom": bom,
        "assembly_steps": steps,
        "warnings": warnings,
    }
    (out / "manifest.json").write_text(json.dumps({k: v for k, v in result.items() if k != "kernel"} | {"kernel": result["kernel"]}, sort_keys=True, indent=1))
    return result


def geometry_feasible(result: dict) -> bool:
    return result["geometry_report"]["status"] == "valid"


def compile_spec_copy(spec: dict) -> dict:
    return copy.deepcopy(spec)
