"""Mechanical checks (B4 category 3). Geometry is a box model; results say so."""

from __future__ import annotations

from rivet_engine.models import Finding
from rivet_engine.validators.common import PlanView, Rule

OVERLAP_TOLERANCE_MM = 0.5
GROUND_TOLERANCE_MM = 2.0


def _mates(parent_mount, child_mount) -> bool:
    if child_mount.kind not in parent_mount.allowed_mates:
        return False
    return not child_mount.allowed_mates or parent_mount.kind in child_mount.allowed_mates


def check(view: PlanView) -> list[Finding]:
    plan, ctx = view.plan, view.context
    out: list[Finding] = []

    mates = Rule("mechanical.mount_mates", pass_message="Every mounted part uses a compatible mount pair")
    for c in plan.components:
        if not (c.attached_to_mount_id and c.own_mount_id and c.parent_instance_id):
            continue
        parent, own = view.component(c.parent_instance_id), view.component(c.instance_id)
        pm = parent.mount(c.attached_to_mount_id) if parent else None
        om = own.mount(c.own_mount_id) if own else None
        if pm is None or om is None:
            continue  # reported by integrity.mounts
        if _mates(pm, om):
            mates.ok([c.instance_id])
        else:
            mates.fail(
                f"{c.instance_id} mount {om.mount_id!r} ({om.kind}) cannot mate with {pm.mount_id!r} ({pm.kind}) on {c.parent_instance_id}",
                [c.instance_id, c.parent_instance_id],
            )
    out += mates.result()

    approx = Rule("mechanical.geometry_approximated", "advisory")
    approximated = [
        c.instance_id
        for c in plan.components
        if c.role != "accessory"
        and (comp := view.component(c.instance_id)) is not None
        and (not comp.physical.bounds_verified or comp.evidence.dimensions != "verified")
    ]
    if approximated:
        approx.unknown(
            "Placement uses approximated or unverified dimensions/mount positions for these parts; poses are a model, not measured CAD",
            approximated,
            severity="advisory",
        )
    else:
        approx.applicable = False
    out += approx.result()

    placed = [c for c in plan.components if c.role != "accessory" and view.component(c.instance_id) is not None]
    overlap = Rule("mechanical.overlap", "advisory", "No unexpected bounding-box overlaps between parts")
    ground = Rule("mechanical.ground_contact", "advisory", "Wheels and caster reach the same ground plane")
    if ctx.bounds is None:
        overlap.unknown("No geometry bounds helper supplied; overlaps were not checked", severity="advisory")
        ground.unknown("No geometry bounds helper supplied; ground contact was not checked", severity="advisory")
        out += overlap.result() + ground.result()
        req = ctx.requirements
        if req is not None and (req.max_length_mm is not None or req.max_width_mm is not None):
            size = Rule("requirements.dimensions")
            size.unknown("Size limits were requested but no geometry bounds helper was supplied")
            out += size.result()
        return out

    boxes = {}
    for c in placed:
        box = ctx.bounds(c, view.component(c.instance_id))
        if box is None:
            overlap.unknown(f"{c.instance_id} has no usable bounds", [c.instance_id], severity="advisory")
        else:
            boxes[c.instance_id] = box

    def ancestors(iid: str) -> set[str]:
        out_, cur = set(), view.by_id[iid].parent_instance_id
        while cur is not None and cur in view.by_id and cur not in out_:
            out_.add(cur)
            cur = view.by_id[cur].parent_instance_id
        return out_

    ids = sorted(boxes)
    for i, a in enumerate(ids):
        for b in ids[i + 1 :]:
            if a in ancestors(b) or b in ancestors(a):
                continue  # parts sit on or inside their parent by design
            if boxes[a].overlaps(boxes[b], OVERLAP_TOLERANCE_MM):
                overlap.warn(f"Bounding boxes of {a} and {b} overlap (box model; may be a false positive)", [a, b])
            else:
                overlap.ok([a, b])
    out += overlap.result()

    contacts = [c.instance_id for c in placed if c.role in ("wheel", "caster") and c.instance_id in boxes]
    if len(contacts) < 3:
        ground.unknown("Fewer than three ground-contact parts to check", contacts, severity="advisory")
    else:
        lows = {iid: boxes[iid].min_mm[1] for iid in contacts}
        if max(lows.values()) - min(lows.values()) > GROUND_TOLERANCE_MM:
            ground.warn(
                "Wheels and caster do not reach the same height: "
                + ", ".join(f"{k} {v:.1f} mm" for k, v in sorted(lows.items())),
                contacts,
            )
        else:
            ground.ok(contacts)
        others = [iid for iid, box in boxes.items() if iid not in contacts and box.min_mm[1] < min(lows.values()) - GROUND_TOLERANCE_MM]
        if others:
            ground.warn("Parts extend below the wheels' ground plane", others)
    out += ground.result()

    size = Rule("requirements.dimensions", pass_message="Overall size is within the requested limits")
    req = ctx.requirements
    size.applicable = req is not None and (req.max_length_mm is not None or req.max_width_mm is not None)
    if size.applicable and boxes:
        width = max(b.max_mm[0] for b in boxes.values()) - min(b.min_mm[0] for b in boxes.values())
        length = max(b.max_mm[2] for b in boxes.values()) - min(b.min_mm[2] for b in boxes.values())
        for name, actual, limit in (("width", width, req.max_width_mm), ("length", length, req.max_length_mm)):
            if limit is not None and actual > limit:
                size.fail(f"Overall {name} {actual:.1f} mm exceeds the {limit} mm limit")
        if not size.findings and approximated:
            size.warn(f"Within limits ({width:.0f} x {length:.0f} mm) but based on approximated geometry", approximated)
    out += size.result()
    return out
