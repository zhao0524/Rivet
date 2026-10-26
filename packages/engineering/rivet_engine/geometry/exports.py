"""Deterministic exports: assembled/partial/per-part GLB, STEP, STL, BOM rows and steps.

Exports are only produced for geometry that supports them: STEP for B-rep bodies, STL
for closed meshes. Anything that cannot be exported is listed with the reason instead.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

from .meshing import GlbNode, encode_glb, encode_stl
from . import occ


def sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def node_for(body, built, world: np.ndarray | None, extras: dict) -> GlbNode:
    prims = [(mesh, mat) for _, mesh, mat, _ in built.regions]
    return GlbNode(body.id, prims, world, extras)


def write_glb(path: Path, nodes: list[GlbNode], scene_extras: dict) -> str:
    data = encode_glb(nodes, scene_extras=scene_extras)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def body_extras(body, built, status: str) -> dict:
    return {
        "body_id": body.id,
        "name": body.name,
        "role": body.role,
        "kind": body.kind,
        "parent_id": body.parent_id,
        "catalog_id": body.catalog_id,
        "internal": body.internal,
        "representation": built.representation if built else None,
        "geometry_source": built.geometry_source if built else None,
        "status": status,
    }


def write_part_assets(out: Path, body, built) -> list[dict]:
    assets = []
    part_dir = out / "parts"
    part_dir.mkdir(parents=True, exist_ok=True)
    glb_path = part_dir / f"{body.id}.glb"
    write_glb(glb_path, [node_for(body, built, None, body_extras(body, built, "built"))], {"part": body.id})
    assets.append({"body_id": body.id, "kind": "glb", "path": str(glb_path), "sha256": sha256_file(glb_path), "purpose": "per-part preview"})
    if body.kind != "fabricated":
        return assets
    if built.brep is not None:
        step_path = part_dir / f"{body.id}.step"
        try:
            occ.write_step(built.brep, step_path)
            assets.append({"body_id": body.id, "kind": "step", "path": str(step_path), "sha256": sha256_file(step_path), "purpose": "fabrication CAD"})
        except occ.GeometryError as exc:
            assets.append({"body_id": body.id, "kind": "step", "path": None, "unavailable": str(exc)})
    else:
        assets.append({"body_id": body.id, "kind": "step", "path": None, "unavailable": "freeform mesh body has no B-rep solid"})
    if built.watertight:
        stl_path = part_dir / f"{body.id}.stl"
        stl_path.write_bytes(encode_stl(built.local_mesh, body.id))
        assets.append({"body_id": body.id, "kind": "stl", "path": str(stl_path), "sha256": sha256_file(stl_path), "purpose": "printing"})
    else:
        assets.append({"body_id": body.id, "kind": "stl", "path": None, "unavailable": "mesh is not closed, so it cannot be printed"})
    return assets


def write_assembly_step(path: Path, spec, built: dict, world: dict) -> dict:
    parts = []
    for body in spec.bodies:
        b = built.get(body.id)
        if b is None or b.brep is None or body.id not in world:
            continue
        color = b.regions[0][2].color if b.regions else "#a8b4c0"
        parts.append((body.id, b.brep, world[body.id], color))
    if not parts:
        return {"kind": "step_assembly", "path": None, "unavailable": "no B-rep bodies in this design"}
    try:
        occ.write_step_assembly(parts, path)
    except Exception as exc:  # noqa: BLE001
        return {"kind": "step_assembly", "path": None, "unavailable": f"STEP assembly export failed: {exc}"}
    return {"kind": "step_assembly", "path": str(path), "sha256": sha256_file(path), "bodies": [p[0] for p in parts],
            "note": "purchased parts are procedural reference envelopes, not manufacturer CAD"}


def bom_rows(spec, catalog: dict, masses: dict, manufacturing: dict) -> dict:
    purchased: dict[str, dict] = {}
    fabricated, visual = [], []
    mfg = {p["body_id"]: p for p in manufacturing.get("parts", [])}
    for body in spec.bodies:
        if body.kind == "purchased":
            entry = catalog.get(body.catalog_id) or {}
            sourcing = entry.get("sourcing", {})
            row = purchased.setdefault(body.catalog_id, {
                "class": "purchased",
                "catalog_id": body.catalog_id,
                "name": (entry.get("identity") or {}).get("model", body.catalog_id),
                "manufacturer": (entry.get("identity") or {}).get("manufacturer"),
                "sku": (entry.get("identity") or {}).get("sku"),
                "quantity": 0,
                "body_ids": [],
                "unit_price": sourcing.get("price_amount"),
                "currency": sourcing.get("price_currency"),
                "purchase_url": sourcing.get("purchase_url"),
                "price_checked_at": sourcing.get("price_checked_at"),
                "verification": "catalog product" if (entry.get("identity") or {}).get("sku") and sourcing.get("purchase_url") else "unverified catalog entry",
            })
            row["quantity"] += 1
            row["body_ids"].append(body.id)
        elif body.kind == "fabricated":
            part = mfg.get(body.id, {})
            fabricated.append({
                "class": "fabricated",
                "body_id": body.id,
                "name": body.name,
                "route": body.manufacturing,
                "material": body.material.name,
                "quantity": 1,
                "mass_g": (masses.get(body.id) or {}).get("mass_g"),
                "estimate_usd": part.get("estimate_usd"),
                "estimate_basis": part.get("estimate_basis") or "no estimate rule for this material/route",
                "verification": "custom part; dimensioned by Rivet, not a distributor product",
            })
        else:
            visual.append({"class": "concept_visual", "body_id": body.id, "name": body.name, "quantity": 1, "verification": "visual only; not a buildable part"})
    known = [float(r["unit_price"]) * r["quantity"] for r in purchased.values() if r["unit_price"]]
    estimates = [f["estimate_usd"] for f in fabricated if f["estimate_usd"]]
    missing_prices = [r["catalog_id"] for r in purchased.values() if not r["unit_price"]]
    return {
        "purchased": sorted(purchased.values(), key=lambda r: r["catalog_id"]),
        "fabricated": fabricated,
        "concept_visual": visual,
        "purchased_known_subtotal": f"{sum(known):.2f}" if known else None,
        "fabricated_estimate_usd": round(sum(estimates), 2) if estimates else None,
        "missing_prices": missing_prices,
        "currency": "USD",
        "note": "Purchased prices come from the catalog's checked listings; fabricated costs are material estimates, not quotes.",
    }


def assembly_steps(spec, solve_result) -> list[dict]:
    """Hierarchical order: the root first, then each attachment level, children grouped by parent."""
    by_id = {b.id: b for b in spec.bodies}
    joints = {j["body_id"]: j for j in solve_result.joints}
    steps = []
    roots = [b for b in spec.bodies if b.parent_id is None and b.id in solve_result.world]
    if roots:
        steps.append({"step": 1, "title": f"Start with the {roots[0].name}", "body_ids": [b.id for b in roots],
                      "instructions": "Place the base part on the work surface" + (f" ({len(roots) - 1} standalone part(s) alongside)" if len(roots) > 1 else "") + ".",
                      "depth": 0})
    depth_groups: dict[tuple[int, str], list[str]] = {}
    internal_first = sorted((b for b in spec.bodies if b.parent_id and b.id in solve_result.world),
                            key=lambda b: (solve_result.depth[b.id], not b.internal, b.parent_id or "", [x.id for x in spec.bodies].index(b.id)))
    for b in internal_first:
        depth_groups.setdefault((solve_result.depth[b.id], b.parent_id), []).append(b.id)
    for (depth, parent_id), ids in depth_groups.items():
        parent = by_id[parent_id]
        lines = []
        for bid in ids:
            j = joints.get(bid, {})
            fast = j.get("fasteners")
            how = f"{fast['count']} x {fast['spec']}" if fast else {"rigid": "fixed", "bolt": "bolted", "face": "face-mounted", "hinge": "hinged", "shaft": "on its shaft", "slide": "on its slide", "slot": "slotted", "side": "side-mounted"}.get(j.get("joint", "rigid"), "fixed")
            lines.append(f"{by_id[bid].name}: {j.get('child_anchor', '?')} to the {j.get('parent_anchor', '?')} of the {parent.name} ({how})")
        names = ", ".join(by_id[i].name for i in ids[:3]) + (f" and {len(ids) - 3} more" if len(ids) > 3 else "")
        steps.append({"step": len(steps) + 1, "title": f"Attach {names} to the {parent.name}", "body_ids": ids, "instructions": "; ".join(lines) + ".", "depth": depth})
    return steps
