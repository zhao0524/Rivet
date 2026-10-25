"""Turn a cleaned ConceptModel into a BuildPlan plus the catalog entries it uses.

Concept plans are appearance-only. They never go through the engineering engine, so
they carry their own catalog (`concept_catalog`) of `concept.*` entries that are not
products: no SKU, no purchase link, `bounds_verified` false. Status is always
`needs_review` with a blocking UNKNOWN finding that says nothing was engineered.

Parts that fill a common role (flight controller, microcontroller, motor, ...) get a
hand-picked real product from `reference_parts`: its page as the entry's reference URL and
the BOM line's `manufacturer_reference_only` link, its price per piece, labelled as a suggestion.
A hand-built demo model (`demo_key`) uses that demo's own table instead, which covers every
part; there each entry is priced on the first line that uses it (a canopy drawn as two shapes
is bought once), and markings or sub-pieces point at the product they come with, unpriced.
"""

import math
import re
from datetime import datetime, timezone
from typing import Any

from rivet_api.concept.model import ConceptModel, ConceptPart, part_bounds
from rivet_api.concept.reference_parts import ReferencePart, demo_parts, suggest

CONCEPT_PREFIX = "concept."
CONCEPT_CATALOG_VERSION = "CONCEPT-1.0"
CONCEPT_MANUFACTURER = "Concept (not a sourced part)"

_POSITION_WORDS = re.compile(
    # Standalone numbers only: "Motor 2" groups with "Motor 1", but "4-in-1 ESC" keeps its name.
    r"\b(front|rear|back|left|right|top|bottom|upper|lower|center|centre|middle|inner|outer|fl|fr|rl|rr|(?<![-\w])[0-9]+(?![-\w]))\b[- ]?",
    re.IGNORECASE,
)
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def is_concept_plan(plan: dict[str, Any]) -> bool:
    return str((plan.get("provenance") or {}).get("catalog_version") or "").startswith("CONCEPT")


def _slug(text: str) -> str:
    return _SLUG_RE.sub("-", text.lower()).strip("-")[:40] or "part"


def _base_name(name: str) -> str:
    """'Front-left rotor' and 'Rear right rotor' both become 'Rotor'."""
    stripped = " ".join(_POSITION_WORDS.sub(" ", name).split())
    return (stripped or name).capitalize()


def _bounds(parts: list[ConceptPart]) -> tuple[list[float], list[float]]:
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for p in parts:
        plo, phi = part_bounds(p)
        lo, hi = [min(lo[i], plo[i]) for i in range(3)], [max(hi[i], phi[i]) for i in range(3)]
    return lo, hi


def _catalog_entry(catalog_id: str, part: ConceptPart, name: str, ref: ReferencePart | None = None) -> dict[str, Any]:
    x, y, z = (round(v, 1) for v in part.size_mm)
    entry = {
        "schema_version": "1.0",
        "catalog_id": catalog_id,
        "identity": {"manufacturer": CONCEPT_MANUFACTURER, "model": name, "sku": None, "category": part.category},
        "physical": {
            "dimensions_mm": {"x": x, "y": y, "z": z},
            "mass_g": None,
            "bounds_verified": False,
            "geometry_kind": f"concept:{part.shape}",
            "asset_path": None,
            "material_preset": part.material,
        },
        "mounts": [],
        "ports": [],
        "sourcing": {
            "manufacturer_reference_url": None,
            "datasheet_url": None,
            "purchase_url": None,
            "purchase_url_verified_at": None,
            "price_amount": None,
            "price_currency": None,
            "price_checked_at": None,
            "availability_status": "unknown",
        },
        "evidence": {
            "dimensions": "unknown" if part.internal else "estimated_from_image",
            "electrical": "unknown",
            "price": "unknown",
            "notes": [
                "Typical internal part for this kind of device, inferred because the image cannot show it; not a real product"
                if part.internal
                else "Shape and size estimated from the uploaded image; not a real product"
            ],
        },
    }
    if ref is not None:
        entry["identity"]["model"] = f"{name}: {ref.title}"
        entry["identity"]["manufacturer"] = f"Suggested part from {ref.vendor}"
        entry["sourcing"].update(
            manufacturer_reference_url=ref.url,
            price_amount=ref.unit_price(1),  # set per BOM line once the part count is known
            price_currency=ref.currency,
            price_checked_at=ref.checked_at,
        )
        entry["evidence"]["price"] = "unverified"
        entry["evidence"]["notes"].append(ref.note)
    return entry


