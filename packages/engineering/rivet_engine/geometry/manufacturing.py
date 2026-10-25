"""Manufacturability checks and fabricated-part specifications.

Rules are explicit and conservative: minimum wall from the dimensioned shape parameters,
build-volume fit, closed mesh for printing, overhang share, and slender unsupported
members (cantilevers). Costs are rule-of-thumb material estimates, never quotes.
"""
from __future__ import annotations

import numpy as np

from ..design_ir.models import DesignBody, DesignSpec, Shape
from .stability import material_key

PRINT_COST_USD_PER_G = {"pla": 0.025, "petg": 0.028, "abs": 0.025, "asa": 0.03, "tpu": 0.045, "nylon": 0.06, "resin": 0.08}
SHEET_COST_USD_PER_CM2 = {"acrylic": 0.02, "plywood": 0.01, "aluminum": 0.05, "aluminium": 0.05, "steel": 0.04}
SLENDER_WARN = 12.0
SLENDER_FAIL = 25.0


def _walls(shape: Shape) -> list[tuple[float, str]]:
    t = shape.type
    out: list[tuple[float, str]] = []
    if t == "tube":
        out.append((shape.wall_mm, "tube wall"))
    elif t == "shell":
        out.append((shape.wall_mm, "shell wall"))
    elif t == "occupancy" and shape.hollow:
        out.append((shape.wall_mm, "hollow wall"))
    elif t in ("box", "plate", "rounded_box"):
        out.append((min(shape.dimensions_mm), f"{t} thickness"))
    elif t == "extrude_profile":
        out.append((shape.height_mm, "extrusion height"))
    elif t == "wheel":
        out.append((shape.wall_mm, "tyre thickness"))
    elif t in ("cylinder", "cone", "capsule"):
        out.append((2 * min(shape.radius_mm, shape.radius_top_mm or shape.radius_mm), f"{t} diameter"))
    elif t == "sweep" and not shape.profile_mm:
        out.append((2 * shape.radius_mm, "swept diameter"))
    if t in ("boolean", "shell"):
        for c in shape.children:
            out.extend(_walls(c))
    return out


def min_wall(body: DesignBody) -> tuple[float, str] | None:
    if body.shape is None:
        return None
    walls = _walls(body.shape)
    for f in body.features:
        if f.type == "shell":
            walls.append((f.wall_mm, f"feature {f.id} shell wall"))
    return min(walls) if walls else None


def overhang_fraction(mesh_vertices: np.ndarray, faces: np.ndarray) -> float:
    v = mesh_vertices
    n = np.cross(v[faces[:, 1]] - v[faces[:, 0]], v[faces[:, 2]] - v[faces[:, 0]])
    area = 0.5 * np.linalg.norm(n, axis=1)
    unit = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    floor = v[:, 1].min()
    centroid_y = v[faces].mean(axis=1)[:, 1]
    down = (unit[:, 1] < -0.7071) & (centroid_y > floor + 0.2)
    total = area.sum()
    return float(area[down].sum() / total) if total > 0 else 0.0


