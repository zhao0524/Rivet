"""Deterministic clean-up of an IntentSpec before anything else uses it.

Whatever a model returned, the support decision, user-stated requirements and the
input block are decided here by code. Nothing in this module judges hardware validity.
"""

import re
import unicodedata
from typing import Any, get_args

from rivet_api.models.intent import (
    IMAGE_TEXT_MAX_CHARS,
    ChassisSize,
    ImageFeatures,
    IntentInput,
    IntentRequirements,
    IntentSpec,
    RangeSensorKind,
    RangeSensorPosition,
    WheelSize,
)
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


_FEATURE_ENUMS = {
    "range_sensor_position": get_args(RangeSensorPosition),
    "range_sensor_kind": get_args(RangeSensorKind),
    "wheel_size": get_args(WheelSize),
    "chassis_size": get_args(ChassisSize),
}


def _feature_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return " ".join(_clean_text(value).split())[:IMAGE_TEXT_MAX_CHARS].strip() or None


def _image_features(raw: IntentSpec, request: GenerateRequest) -> ImageFeatures | None:
    """Visible traits exist only when an image was sent. Every value is checked against the
    contract again (anything else becomes null) and text is cleaned and capped."""
    if raw.image_features is None or not request.input.image_asset_id:
        return None
    given = raw.image_features.model_dump()
    count, caster = given.get("drive_wheel_count"), given.get("has_caster")
    return ImageFeatures(
        drive_wheel_count=count if type(count) is int and 1 <= count <= 8 else None,
        has_caster=caster if isinstance(caster, bool) else None,
        **{name: given.get(name) if given.get(name) in allowed else None for name, allowed in _FEATURE_ENUMS.items()},
        body_color=_feature_text(given.get("body_color")),
        visible_controller=_feature_text(given.get("visible_controller")),
    )


def _support_status(intent: IntentSpec) -> str:
    if intent.project_family == "rover":
        # Only obstacle_avoidance has a supported firmware and simulation profile; the
        # engine refuses the rest (rivet_engine.configurator.check_supported). Marking
        # them unsupported here lets the intake offer the closest-supported-rover choice
        # instead of the generate job failing with a 422 after a "supported" card.
        if intent.requested_behavior in ("line_following", "manual_drive"):
            return "unsupported"
        return "supported"
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
            "image_features": _image_features(raw, request),
        }
    )
