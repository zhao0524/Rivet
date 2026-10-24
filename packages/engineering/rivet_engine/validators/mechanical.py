"""Mechanical checks (B4 category 3). Geometry is a box model; results say so."""

from __future__ import annotations

from rivet_engine.models import Finding
from rivet_engine.validators.common import PlanView, Rule

OVERLAP_TOLERANCE_MM = 0.5
# Largest allowed gap between a part's pose and the pose its mounts imply. Covers template
# offsets (the sensor height adjustment is at most 25 mm) plus rounding.
POSE_TOLERANCE_MM = 30.0
GROUND_TOLERANCE_MM = 2.0


def _mates(parent_mount, child_mount) -> bool:
    if child_mount.kind not in parent_mount.allowed_mates:
        return False
    return not child_mount.allowed_mates or parent_mount.kind in child_mount.allowed_mates


def _pose_consistency(view: PlanView) -> list[Finding]:
    """A mounted part must sit where its parent's mount puts it (within template offsets)."""
    rule = Rule("mechanical.pose_consistency", pass_message="Every mounted part sits at its mount")
    expected_fn = view.context.expected_position
    if expected_fn is None:
        rule.unknown("No mount transform helper supplied; part positions were not checked against their mounts", severity="advisory")
        return rule.result()
    for c in view.plan.components:
        if not (c.attached_to_mount_id and c.own_mount_id and c.parent_instance_id in view.by_id):
            continue
        parent = view.by_id[c.parent_instance_id]
        pc, cc = view.component(parent.instance_id), view.component(c.instance_id)
        pm = pc.mount(c.attached_to_mount_id) if pc else None
        om = cc.mount(c.own_mount_id) if cc else None
        if pm is None or om is None:
            continue  # reported by integrity.mounts
        expected = expected_fn(parent, pm, om)
        gap = sum((a - b) ** 2 for a, b in zip(expected, c.pose.position_mm)) ** 0.5
        if gap > POSE_TOLERANCE_MM:
            rule.fail(f"{c.instance_id} is {gap:.0f} mm from where {parent.instance_id}.{pm.mount_id} places it", [c.instance_id, parent.instance_id])
        else:
            rule.ok([c.instance_id])
    return rule.result()


def _fit_evidence(view: PlanView) -> list[Finding]:
    """Matching mount kinds are a model; this rule asks whether a source documents the fit."""
    fits = view.context.fit_evidence
    if fits is None:
        return []
    rule = Rule("mechanical.fit_evidence", pass_message="Every mounted part's fit is documented by a source")
    for c in view.plan.components:
        if not (c.attached_to_mount_id and c.parent_instance_id in view.by_id):
            continue
        parent = view.by_id[c.parent_instance_id]
        entry = fits.get(f"{parent.catalog_id}#{c.attached_to_mount_id}|{c.catalog_id}")
        ids = [c.instance_id, parent.instance_id]
        if entry is None:
            rule.unknown(f"No fit evidence for {c.catalog_id} on {parent.catalog_id} mount {c.attached_to_mount_id!r}", ids, severity="advisory")
        elif entry["status"] == "documented":
            # One PASS per documented pair, so each source stays visible next to any UNKNOWNs.
            rule.add("PASS", f"{c.instance_id} on {parent.instance_id}.{c.attached_to_mount_id}: {entry.get('note', '')}", ids, [entry.get("source", "")])
        else:
            rule.unknown(f"{c.instance_id} on {parent.instance_id}.{c.attached_to_mount_id}: fit not documented; {entry.get('note', '')}",
                         ids, [entry.get("source", "")], severity=entry.get("severity", "blocking"))
    return rule.result()


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
    out += _fit_evidence(view)
    out += _pose_consistency(view)

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
    unbounded = [c.instance_id for c in placed if c.instance_id not in boxes]
    if size.applicable and unbounded:
        size.unknown("Size limits cannot be confirmed: these parts have no usable bounds", unbounded)
    elif size.applicable and boxes:
        width = max(b.max_mm[0] for b in boxes.values()) - min(b.min_mm[0] for b in boxes.values())
        length = max(b.max_mm[2] for b in boxes.values()) - min(b.min_mm[2] for b in boxes.values())
        for name, actual, limit in (("width", width, req.max_width_mm), ("length", length, req.max_length_mm)):
            if limit is not None and actual > limit:
                size.fail(f"Overall {name} {actual:.1f} mm exceeds the {limit} mm limit")
        if not size.findings and approximated:
            size.warn(f"Within limits ({width:.0f} x {length:.0f} mm) but based on approximated geometry", approximated)
    out += size.result()
    return out
