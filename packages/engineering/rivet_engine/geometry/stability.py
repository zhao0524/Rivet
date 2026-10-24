"""Static stability: masses with provenance, centre of mass, support polygon and margin.

Masses come from the catalog (purchased, when documented), from volume x a known
material density (fabricated), or are estimated (concept visuals with a density) or
UNKNOWN. Unknown masses are never set equal: the margin is reported as a range over
plausible values, and the verdict is `uncertain` when that range crosses zero. This is a
static rigid-body check on a flat floor, not a structural or dynamic safety analysis.
"""
from __future__ import annotations

import numpy as np

from .collision import PlacedBody

DENSITY_G_CM3 = {
    "pla": 1.24, "petg": 1.27, "abs": 1.04, "asa": 1.07, "tpu": 1.21, "nylon": 1.14, "resin": 1.18,
    "aluminum": 2.70, "aluminium": 2.70, "steel": 7.85, "stainless_steel": 8.0, "brass": 8.5,
    "acrylic": 1.18, "polycarbonate": 1.20, "plywood": 0.60, "wood": 0.60, "carbon_fiber": 1.60, "rubber": 1.20,
    "glass": 2.50, "silicone": 1.10,
}
FALLBACK_DENSITY = 1.1  # only used to bound unknown masses, never reported as a mass
CONTACT_TOLERANCE_MM = 0.5


def material_density(name: str, explicit: float | None) -> tuple[float | None, str]:
    if explicit:
        return explicit, "explicit"
    key = material_key(name)
    for k, v in DENSITY_G_CM3.items():
        if key == k or key.startswith(k + "_"):
            return v, f"table:{k}"
    return None, "unknown material"


def material_key(name: str) -> str:
    return name.strip().lower().replace(" ", "_").replace("-", "_")


def body_mass(kind: str, volume_mm3: float, material_name: str, explicit_density: float | None, catalog_mass_g: float | None) -> dict:
    if kind == "purchased":
        if catalog_mass_g:
            return {"mass_g": round(float(catalog_mass_g), 3), "source": "catalog", "verified": True}
        return {"mass_g": None, "source": "unknown", "verified": False, "note": "catalog has no documented mass"}
    density, how = material_density(material_name, explicit_density)
    if density is None:
        return {"mass_g": None, "source": "unknown", "verified": False, "note": f"no density for material {material_name!r}"}
    mass = volume_mm3 / 1000.0 * density
    if kind == "fabricated":
        return {"mass_g": round(mass, 3), "source": "computed", "verified": False, "density_g_cm3": density, "density_source": how}
    return {"mass_g": round(mass, 3), "source": "estimated", "verified": False, "density_g_cm3": density, "density_source": how}


def convex_hull_2d(points: np.ndarray) -> np.ndarray:
    pts = np.unique(np.round(points, 6), axis=0)
    if len(pts) < 3:
        return pts
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 1e-12:
            lower.pop()
        lower.append(p)
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 1e-12:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def signed_margin(polygon: np.ndarray, point: np.ndarray) -> tuple[float, np.ndarray | None]:
    """Distance from point to the polygon boundary, positive inside; plus the outward
    normal of the nearest edge (tip direction)."""
    if len(polygon) < 3:
        return -np.inf, None
    best, normal, inside = np.inf, None, True
    n = len(polygon)
    for i in range(n):
        a, b = polygon[i], polygon[(i + 1) % n]
        e = b - a
        length = np.linalg.norm(e)
        if length < 1e-12:
            continue
        outward = np.array([e[1], -e[0]]) / length  # CCW polygon: right-hand normal points out
        side = float(np.dot(point - a, outward))
        if side > 0:
            inside = False
        t = np.clip(np.dot(point - a, e) / (length * length), 0, 1)
        d = float(np.linalg.norm(point - (a + t * e)))
        if d < best:
            best, normal = d, outward
    return (best if inside else -best), normal


