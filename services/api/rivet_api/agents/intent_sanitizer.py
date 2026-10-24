"""Deterministic clean-up of an IntentSpec before anything else uses it.

Whatever a model returned, the support decision, user-stated requirements and the
input block are decided here by code. Nothing in this module judges hardware validity.
"""

import re
import unicodedata

from rivet_api.models.intent import IntentInput, IntentRequirements, IntentSpec
from rivet_api.models.requests import GenerateRequest

KNOWN_CAPABILITIES = ("differential_drive", "distance_sensing")
HIDDEN_ELECTRONICS_NOTE = "Hidden electronics are not inferable from the image"
MAX_LIST_ITEMS = 12
MAX_TEXT_CHARS = 200
_COLOR_RE = re.compile(r"^(#[0-9A-Fa-f]{6}|[A-Za-z][A-Za-z -]{0,31})$")


def _clean_text(value: str) -> str:
    kept = "".join(ch for ch in value if unicodedata.category(ch) not in ("Cc", "Cf") or ch == " ")
    return kept.strip()[:MAX_TEXT_CHARS]


def _clean_list(items: list[str]) -> list[str]:
    cleaned = (_clean_text(i) for i in items)
    return [c for c in cleaned if c][:MAX_LIST_ITEMS]


def _support_status(intent: IntentSpec) -> str:
    if intent.project_family == "rover":
        return "unsupported" if intent.requested_behavior == "line_following" else "supported"
    if intent.project_family == "rc_car":
        return "planned"
    return "unsupported"


def sanitize_intent(raw: IntentSpec, catalog_ids: set[str], request: GenerateRequest) -> IntentSpec:
    stated = request.requirements.model_dump(exclude_none=True) if request.requirements else {}
    controller = raw.requirements.preferred_controller_catalog_id
    color = raw.requirements.preferred_color
    requirements = IntentRequirements(
        max_budget=stated.get("max_budget"),
        currency=stated.get("currency", "USD"),
        max_length_mm=stated.get("max_length_mm"),
        max_width_mm=stated.get("max_width_mm"),
        preferred_controller_catalog_id=controller if controller in catalog_ids else None,
        required_capabilities=[c for c in raw.requirements.required_capabilities if c in KNOWN_CAPABILITIES],
        preferred_color=stated.get("preferred_color") or (color if color and _COLOR_RE.match(color) else None),
    )
    assumptions = _clean_list(raw.assumptions)
    if request.input.image_asset_id and HIDDEN_ELECTRONICS_NOTE not in assumptions:
        assumptions.append(HIDDEN_ELECTRONICS_NOTE)
    return raw.model_copy(
        update={
            "input": IntentInput(
                kind=request.input.kind,
                image_asset_id=request.input.image_asset_id,
                user_text=request.input.user_text,
                image_interpretation_is_approximate=True,
            ),
            "requirements": requirements,
            "visual_features": _clean_list(raw.visual_features),
            "assumptions": assumptions,
            "unknowns": _clean_list(raw.unknowns),
            "support_status": _support_status(raw),
        }
    )
