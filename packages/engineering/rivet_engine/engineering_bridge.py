"""Functional gates for generated designs, delegated to the existing engine.

The generated geometry never decides electrical validity. When a design's purchased
electronics match a stack the engine has a tested wiring and firmware profile for
(today: the 2WD differential-drive rover), the engine builds and verifies its own
BuildPlan v1 for that stack; its electrical, firmware, sourcing and budget findings are
reported as authoritative, and its template-only mechanical findings are listed as
superseded by the generated geometry's checks. Anything else is reported as
unsupported with the reason, never as verified.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from typing import Any

from .design_ir.models import DesignSpec, spec_digest

ROVER_PROFILE = "rover_2wd_differential"
AUTHORITATIVE_PREFIXES = ("electrical.", "firmware.", "sourcing.", "budget.")
SUPERSEDED_PREFIXES = ("mechanical.", "integrity.", "completeness.")


def _finding(rule_id: str, result: str, severity: str, message: str, ids: list[str] | None = None) -> dict:
    return {"rule_id": rule_id, "result": result, "severity": severity, "affected_body_ids": ids or [], "message": message}


def _rover_intent(model: DesignSpec, digest: str) -> dict:
    return {
        "schema_version": "1.0",
        "intent_id": f"design-{digest[:16]}",
        "input": {"kind": "text", "image_asset_id": None, "user_text": model.subject[:2000], "image_interpretation_is_approximate": True},
        "project_family": "rover",
        "requested_behavior": "obstacle_avoidance",
        "visual_features": list(model.visual_goal.signature_features)[:12],
        "requirements": {"max_budget": None, "currency": "USD", "max_length_mm": None, "max_width_mm": None,
                         "preferred_controller_catalog_id": None, "required_capabilities": ["differential_drive", "distance_sensing"], "preferred_color": None},
        "assumptions": ["Electronics stack taken from the generated design's purchased parts"],
        "unknowns": [],
        "confidence": "medium",
        "support_status": "supported",
    }


def _sourcing(model: DesignSpec, catalog: dict[str, dict]) -> dict:
    rows, unverified, unknown = [], [], []
    for b in model.bodies:
        if b.kind != "purchased":
            continue
        entry = catalog.get(b.catalog_id)
        if entry is None:
            unknown.append(b.id)
            continue
        sku = (entry.get("identity") or {}).get("sku")
        url = (entry.get("sourcing") or {}).get("purchase_url")
        verified = bool(sku) and isinstance(url, str) and url.startswith("https://")
        rows.append({"body_id": b.id, "catalog_id": b.catalog_id, "sku": sku, "purchase_url": url, "verified_product": verified})
        if not verified:
            unverified.append(b.id)
    return {"purchased": rows, "unverified_claims": unverified, "unknown_catalog_ids": unknown}


def evaluate(spec: dict | DesignSpec, catalog_records: list[dict] | None = None) -> dict[str, Any]:
    from . import get_catalog, solve
    from .configurator import DEFAULT_SELECTION

    model = DesignSpec.model_validate(spec)
    records = catalog_records if catalog_records is not None else get_catalog()
    catalog = {c["catalog_id"]: c for c in records}
    sourcing = _sourcing(model, catalog)
    purchased = [b for b in model.bodies if b.kind == "purchased"]
    by_cat = Counter((catalog.get(b.catalog_id) or {}).get("identity", {}).get("category", "unknown") for b in purchased)
    by_id = Counter(b.catalog_id for b in purchased)
    findings: list[dict] = []
    if sourcing["unknown_catalog_ids"]:
        findings.append(_finding("sourcing.ungrounded_product", "FAIL", "blocking", "Purchased bodies reference products that are not in the Rivet catalog", sourcing["unknown_catalog_ids"]))
    base = {"profile": None, "linked_plan": None, "body_map": {}, "connections": [], "superseded_template_findings": [], "sourcing": sourcing,
            "firmware": {"supported": False, "reason": "no tested firmware profile for this design"}, "electrical_status": "not_applicable"}
    if model.mode == "concept_only":
        return {**base, "status": "not_applicable", "reason": "concept-only design: no electrical, firmware or purchase claims are made", "findings": findings}
    if not purchased:
        findings.append(_finding("engineering.no_electronics", "UNKNOWN", "advisory", "The design has no purchased electronics; only its mechanical geometry is checked"))
        return {**base, "status": "needs_review", "reason": "mechanical design only", "findings": findings}

    motors, drivers, controllers = by_cat.get("motor", 0), by_cat.get("motor_driver", 0), by_cat.get("controller", 0)
    if controllers == 1 and drivers == 1 and motors == 2:
        digest = spec_digest(model)
        plan = solve(_rover_intent(model, digest))
        need = {
            "controller": DEFAULT_SELECTION.controller, "motor_driver": DEFAULT_SELECTION.motor_driver, "motor": DEFAULT_SELECTION.motor,
            "distance_sensor": DEFAULT_SELECTION.distance_sensor, "motor_power": DEFAULT_SELECTION.motor_power, "controller_power": DEFAULT_SELECTION.controller_power,
        }
        expected = Counter({need["controller"]: 1, need["motor_driver"]: 1, need["motor"]: 2, need["distance_sensor"]: 1, need["motor_power"]: 1, need["controller_power"]: 1})
        missing = {cid: n - by_id.get(cid, 0) for cid, n in expected.items() if by_id.get(cid, 0) < n}
        engine_ids = {c["catalog_id"] for c in plan["components"]}
        if DEFAULT_SELECTION.wheel in engine_ids and by_id.get(DEFAULT_SELECTION.wheel, 0) < 2:
            findings.append(_finding("engineering.wheel_hub_fit", "UNKNOWN", "blocking",
                                     f"TT motors need wheels with a documented TT hub fit ({DEFAULT_SELECTION.wheel}); the design uses other wheels"))
        if missing:
            findings.append(_finding("engineering.stack_mismatch", "FAIL", "blocking",
                                     "The engine's tested rover stack needs parts the design does not include: " + ", ".join(f"{n} x {cid}" for cid, n in sorted(missing.items()))))
        authoritative, superseded = [], []
        for f in plan["verification"]["findings"]:
            item = {"rule_id": f["rule_id"], "result": f["result"], "severity": f["severity"], "message": f["message"], "source": "rivet_engine.verify"}
            (authoritative if f["rule_id"].startswith(AUTHORITATIVE_PREFIXES) else superseded).append(item)
        findings.extend(authoritative)
        # map engine instances onto design bodies (same catalog id, left/right by order)
        pool: dict[str, list[str]] = {}
        for b in purchased:
            pool.setdefault(b.catalog_id, []).append(b.id)
        body_map = {}
        for comp in plan["components"]:
            ids = pool.get(comp["catalog_id"])
            if ids:
                body_map[comp["instance_id"]] = ids.pop(0)
        blocking_fail = any(f["severity"] == "blocking" and f["result"] == "FAIL" for f in findings)
        blocking_unknown = any(f["severity"] == "blocking" and f["result"] == "UNKNOWN" for f in findings)
        warn = any(f["result"] in ("WARN", "UNKNOWN") for f in findings)
        electrical = "unbuildable" if blocking_fail else "needs_review" if blocking_unknown else "verified_with_warnings" if warn else "verified"
        firmware = plan["firmware"]
        return {
            **base,
            "status": electrical,
            "electrical_status": electrical,
            "reason": "electronics match the engine's tested 2WD rover stack; findings below come from the engine",
            "profile": ROVER_PROFILE,
            "linked_plan": plan,
            "body_map": body_map,
            "connections": [{**c, "from_body": body_map.get(c["from"]["instance_id"]), "to_body": body_map.get(c["to"]["instance_id"])} for c in plan["connections"]],
            "superseded_template_findings": superseded,
            "firmware": {"supported": firmware["compile_status"] != "not_supported" and not missing, "target": firmware["target"], "profile_id": firmware["profile_id"],
                         "pin_map": firmware["pin_map"], "compile_status": firmware["compile_status"],
                         "reason": None if not missing else "the design does not contain the full tested stack"},
            "findings": findings,
            "plan_digest": hashlib.sha256(repr(sorted(c["catalog_id"] for c in plan["components"])).encode()).hexdigest(),
        }
    if motors > 2:
        findings.append(_finding("engineering.motor_channels", "FAIL", "blocking",
                                 f"{motors} drive motors exceed the 2-channel motor driver profile; Rivet has no tested {motors}-motor wiring or firmware profile",
                                 [b.id for b in purchased if (catalog.get(b.catalog_id) or {}).get("identity", {}).get("category") == "motor"]))
        return {**base, "status": "unsupported", "electrical_status": "unsupported", "reason": f"{motors}-motor drive is not a supported electrical configuration", "findings": findings}
    findings.append(_finding("engineering.no_profile", "UNKNOWN", "blocking",
                             "No tested wiring/firmware profile covers this combination: " + ", ".join(f"{n} {k}" for k, n in sorted(by_cat.items()))))
    return {**base, "status": "unsupported", "electrical_status": "unsupported", "reason": "electronics combination has no tested profile", "findings": findings}


def claims(mode: str, geometry_report: dict, engineering: dict, visual_overall: float | None) -> dict:
    """Separate statuses per claim type; buildability is never derived from appearance."""
    geometric = "valid" if geometry_report["status"] == "valid" else "invalid"
    mfg_blocking = geometry_report["counts"]["blocking_manufacturing_issues"]
    manufacturability = "not_applicable" if not geometry_report["manufacturing"]["parts"] else "issues" if mfg_blocking or geometry_report["manufacturing"]["issues"] else "pass"
    electrical = engineering.get("electrical_status", engineering.get("status"))
    firmware = "supported" if engineering.get("firmware", {}).get("supported") else "not_supported"
    if mode == "concept_only":
        buildability = "concept_only"
    elif geometric == "invalid" or electrical == "unbuildable":
        buildability = "unbuildable"
    elif electrical == "unsupported":
        buildability = "unsupported"
    else:
        buildability = "needs_review"  # custom mounts and purchased-part fit are never verified by geometry alone
    return {
        "visual_similarity": {"score": visual_overall, "subjective": True},
        "geometric_validity": geometric,
        "manufacturability": manufacturability,
        "electrical": electrical,
        "firmware": firmware,
        "buildability": buildability,
    }