def analyze(bodies: list[PlacedBody], masses: dict[str, dict]) -> dict:
    if not bodies:
        return {"verdict": "unknown", "reason": "no placed bodies"}
    floor = min(float(b.lo[1]) for b in bodies)
    contact_pts, contact_bodies = [], set()
    for b in bodies:
        if b.internal:
            continue
        v = b.mesh.vertices
        low = v[v[:, 1] <= floor + CONTACT_TOLERANCE_MM]
        if len(low):
            contact_pts.append(low[:, [0, 2]])
            contact_bodies.add(b.id)
    polygon = convex_hull_2d(np.vstack(contact_pts)) if contact_pts else np.zeros((0, 2))
    area = 0.0
    if len(polygon) >= 3:
        x, z = polygon[:, 0], polygon[:, 1]
        area = 0.5 * float(np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z))
    known, unknown = [], []
    for b in bodies:
        m = masses.get(b.id, {})
        centroid = b.mesh.centroid() if b.manifold is not None else (b.lo + b.hi) / 2
        if m.get("mass_g"):
            known.append((float(m["mass_g"]), centroid))
        else:
            estimate = max(b.volume_mm3, 0.0) / 1000.0 * FALLBACK_DENSITY
            unknown.append((b.id, estimate, centroid))

    def com(scale: float):
        total = sum(w for w, _ in known) + sum(e * scale for _, e, _ in unknown)
        if total <= 0:
            return None, 0.0
        acc = sum(w * c for w, c in known) + sum(e * scale * c for _, e, c in unknown)
        return acc / total, total

    scenarios = {}
    for label, scale in (("unknown_zero", 0.0), ("unknown_nominal", 1.0), ("unknown_heavy", 3.0)):
        c, total = com(scale)
        if c is None:
            continue
        margin, tip = signed_margin(polygon, np.array([c[0], c[2]]))
        scenarios[label] = {"com_mm": [round(float(v), 3) for v in c], "total_mass_g": round(total, 2), "margin_mm": round(float(margin), 3) if np.isfinite(margin) else None,
                            "tip_direction_xz": None if tip is None else [round(float(v), 4) for v in tip]}
    margins = [s["margin_mm"] for s in scenarios.values() if s["margin_mm"] is not None]
    size = float(np.sqrt(max(area, 1e-9)))
    threshold = max(2.0, 0.05 * size)
    if len(polygon) < 3 or area < 1.0:
        verdict, reason = "unstable", "the parts touching the floor give no support area (a point or line contact)"
    elif not margins:
        verdict, reason = "unknown", "no masses are known"
    elif min(margins) > threshold:
        verdict, reason = "stable", f"centre of mass stays at least {min(margins):.1f} mm inside the support polygon"
    elif max(margins) < 0:
        verdict, reason = "unstable", "centre of mass lies outside the support polygon"
    elif min(margins) < 0 <= max(margins):
        verdict, reason = "uncertain", "unknown masses could move the centre of mass outside the support polygon"
    else:
        verdict, reason = "marginal", f"centre of mass is within {threshold:.1f} mm of the support edge"
    nominal = scenarios.get("unknown_nominal") or next(iter(scenarios.values()), {})
    return {
        "verdict": verdict,
        "reason": reason,
        "support_polygon_xz_mm": [[round(float(x), 3), round(float(z), 3)] for x, z in polygon],
        "support_area_mm2": round(area, 2),
        "contact_bodies": sorted(contact_bodies),
        "com_mm": nominal.get("com_mm"),
        "margin_mm": nominal.get("margin_mm"),
        "margin_range_mm": [min(margins), max(margins)] if margins else None,
        "tip_direction_xz": nominal.get("tip_direction_xz"),
        "scenarios": scenarios,
        "unknown_mass_bodies": [u[0] for u in unknown],
        "known_mass_g": round(sum(w for w, _ in known), 2),
        "limitations": [
            "Static check on a flat, level floor; no dynamics, impacts, slopes or motor torque",
            "Not a structural strength or safety certification",
        ],
    }