def _wire_entry(catalog_id: str, kind: str, thickness: float, ref: ReferencePart | None = None) -> dict[str, Any]:
    entry = _catalog_entry(
        catalog_id,
        ConceptPart(
            name=f"{kind.capitalize()} wire",
            category="wire",
            shape="cylinder",
            size_mm=[thickness, thickness, thickness],
            position_mm=[0, 0, 0],
            material="rubber",
            internal=True,
        ),
        f"{kind.capitalize()} wire, {thickness:g} mm",
        ref,
    )
    entry["physical"]["geometry_kind"] = "concept:cable"
    entry["evidence"]["notes"] = [
        "Typical wiring for this kind of device, inferred; routes are approximate; not a real product",
        *([ref.note] if ref is not None else []),
    ]
    return entry


def build_concept_plan(
    concept: ConceptModel, intent_id: str, input_kind: str, generation_mode: str, demo_key: str | None = None
) -> dict[str, Any]:
    parts = concept.parts
    demo_refs = demo_parts(demo_key) if demo_key else {}
    lo, hi = _bounds(parts)
    # Stand the model on the ground and centre it, whatever frame the model used.
    shift = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2]

    catalog: dict[tuple, dict[str, Any]] = {}
    refs: dict[str, ReferencePart] = {}
    components: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for part in parts:
        name = _base_name(part.name)
        key = (name.lower(), part.category, part.shape, part.material, tuple(round(v) for v in part.size_mm), part.internal)
        if key not in catalog:
            base = f"{CONCEPT_PREFIX}{_slug(name)}"
            catalog_id, n = base, 2
            while any(e["catalog_id"] == catalog_id for e in catalog.values()):
                catalog_id, n = f"{base}-{n}", n + 1
            ref = demo_refs.get(name.lower()) or suggest(concept.object_type, name, part.category)
            catalog[key] = _catalog_entry(catalog_id, part, name, ref)
            if ref is not None:
                refs[catalog_id] = ref
        instance_base = _slug(part.name)
        instance_id, n = f"{instance_base}-1", 1
        while instance_id in used_ids:
            n += 1
            instance_id = f"{instance_base}-{n}"
        used_ids.add(instance_id)
        components.append(
            {
                "instance_id": instance_id,
                "catalog_id": catalog[key]["catalog_id"],
                "role": part.category,
                "parent_instance_id": None,
                "attached_to_mount_id": None,
                "own_mount_id": None,
                "pose": {
                    "position_mm": [round(part.position_mm[i] + shift[i], 2) for i in range(3)],
                    "rotation_deg": [round(v, 2) for v in part.rotation_deg],
                },
                "render_overrides": {"color": part.color, "label": part.name, **({"internal": True} if part.internal else {})},
            }
        )

    # Wires: a cable through the two part centres (and any routing points), drawn by the client.
    centre_by_name = {
        part.name: [part.position_mm[i] + shift[i] for i in range(3)] for part in parts
    }
    id_by_name = {c["render_overrides"]["label"]: c["instance_id"] for c in components}
    for wire in concept.wires:
        points = [centre_by_name[wire.from_part], *([v[i] + shift[i] for i in range(3)] for v in wire.via_mm), centre_by_name[wire.to_part]]
        lo_w = [min(p[i] for p in points) for i in range(3)]
        hi_w = [max(p[i] for p in points) for i in range(3)]
        centre = [(lo_w[i] + hi_w[i]) / 2 for i in range(3)]
        thickness = round(wire.thickness_mm, 1)
        key = ("wire", wire.kind, thickness)
        if key not in catalog:
            catalog_id = f"{CONCEPT_PREFIX}wire-{wire.kind}-{_slug(str(thickness))}"
            ref = demo_refs.get(f"{wire.kind} wire, {thickness:g} mm")
            catalog[key] = _wire_entry(catalog_id, wire.kind, thickness, ref)
            if ref is not None:
                refs[catalog_id] = ref
        instance_base = _slug(wire.name)
        instance_id, n = f"{instance_base}-1", 1
        while instance_id in used_ids:
            n += 1
            instance_id = f"{instance_base}-{n}"
        used_ids.add(instance_id)
        components.append(
            {
                "instance_id": instance_id,
                "catalog_id": catalog[key]["catalog_id"],
                "role": "wire",
                "parent_instance_id": None,
                "attached_to_mount_id": None,
                "own_mount_id": None,
                "pose": {"position_mm": [round(v, 2) for v in centre], "rotation_deg": [0.0, 0.0, 0.0]},
                "render_overrides": {
                    "color": wire.color,
                    "label": wire.name,
                    "internal": True,
                    "path_mm": [[round(p[i] - centre[i], 2) for i in range(3)] for p in points],
                    "thickness_mm": thickness,
                    "connects": [id_by_name[wire.from_part], id_by_name[wire.to_part]],
                    "wire_kind": wire.kind,
                },
            }
        )

    # Internal parts go first, in their own steps: they are installed before the shell closes.
    by_group: dict[tuple[bool, str], list[str]] = {}
    for c in sorted(components, key=lambda c: not c["render_overrides"].get("internal", False)):
        internal = c["render_overrides"].get("internal", False)
        by_group.setdefault((internal, c["role"]), []).append(c["instance_id"])
    steps = [
        {
            "step": i + 1,
            "title": f"Place the internal {category} parts" if internal else f"Place the {category} parts",
            "instance_ids": ids,
            "instructions": (
                "Visual concept only: typical internal parts, inferred (not seen in the image); shows roughly where they sit."
                if internal
                else "Visual concept only: shows where these parts sit, not how to fasten them."
            ),
            "safety_notes": [],
        }
        for i, ((internal, category), ids) in enumerate(by_group.items())
    ]
    internal_ids = [c["instance_id"] for c in components if c["render_overrides"].get("internal")]

    bom_items: dict[str, dict[str, Any]] = {}
    for c in components:
        item = bom_items.setdefault(
            c["catalog_id"],
            {
                "catalog_id": c["catalog_id"],
                "quantity": 0,
                "instance_ids": [],
                "unit_price_amount": None,
                "purchase_url": None,
                "link_status": "not_available",
            },
        )
        item["quantity"] += 1
        item["instance_ids"].append(c["instance_id"])
    by_catalog_id = {e["catalog_id"]: e for e in catalog.values()}
    priced_roles: set[str] = set()
    for item in bom_items.values():
        ref = refs.get(item["catalog_id"])
        if ref is not None:
            entry = by_catalog_id[item["catalog_id"]]
            price = ref.unit_price(item["quantity"])
            if demo_key and price is not None and ref.role in priced_roles:
                price = None
                entry["evidence"]["notes"][-1] = ref.included_note
            if price is None:
                entry["sourcing"].update(price_currency=None, price_checked_at=None)
                entry["evidence"]["price"] = "unknown"
            else:
                priced_roles.add(ref.role)
            entry["sourcing"]["price_amount"] = price
            item.update(unit_price_amount=price, purchase_url=ref.url, link_status="manufacturer_reference_only")
    priced = [i for i in bom_items.values() if i["unit_price_amount"] is not None]
    known_subtotal = f"{sum(float(i['unit_price_amount']) * i['quantity'] for i in priced):.2f}" if priced else None

    all_ids = [c["instance_id"] for c in components]
    size = [round(hi[i] - lo[i]) for i in range(3)]
    return {
        "schema_version": "1.0",
        "build_id": "pending",
        "revision": 1,
        "project_family": "unknown",
        "title": concept.title,
        "source_intent_id": intent_id,
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "needs_review",
        "components": components,
        "connections": [],
        "verification": {
            "overall": "needs_review",
            "findings": [
                {
                    "rule_id": "concept.not_engineered",
                    "result": "UNKNOWN",
                    "severity": "blocking",
                    "affected_instance_ids": all_ids,
                    "message": (
                        f"This is a visual concept of a {concept.object_type} rebuilt from the image. "
                        "Parts are shapes, not sourced products; wiring, power, fit and function were not checked"
                    ),
                    "evidence_urls": [],
                },
                {
                    "rule_id": "concept.geometry_estimated",
                    "result": "WARN",
                    "severity": "advisory",
                    "affected_instance_ids": all_ids,
                    "message": f"Sizes are estimated from the image (about {size[0]} x {size[1]} x {size[2]} mm overall)",
                    "evidence_urls": [],
                },
                *(
                    [
                        {
                            "rule_id": "concept.internals_inferred",
                            "result": "WARN",
                            "severity": "advisory",
                            "affected_instance_ids": internal_ids,
                            "message": (
                                f"{len(internal_ids)} internal parts are typical for a {concept.object_type}, "
                                "inferred rather than seen in the image; their type, size and placement are guesses"
                            ),
                            "evidence_urls": [],
                        }
                    ]
                    if internal_ids
                    else []
                ),
            ],
        },
        "assembly_steps": steps,
        "bom": {
            "currency": "USD",
            "known_subtotal_amount": known_subtotal,
            "total_status": "incomplete" if priced else "not_available",
            "items": list(bom_items.values()),
        },
        "behavior": None,
        "simulation": {
            "kind": "none",
            "enabled": False,
            "wheel_radius_m": None,
            "wheel_base_m": None,
            "max_wheel_speed_mps": None,
            "sensor_range_m": None,
            "sensor_fov_deg": None,
            "limitations": ["Concept model: no motion or physics is simulated"],
        },
        "firmware": {"target": "none", "profile_id": "concept.none", "pin_map": {}, "compile_status": "not_supported"},
        "provenance": {
            "input_mode": input_kind,
            "catalog_version": CONCEPT_CATALOG_VERSION,
            "generation_mode": generation_mode,
            "notes": [
                f"Concept model of a {concept.object_type} ({concept.confidence} confidence); appearance only",
                *concept.assumptions,
            ],
        },
        "concept_catalog": [entry for entry in catalog.values()],
        "concept": {"object_type": concept.object_type, "summary": concept.summary, "confidence": concept.confidence},
    }
