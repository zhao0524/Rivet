"""Deterministic mechanical placement for the 2WD rover template (B2).

Frames: millimetres, right-handed, Y up, Z forward. A component's local origin is the
centre of its bounding box; mount positions/rotations are given in that local frame.
Rotations are XYZ Euler degrees in the three.js convention (R = Rx * Ry * Rz), so the
renderer can apply `rotation_deg` directly.

    world_child = world_parent * parent_mount * offset * inverse(child_mount)
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from functools import cache
from pathlib import Path
from typing import Any

from rivet_engine.models import CatalogComponent, ComponentInstance, Mount, Pose
from rivet_engine.ports import (
    AABB,
    Catalog,
    PlacementError,
    PlacementOptions,
    PlacementResult,
    RoverSelection,
    finding,
)

TEMPLATE_PATH = Path(__file__).resolve().parent / "data" / "templates" / "rover_2wd.json"

Matrix = tuple[tuple[float, ...], ...]  # 4x4 row-major


# --- rigid transforms ------------------------------------------------------------------


def _rotation(rx: float, ry: float, rz: float) -> list[list[float]]:
    a, b, c = (math.radians(v) for v in (rx, ry, rz))
    ca, sa, cb, sb, cc, sc = math.cos(a), math.sin(a), math.cos(b), math.sin(b), math.cos(c), math.sin(c)
    # Rx * Ry * Rz
    return [
        [cb * cc, -cb * sc, sb],
        [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
        [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
    ]


def matrix(position: Sequence[float], rotation_deg: Sequence[float]) -> Matrix:
    r = _rotation(*rotation_deg)
    return (
        (r[0][0], r[0][1], r[0][2], float(position[0])),
        (r[1][0], r[1][1], r[1][2], float(position[1])),
        (r[2][0], r[2][1], r[2][2], float(position[2])),
        (0.0, 0.0, 0.0, 1.0),
    )


def multiply(a: Matrix, b: Matrix) -> Matrix:
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)) for i in range(4))


def inverse(m: Matrix) -> Matrix:
    # Rigid transform: inverse rotation is the transpose; translation is -R^T t.
    rt = [[m[j][i] for j in range(3)] for i in range(3)]
    t = [m[i][3] for i in range(3)]
    ti = [-sum(rt[i][k] * t[k] for k in range(3)) for i in range(3)]
    return (
        (rt[0][0], rt[0][1], rt[0][2], ti[0]),
        (rt[1][0], rt[1][1], rt[1][2], ti[1]),
        (rt[2][0], rt[2][1], rt[2][2], ti[2]),
        (0.0, 0.0, 0.0, 1.0),
    )


def transform_point(m: Matrix, p: Sequence[float]) -> tuple[float, float, float]:
    return tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3))  # type: ignore[return-value]


def _clean(value: float, digits: int) -> float:
    rounded = round(value, digits)
    return 0.0 if rounded == 0 else rounded  # no "-0.0" in the output


def to_pose(m: Matrix) -> Pose:
    # Decompose R = Rx * Ry * Rz (three.js Euler 'XYZ').
    m13 = max(-1.0, min(1.0, m[0][2]))
    y = math.asin(m13)
    if abs(m13) < 0.9999999:
        x = math.atan2(-m[1][2], m[2][2])
        z = math.atan2(-m[0][1], m[0][0])
    else:
        x = math.atan2(m[2][1], m[1][1])
        z = 0.0
    # -180 and 180 are the same angle; always emit 180 so output is byte-stable.
    rotation = [_clean(math.degrees(v), 4) for v in (x, y, z)]
    return Pose(
        position_mm=[_clean(m[i][3], 3) for i in range(3)],
        rotation_deg=[180.0 if r == -180.0 else r for r in rotation],
    )


def pose_matrix(pose: Pose) -> Matrix:
    return matrix(pose.position_mm, pose.rotation_deg)


def mount_matrix(mount: Mount) -> Matrix:
    return matrix(mount.position_mm, mount.rotation_deg)


def compose(parent: Pose, mount: Mount) -> Pose:
    """World pose of a mount frame on a component placed at `parent`."""
    return to_pose(multiply(pose_matrix(parent), mount_matrix(mount)))


def place_child(parent_world: Matrix, parent_mount: Mount, child_mount: Mount, offset_mm: Sequence[float] = (0, 0, 0)) -> Matrix:
    offset = matrix(offset_mm, (0, 0, 0))
    return multiply(multiply(multiply(parent_world, mount_matrix(parent_mount)), offset), inverse(mount_matrix(child_mount)))


def mates(parent_mount: Mount, child_mount: Mount) -> bool:
    """Legal when each side lists the other's kind (an empty child list accepts any parent)."""
    if child_mount.kind not in parent_mount.allowed_mates:
        return False
    return not child_mount.allowed_mates or parent_mount.kind in child_mount.allowed_mates


