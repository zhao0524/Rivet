"""Map visible traits from the reference image onto the rover template (issue #67).

The image proposes; the catalog and the rover_2wd template decide. Every trait in
`IntentSpec.image_features` gets exactly one provenance note with a stable prefix:

    Image applied: <trait>=<value>: ...    changed the build through a validated mechanism
    Image applied: <trait>=<value> (no change needed): ...    the build already matches
    Image ignored: <trait>=<value>: ...    the catalog or template cannot follow it; the
                                           reason names what was kept
    Image did not change the build: ...    once, when no trait changed anything

Only the front range sensor height changes the build today. It uses the template's bounded
sensor-bracket offset, the same one `set_mount_offset_within_template` edits, so placement
bounds and every validator run on the result. No part is swapped on appearance alone and no
rating or SKU is read from an image. Notes are recomputed from the current selection and
offsets whenever a plan is assembled, so they stay true after edits and repairs.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from rivet_engine import mounts, wiring
from rivet_engine.models import ImageFeatures
from rivet_engine.ports import Catalog, RoverSelection, Vec3

APPLIED = "Image applied: "
IGNORED = "Image ignored: "
UNCHANGED = "Image did not change the build: "
NOTE_PREFIXES = (APPLIED, IGNORED, UNCHANGED)

# Sensor bracket offset (mm along the front_sensor mount's y axis) per visible position;
# applied only if the template's offset limits allow it.
SENSOR_HEIGHT_MM = {"front_low": -10.0, "front_mid": 0.0, "front_high": 20.0}

# Report order.
TRAITS = (
    "range_sensor_position",
    "range_sensor_kind",
    "drive_wheel_count",
    "has_caster",
    "wheel_size",
    "chassis_size",
    "body_color",
    "visible_controller",
)
_FREE_TEXT = ("body_color", "visible_controller")

# Sensor kind as named in a catalog record's identity.model ("... Time of Flight ...").
_KIND_WORDS = (("time_of_flight", "time of flight"), ("ultrasonic", "ultrasonic"), ("infrared", "infrared"))
_KIND_LABEL = {"time_of_flight": "time-of-flight", "ultrasonic": "ultrasonic", "infrared": "infrared", "unknown": "unknown type"}

Outcome = Literal["changed", "matched", "ignored"]
_ZERO: Vec3 = (0.0, 0.0, 0.0)


@dataclass(frozen=True)
class _Context:
    selection: RoverSelection
    offsets: Mapping[str, Vec3]
    catalog: Catalog
    profiles: Sequence[dict[str, Any]] | None
    template: Mapping[str, Any]

    @property
    def template_id(self) -> str:
        return self.template["template_id"]

    def slots(self, role: str) -> list[Mapping[str, Any]]:
        return [s for s in self.template["slots"] if s["role"] == role]

    @property
    def sensor_instance(self) -> str | None:
        return next((s["instance_id"] for s in self.slots("distance_sensor")), None)

    def kind_of(self, catalog_id: str) -> str:
        component = self.catalog.get(catalog_id)
        model = component.identity.model.lower() if component else ""
        return next((kind for kind, words in _KIND_WORDS if words in model), "unknown")


def _within_limits(template: Mapping[str, Any], instance_id: str, offset: Vec3) -> bool:
    limit = template["offset_limits"].get(instance_id)
    return limit is not None and all(limit["min_mm"][i] <= offset[i] <= limit["max_mm"][i] for i in range(3))


def _requested_offset(features: ImageFeatures) -> Vec3 | None:
    height = SENSOR_HEIGHT_MM.get(features.range_sensor_position or "")
    return None if height is None else (0.0, height, 0.0)


def mount_offsets(features: ImageFeatures | None, input_kind: str) -> dict[str, Vec3]:
    """Template offsets the image asks for at generation time (empty without an image)."""
    if features is None or input_kind == "text":
        return {}
    template = mounts.load_template()
    sensor = next((s["instance_id"] for s in template["slots"] if s["role"] == "distance_sensor"), None)
    offset = _requested_offset(features)
    if sensor is None or offset is None or offset == _ZERO or not _within_limits(template, sensor, offset):
        return {}
    return {sensor: offset}


def _mm(offset: Sequence[float]) -> str:
    return "[" + ", ".join(f"{v:g}" for v in offset) + "] mm"


def _shown(trait: str, value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if trait in _FREE_TEXT:
        return json.dumps(value)
    return str(value)


# --- one mapper per trait: (outcome, explanation) ------------------------------------


def _sensor_position(value: str, ctx: _Context) -> tuple[Outcome, str]:
    part = ctx.selection.distance_sensor
    if value == "none":
        return "ignored", f"obstacle avoidance needs a front range sensor; kept {part} on the front bracket"
    sensor = ctx.sensor_instance
    requested = (0.0, SENSOR_HEIGHT_MM[value], 0.0)
    if sensor is None or not _within_limits(ctx.template, sensor, requested):
        return "ignored", f"template {ctx.template_id} has no bracket setting for it; kept {part} at the default height"
    current = tuple(float(v) for v in ctx.offsets.get(sensor, _ZERO))
    if current != requested:
        return "ignored", (
            f"a later edit set the {sensor} bracket offset to {_mm(current)}, which replaces the "
            f"{_mm(requested)} the image asked for"
        )
    if requested == _ZERO:
        return "matched", f"{part} ({sensor}) is at the template's default bracket height"
    limit = ctx.template["offset_limits"][sensor]
    lo, hi = limit["min_mm"][1], limit["max_mm"][1]
    direction = "lower" if requested[1] < 0 else "higher"
    return "changed", (
        f"front range sensor {part} ({sensor}) mounted {abs(requested[1]):g} mm {direction} than the "
        f"template default (bracket offset {_mm(requested)}, template range {lo:g} to {hi:g} mm)"
    )


def _sensor_kind(value: str, ctx: _Context) -> tuple[Outcome, str]:
    part = ctx.selection.distance_sensor
    kept = ctx.kind_of(part)
    if value == "unknown":
        return "ignored", f"the sensor type is not identifiable from the image; kept {part} ({_KIND_LABEL[kept]})"
    if value == kept:
        return "matched", f"the build already uses {part}, a {_KIND_LABEL[value]} sensor"
    sensors = sorted(c.catalog_id for c in ctx.catalog.by_category("distance_sensor"))
    offered = [cid for cid in sensors if ctx.kind_of(cid) == value]
    if offered:
        return "ignored", f"the image does not swap parts ({', '.join(offered)} can be requested with a sensor edit); kept {part}"
    listing = ", ".join(f"{cid} ({_KIND_LABEL[ctx.kind_of(cid)]})" for cid in sensors) or "none"
    return "ignored", f"the catalog ({ctx.catalog.version}) has no {_KIND_LABEL[value]} range sensor (its range sensors: {listing}); kept {part}"


def _wheel_count(value: int, ctx: _Context) -> tuple[Outcome, str]:
    count = len(ctx.slots("wheel"))
    if value == count:
        return "matched", f"template {ctx.template_id} has {count} drive wheels ({ctx.selection.wheel} on {ctx.selection.motor})"
    caster = " plus a caster" if ctx.slots("caster") else ""
    return "ignored", f"the only supported template, {ctx.template_id}, has {count} drive wheels{caster}; kept {count} drive wheels"


def _caster(value: bool, ctx: _Context) -> tuple[Outcome, str]:
    has = bool(ctx.slots("caster"))
    if value and has:
        return "matched", f"template {ctx.template_id} has a caster ({ctx.selection.caster})"
    if has:
        return "ignored", (
            f"template {ctx.template_id} needs its caster ({ctx.selection.caster}) to stand on "
            f"{len(ctx.slots('wheel'))} drive wheels; kept it"
        )
    return "ignored", f"template {ctx.template_id} has no caster mount"


def _one_part(category: str, kept: str, label: str, ctx: _Context) -> tuple[Outcome, str]:
    options = sorted(c.catalog_id for c in ctx.catalog.by_category(category))
    if options == [kept]:
        return "ignored", f"the catalog ({ctx.catalog.version}) has one {label} ({kept}); kept it"
    return "ignored", f"{label} size is not used to choose parts (catalog options: {', '.join(options)}); kept {kept}"


def _wheel_size(value: str, ctx: _Context) -> tuple[Outcome, str]:
    return _one_part("wheel", ctx.selection.wheel, "wheel model", ctx)


def _chassis_size(value: str, ctx: _Context) -> tuple[Outcome, str]:
    return _one_part("chassis", ctx.selection.chassis, "chassis", ctx)


def _body_color(value: str, ctx: _Context) -> tuple[Outcome, str]:
    return "ignored", f"catalog parts come in fixed colors ({ctx.catalog.version} lists no color variants); the image does not recolor them"


def _controller(value: str, ctx: _Context) -> tuple[Outcome, str]:
    controller, driver = ctx.selection.controller, ctx.selection.motor_driver
    profile = wiring.find_profile(controller, driver, ctx.profiles if ctx.profiles is not None else wiring.load_profiles())
    source = f"wiring profile {profile['profile_id']} ({controller} with {driver})" if profile else f"the default stack ({controller})"
    return "ignored", f"the controller is fixed by {source}; a board seen in an image is never matched to a catalog SKU"


_MAPPERS: dict[str, Callable[[Any, _Context], tuple[Outcome, str]]] = {
    "range_sensor_position": _sensor_position,
    "range_sensor_kind": _sensor_kind,
    "drive_wheel_count": _wheel_count,
    "has_caster": _caster,
    "wheel_size": _wheel_size,
    "chassis_size": _chassis_size,
    "body_color": _body_color,
    "visible_controller": _controller,
}


def describe(
    features: ImageFeatures | None,
    *,
    input_kind: str,
    selection: RoverSelection,
    mount_offsets: Mapping[str, Vec3],
    catalog: Catalog,
    profiles: Sequence[dict[str, Any]] | None = None,
) -> list[str]:
    """Provenance notes for every extracted trait against the current build (none without features)."""
    if features is None:
        return []
    traits = {t: getattr(features, t) for t in TRAITS if getattr(features, t) is not None}
    if input_kind == "text":
        unused = f"; traits not used: {', '.join(traits)}" if traits else ""
        return [f"{UNCHANGED}the input has no image{unused}"]
    if not traits:
        return [f"{UNCHANGED}no visible trait was extracted from the image with confidence"]
    ctx = _Context(selection, mount_offsets, catalog, profiles, mounts.load_template())
    applied: list[str] = []
    ignored: list[str] = []
    changed = False
    for trait, value in traits.items():
        outcome, reason = _MAPPERS[trait](value, ctx)
        label = f"{trait}={_shown(trait, value)}"
        if outcome == "changed":
            changed = True
            applied.append(f"{APPLIED}{label}: {reason}")
        elif outcome == "matched":
            applied.append(f"{APPLIED}{label} (no change needed): {reason}")
        else:
            ignored.append(f"{IGNORED}{label}: {reason}")
    notes = applied + ignored
    if not changed:
        notes.append(f"{UNCHANGED}every extracted trait already matches the build or was ignored")
    return notes