def analyze(spec: DesignSpec, compiled: dict[str, dict], children: dict[str, list[str]], masses: dict[str, dict]) -> dict:
    """compiled[body_id] has: representation, volume_mm3, local_bounds (lo, hi), watertight,
    mesh (local TriMesh). Returns per-part specs and issues."""
    parts, issues = [], []
    engineered = spec.mode == "engineered"
    printer = sorted(spec.constraints.printer_volume_mm)
    for body in spec.bodies:
        info = compiled.get(body.id)
        if info is None or body.kind == "purchased":
            continue
        lo, hi = info["local_bounds"]
        ext = np.asarray(hi) - np.asarray(lo)
        dims = sorted(float(v) for v in ext)
        wall = min_wall(body)
        slender = (dims[2] / max(dims[0], 1e-6)) if dims[0] > 0 else float("inf")
        is_leaf = not children.get(body.id)
        cantilever = slender > SLENDER_WARN and body.parent_id is not None and is_leaf
        carried = sum(float((masses.get(c) or {}).get("mass_g") or 0) for c in children.get(body.id, []))
        if body.kind == "fabricated":
            route = body.manufacturing
            record = {
                "body_id": body.id,
                "name": body.name,
                "route": route,
                "material": body.material.name,
                "bbox_mm": [round(v, 2) for v in ext.tolist()],
                "volume_cm3": round(info["volume_mm3"] / 1000.0, 3),
                "mass_g": (masses.get(body.id) or {}).get("mass_g"),
                "min_wall_mm": None if wall is None else round(wall[0], 3),
                "watertight": info["watertight"],
                "representation": info["representation"],
                "exports": ["step", "stl"] if info["representation"] == "brep" and info["watertight"] else ["stl"] if info["watertight"] else [],
                "checks": [],
                "estimate_usd": None,
                "estimate_basis": None,
            }
            mat = material_key(body.material.name)
            if route == "3d_print":
                fits = all(d <= p for d, p in zip(dims, printer))
                record["checks"].append({"rule": "print.build_volume", "result": "PASS" if fits else "FAIL",
                                         "message": f"{'fits' if fits else 'does not fit'} a {printer[2]:g} x {printer[1]:g} x {printer[0]:g} mm build volume"})
                if not fits:
                    issues.append({"body_id": body.id, "rule": "print.build_volume", "severity": "blocking" if engineered else "advisory", "message": f"{body.name} exceeds the printer build volume; split it or use another route"})
                if not info["watertight"]:
                    issues.append({"body_id": body.id, "rule": "print.closed_mesh", "severity": "blocking" if engineered else "advisory", "message": f"{body.name} is not a closed solid, so it cannot be sliced"})
                share = overhang_fraction(info["mesh"].vertices, info["mesh"].faces) if not info["mesh"].empty else 0.0
                record["checks"].append({"rule": "print.overhang", "result": "WARN" if share > 0.2 else "PASS", "message": f"{share:.0%} of the surface overhangs more than 45 degrees in the current orientation"})
                rate = next((v for k, v in PRINT_COST_USD_PER_G.items() if mat == k or mat.startswith(k + "_")), None)
                if rate and record["mass_g"]:
                    record["estimate_usd"] = round(record["mass_g"] * rate, 2)
                    record["estimate_basis"] = f"{record['mass_g']:.1f} g of {mat.upper()} at about ${rate:.3f}/g filament; estimate, not a quote"
            elif route in ("sheet_cut", "laser_cut"):
                flat = body.shape is not None and body.shape.type in ("plate", "extrude_profile", "box")
                record["checks"].append({"rule": "sheet.flat_part", "result": "PASS" if flat else "FAIL", "message": "constant-thickness part" if flat else "not a constant-thickness plate"})
                if not flat:
                    issues.append({"body_id": body.id, "rule": "sheet.flat_part", "severity": "blocking" if engineered else "advisory", "message": f"{body.name} is not a flat plate, so it cannot be sheet cut"})
                rate = next((v for k, v in SHEET_COST_USD_PER_CM2.items() if mat == k or mat.startswith(k + "_")), None)
                if rate:
                    area = ext[0] * ext[2] / 100.0
                    record["estimate_usd"] = round(area * rate, 2)
                    record["estimate_basis"] = f"{area:.0f} cm2 of {mat} sheet; estimate, not a quote"
            elif route == "cnc":
                record["checks"].append({"rule": "cnc.review", "result": "UNKNOWN", "message": "machinability (tool access, internal corners) needs a machinist's review"})
                record["estimate_basis"] = "CNC parts need a shop quote"
            elif route == "molded":
                record["checks"].append({"rule": "molded.review", "result": "UNKNOWN", "message": "draft angles and tooling are not checked"})
            parts.append(record)
            if wall is not None and wall[0] < spec.constraints.min_wall_mm - 1e-9:
                issues.append({"body_id": body.id, "rule": "manufacturing.min_wall", "severity": "blocking" if engineered else "advisory",
                               "message": f"{body.name}: {wall[1]} is {wall[0]:g} mm, below the {spec.constraints.min_wall_mm:g} mm minimum",
                               "value_mm": wall[0], "required_mm": spec.constraints.min_wall_mm})
        if cantilever and body.kind in ("fabricated", "concept_visual"):
            failing = slender > SLENDER_FAIL and body.kind == "fabricated"
            issues.append({
                "body_id": body.id, "rule": "structure.unsupported_cantilever",
                "severity": "blocking" if failing and engineered else "advisory",
                "message": f"{body.name} is a slender unsupported member (length {dims[2]:.0f} mm, thinnest section {dims[0]:.1f} mm, ratio {slender:.0f}:1)"
                           + ("; too thin to be self-supporting" if failing else "; check stiffness"),
                "slenderness": round(slender, 2),
            })
        if body.kind == "fabricated" and carried > 0 and dims[0] < 3.0 and slender > SLENDER_WARN:
            issues.append({"body_id": body.id, "rule": "structure.thin_load_path", "severity": "blocking" if engineered else "advisory",
                           "message": f"{body.name} is {dims[0]:.1f} mm thick and carries {carried:.0f} g of attached parts"})
    return {"parts": parts, "issues": issues, "rules": {"slender_warn": SLENDER_WARN, "slender_fail": SLENDER_FAIL, "min_wall_mm": spec.constraints.min_wall_mm}}