# --- bounds --------------------------------------------------------------------------


def local_corners(component: CatalogComponent) -> list[tuple[float, float, float]]:
    d = component.physical.dimensions_mm
    hx, hy, hz = d.x / 2, d.y / 2, d.z / 2
    return [(sx * hx, sy * hy, sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]


def world_aabb(instance: ComponentInstance, component: CatalogComponent) -> AABB | None:
    """Conservative world AABB of the component's rotated bounding box, or None if unbounded."""
    d = component.physical.dimensions_mm
    if min(d.x, d.y, d.z) <= 0:
        return None
    m = pose_matrix(instance.pose)
    points = [transform_point(m, c) for c in local_corners(component)]
    return AABB(
        min_mm=tuple(min(p[i] for p in points) for i in range(3)),  # type: ignore[arg-type]
        max_mm=tuple(max(p[i] for p in points) for i in range(3)),  # type: ignore[arg-type]
    )


# --- template placement ------------------------------------------------------------------


@cache
def load_template(path: str = str(TEMPLATE_PATH)) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def _own_mount(component: CatalogComponent, candidates: Sequence[str], instance_id: str) -> Mount:
    for mount_id in candidates:
        mount = component.mount(mount_id)
        if mount is not None:
            return mount
    raise PlacementError(
        f"{component.catalog_id} has no mount usable for {instance_id}",
        {"instance_id": instance_id, "catalog_id": component.catalog_id, "expected_one_of": list(candidates)},
    )


def _check_offset(instance_id: str, offset: Sequence[float], limits: dict[str, Any]) -> None:
    limit = limits.get(instance_id)
    if limit is None:
        raise PlacementError(
            f"{instance_id} has no adjustable offset in this template",
            {"instance_id": instance_id, "adjustable": sorted(limits)},
        )
    lo, hi = limit["min_mm"], limit["max_mm"]
    if len(offset) != 3 or not all(lo[i] <= offset[i] <= hi[i] for i in range(3)):
        raise PlacementError(
            f"Offset {list(offset)} for {instance_id} is outside the template range",
            {"instance_id": instance_id, "offset_mm": list(offset), "min_mm": lo, "max_mm": hi},
        )


def place_rover(
    selection: RoverSelection, catalog: Catalog, options: PlacementOptions = PlacementOptions()
) -> PlacementResult:
    template = load_template()
    limits = template["offset_limits"]
    slot_ids = {s["instance_id"] for s in template["slots"]}
    unknown = sorted(set(options.mount_offsets) - slot_ids)
    if unknown:
        raise PlacementError("Offsets given for instances not in the template", {"instance_ids": unknown})
    for instance_id, offset in sorted(options.mount_offsets.items()):
        _check_offset(instance_id, offset, limits)

    worlds: dict[str, Matrix] = {}
    placed: list[dict[str, Any]] = []
    used_mounts: set[tuple[str, str]] = set()
    for slot in template["slots"]:
        iid = slot["instance_id"]
        catalog_id = getattr(selection, slot["selection"])
        component = catalog.get(catalog_id)
        if component is None:
            raise PlacementError(f"Selected {slot['selection']} {catalog_id!r} is not in the catalog", {"instance_id": iid})
        parent_id = slot["parent"]
        if parent_id is None:
            worlds[iid] = matrix((0, 0, 0), (0, 0, 0))
            placed.append({"slot": slot, "component": component, "parent_mount": None, "own_mount": None})
            continue
        parent = next(p for p in placed if p["slot"]["instance_id"] == parent_id)
        parent_component: CatalogComponent = parent["component"]
        parent_mount = parent_component.mount(slot["parent_mount"])
        if parent_mount is None:
            raise PlacementError(
                f"{parent_component.catalog_id} has no mount {slot['parent_mount']!r} needed by {iid}",
                {"instance_id": iid, "parent_catalog_id": parent_component.catalog_id, "mount_id": slot["parent_mount"]},
            )
        if (parent_id, parent_mount.mount_id) in used_mounts:
            raise PlacementError(f"Mount {parent_mount.mount_id!r} on {parent_id} is already occupied", {"instance_id": iid})
        own = _own_mount(component, slot["own_mount"], iid)
        if not mates(parent_mount, own):
            raise PlacementError(
                f"{component.catalog_id} mount {own.mount_id!r} ({own.kind}) cannot mate with "
                f"{parent_component.catalog_id} mount {parent_mount.mount_id!r} ({parent_mount.kind})",
                {"instance_id": iid, "child_kind": own.kind, "parent_kind": parent_mount.kind, "allowed": parent_mount.allowed_mates},
            )
        used_mounts.add((parent_id, parent_mount.mount_id))
        offset = options.mount_offsets.get(iid, (0.0, 0.0, 0.0))
        worlds[iid] = place_child(worlds[parent_id], parent_mount, own, offset)
        placed.append({"slot": slot, "component": component, "parent_mount": parent_mount, "own_mount": own})

    # Drop the whole assembly so the lowest ground-contact point sits on y = 0.
    contacts = [p for p in placed if p["slot"]["role"] in template["ground_contact_roles"]]
    lowest = min(
        transform_point(worlds[p["slot"]["instance_id"]], c)[1] for p in contacts for c in local_corners(p["component"])
    )
    lift = matrix((0, -lowest, 0), (0, 0, 0))

    components: list[ComponentInstance] = []
    for p in placed:
        slot = p["slot"]
        iid = slot["instance_id"]
        components.append(
            ComponentInstance(
                instance_id=iid,
                catalog_id=p["component"].catalog_id,
                role=slot["role"],
                parent_instance_id=slot["parent"],
                attached_to_mount_id=p["parent_mount"].mount_id if p["parent_mount"] else None,
                own_mount_id=p["own_mount"].mount_id if p["own_mount"] else None,
                pose=to_pose(multiply(lift, worlds[iid])),
                render_overrides=dict(options.render_overrides.get(iid, {})),
            )
        )

    accessory_parent = next(c for c in components if c.instance_id == template["accessory_parent"])
    for n, catalog_id in enumerate(selection.accessories, start=1):
        if catalog_id not in catalog:
            raise PlacementError(f"Accessory {catalog_id!r} is not in the catalog", {"catalog_id": catalog_id})
        iid = f"accessory-{n}"
        components.append(
            ComponentInstance(
                instance_id=iid,
                catalog_id=catalog_id,
                role="accessory",
                parent_instance_id=accessory_parent.instance_id,
                attached_to_mount_id=None,
                own_mount_id=None,
                pose=accessory_parent.pose.model_copy(deep=True),
                # Loose kit items (wires, cells, breadboard) have no modeled position.
                render_overrides={**options.render_overrides.get(iid, {}), "visible": False},
            )
        )

    approximated = [
        c.instance_id
        for c in components
        if c.role != "accessory"
        and (not catalog.require(c.catalog_id).physical.bounds_verified or catalog.require(c.catalog_id).evidence.dimensions != "verified")
    ]
    findings = []
    if approximated:
        findings.append(
            finding(
                "mechanical.geometry_approximated",
                "UNKNOWN",
                "advisory",
                "Placement uses approximated or unverified dimensions/mount positions for these parts; poses are a model, not measured CAD",
                approximated,
            )
        )
    return PlacementResult(template_id=template["template_id"], components=tuple(components), findings=tuple(findings))


def offset_limits() -> dict[str, dict[str, Any]]:
    """Template-defined adjustable offsets (instance_id -> {min_mm, max_mm, notes})."""
    return json.loads(json.dumps(load_template()["offset_limits"]))
