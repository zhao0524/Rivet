"""Bounded semantic design descriptions; never executable modeling programs.

All lengths are millimetres and all angles degrees in right-handed Y-up space
(x = right, y = up, z = toward the object's front). A model proposes *what* to build:
bodies, local shapes, features, anchors and attachments. Deterministic code
(`rivet_engine.design_compiler`) decides *where* every body goes and whether the result
satisfies its constraints. Product identity is checked against the caller's catalog by
the compiler, never trusted because it appears in a proposal.
"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = "2.0"
Id = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_.-]{0,79}$")]
Vec3 = tuple[float, float, float]
Point2 = tuple[float, float]
Positive = Annotated[float, Field(gt=0, le=100000)]
NonNegative = Annotated[float, Field(ge=0, le=100000)]
Axis = Literal["X", "Y", "Z"]
JointKind = Literal["rigid", "hinge", "shaft", "slide", "bolt", "face", "slot", "side"]
ShapeType = Literal[
    "box", "rounded_box", "plate", "cylinder", "tube", "sphere", "ellipsoid", "cone", "capsule", "torus", "wheel",
    "extrude_profile", "revolve_profile", "loft", "sweep", "shell", "boolean", "occupancy", "mesh_reference",
]
# Shapes the occupancy (implicit-surface) route can blend; everything else is B-rep only.
OCCUPANCY_PRIMITIVES = {"box", "rounded_box", "plate", "sphere", "ellipsoid", "cylinder", "cone", "capsule", "torus"}
FREEFORM_TYPES = {"occupancy", "mesh_reference"}
FEATURE_TYPES = ("hole", "counterbore", "boss", "fillet", "chamfer", "shell", "slot", "grill", "pocket", "window", "rib")
MANUFACTURING = Literal["none", "3d_print", "cnc", "sheet_cut", "laser_cut", "molded"]

# Implicit anchors: any face, edge or corner of a body's local bounding box, named by
# up to one word per axis, e.g. "top", "front_top", "left_bottom_back"; plus "center".
_AXIS_WORDS = {"left": (0, -1), "right": (0, 1), "bottom": (1, -1), "top": (1, 1), "back": (2, -1), "front": (2, 1)}
# Redundant words models write to mean "middle of that face": "bottom_center" == "bottom".
_NEUTRAL_WORDS = {"center", "centre", "middle", "mid"}
_CANONICAL_ORDER = ("left", "right", "bottom", "top", "back", "front")


def implicit_anchor_axes(name: str) -> tuple[int, int, int] | None:
    """Signs (-1/0/1 per axis) of an implicit bounding-box anchor, or None if not implicit."""
    if name == "center":
        return (0, 0, 0)
    words = name.lower().replace("-", "_").split("_")
    signs = [0, 0, 0]
    for word in words:
        if word in _NEUTRAL_WORDS:
            continue
        if word not in _AXIS_WORDS:
            return None
        axis, sign = _AXIS_WORDS[word]
        if signs[axis] != 0:
            return None
        signs[axis] = sign
    return (signs[0], signs[1], signs[2]) if any(signs) else None


def canonical_anchor_name(name: str) -> str:
    """'top_front' and 'front_top' are the same implicit anchor."""
    signs = implicit_anchor_axes(name)
    if signs is None or signs == (0, 0, 0):
        return name
    words = [w for w in _CANONICAL_ORDER if _AXIS_WORDS[w][1] == signs[_AXIS_WORDS[w][0]] and signs[_AXIS_WORDS[w][0]] != 0]
    return "_".join(words)


def _clamp_shape_dict(shape: dict) -> dict:
    """Pull shape parameters just inside their legal range; never invent geometry."""
    if not isinstance(shape, dict):
        return shape
    out = dict(shape)
    t = out.get("type")
    dims = out.get("dimensions_mm")
    if isinstance(dims, (list, tuple)) and len(dims) == 3 and all(isinstance(v, (int, float)) for v in dims):
        out["dimensions_mm"] = [float(v) if v > 0.5 else 0.5 for v in dims]
        dims = out["dimensions_mm"]
    for key in ("radius_mm", "minor_radius_mm", "height_mm", "wall_mm"):
        value = out.get(key)
        if isinstance(value, (int, float)) and value <= 0:
            out[key] = 0.5
    r = out.get("radius_mm")
    if t == "rounded_box" and isinstance(dims, (list, tuple)) and len(dims) == 3 and isinstance(r, (int, float)):
        if r * 2 >= min(dims):
            out["radius_mm"] = round(max(0.1, 0.45 * min(dims)), 4)
    if t in ("tube", "wheel") and isinstance(r, (int, float)) and isinstance(out.get("wall_mm"), (int, float)):
        if out["wall_mm"] >= r:
            out["wall_mm"] = round(max(0.1, r * 0.9), 4)
    if t == "torus" and isinstance(r, (int, float)) and isinstance(out.get("minor_radius_mm"), (int, float)):
        if out["minor_radius_mm"] >= r:
            out["minor_radius_mm"] = round(max(0.1, r * 0.9), 4)
    if t == "occupancy" and out.get("hollow"):
        pitch, wall = out.get("pitch_mm"), out.get("wall_mm")
        if isinstance(pitch, (int, float)) and isinstance(wall, (int, float)) and wall < pitch:
            out["wall_mm"] = pitch
    if isinstance(out.get("children"), list):
        out["children"] = [_clamp_shape_dict(c) for c in out["children"]]
    return out


def normalize_spec_shapes(spec: dict) -> dict:
    """Clamp shape parameters a model wrote trivially out of range, on a raw spec dict.

    A rounded_box radius at exactly half its smallest side, a wheel wall as thick as its radius,
    a hollow shell thinner than one voxel: each is a near-miss that fails strict validation and
    would otherwise discard the whole candidate. The legal side is always the smaller value, so
    clamping never invents geometry; it keeps the shape the model described.
    """
    if not isinstance(spec, dict):
        return spec
    out = dict(spec)
    bodies = out.get("bodies")
    if isinstance(bodies, list):
        out["bodies"] = [
            {**b, "shape": _clamp_shape_dict(b["shape"])} if isinstance(b, dict) and isinstance(b.get("shape"), dict) else b
            for b in bodies
        ]
    return out


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, validate_default=True)


def _bounded(values, limit: float = 100000.0) -> bool:
    return all(abs(v) <= limit for v in values)


class Frame(StrictModel):
    position_mm: Vec3 = (0, 0, 0)
    rotation_deg: Vec3 = (0, 0, 0)

    @model_validator(mode="after")
    def bounded(self):
        if not _bounded(self.position_mm):
            raise ValueError("frame exceeds the 100000 mm workspace")
        return self


class Shape(StrictModel):
    """One semantic solid. Fields that a type does not use are ignored by the compiler.

    box/rounded_box/plate: dimensions_mm [x, y, z]; rounded_box corner radius radius_mm.
    cylinder/tube/cone/capsule: radius_mm, height_mm along `axis`; cone top radius
      radius_top_mm (0 = apex); tube wall wall_mm.
    sphere: radius_mm. ellipsoid: dimensions_mm are the three diameters.
    torus: ring in the plane normal to `axis`; radius_mm (centre of tube), minor_radius_mm.
    wheel: axle along `axis` (default X); radius_mm outer radius, height_mm width,
      wall_mm tyre thickness, spokes (0 = solid disc hub).
    extrude_profile: profile_mm points in the plane normal to `axis`, extruded height_mm,
      centred on the origin.
    revolve_profile: profile_mm points (radius, height) revolved about `axis` by angle_deg.
    loft: sections (polygons in the plane normal to `axis`) at section_heights_mm.
    sweep: circular profile radius_mm (or polygon profile_mm) along path_mm.
    shell: hollows its single child with wall_mm, optionally open on one face.
    boolean: children combined by `operation` (first child minus the rest for difference).
    occupancy: implicit-surface blend of primitive children with smoothing_mm, meshed at
      pitch_mm; optional hollow shell of wall_mm. Visual or printable mesh, never STEP.
    mesh_reference: an imported mesh asset scaled to fit dimensions_mm.
    """

    type: ShapeType
    dimensions_mm: tuple[Positive, Positive, Positive] = (20, 20, 20)
    radius_mm: Positive = 5
    radius_top_mm: NonNegative = 0
    minor_radius_mm: Positive = 2
    height_mm: Positive = 20
    wall_mm: Positive = 2
    axis: Axis | None = None
    profile_mm: list[Point2] = Field(default_factory=list, max_length=256)
    angle_deg: Annotated[float, Field(gt=0, le=360)] = 360
    sections: list[list[Point2]] = Field(default_factory=list, max_length=32)
    section_heights_mm: list[float] = Field(default_factory=list, max_length=32)
    ruled: bool = False
    path_mm: list[Vec3] = Field(default_factory=list, max_length=128)
    operation: Literal["union", "difference", "intersection", "smooth_union"] = "union"
    children: list[Shape] = Field(default_factory=list, max_length=64)
    frame: Frame = Field(default_factory=Frame)
    pitch_mm: Annotated[float, Field(ge=0.2, le=100)] = 2
    smoothing_mm: Annotated[float, Field(ge=0, le=100)] = 2
    hollow: bool = False
    open_face: Literal["none", "top", "bottom", "left", "right", "front", "back"] = "none"
    spokes: Annotated[int, Field(ge=0, le=24)] = 0
    asset_id: Id | None = None

    @property
    def resolved_axis(self) -> str:
        return self.axis or ("X" if self.type == "wheel" else "Y")

    @model_validator(mode="after")
    def valid_operation(self):
        t = self.type
        if t in ("extrude_profile", "revolve_profile") and len(self.profile_mm) < 3:
            raise ValueError(f"{t} requires at least three profile points")
        if t == "revolve_profile" and any(p[0] < 0 for p in self.profile_mm):
            raise ValueError("revolve_profile radii (first coordinate) must be >= 0")
        if t == "loft" and (
            len(self.sections) < 2 or len(self.sections) != len(self.section_heights_mm) or any(len(s) < 3 for s in self.sections)
        ):
            raise ValueError("loft requires matching heights and at least two polygon sections of three or more points")
        if t == "loft" and any(b <= a for a, b in zip(self.section_heights_mm, self.section_heights_mm[1:])):
            raise ValueError("loft section heights must increase")
        if t == "sweep" and len(self.path_mm) < 2:
            raise ValueError("sweep requires at least two path points")
        if t in ("boolean", "occupancy") and not self.children:
            raise ValueError(f"{t} requires child shapes")
        if t == "boolean" and self.operation == "smooth_union":
            raise ValueError("smooth_union belongs to occupancy shapes; boolean supports union, difference, intersection")
        if t == "occupancy" and any(c.type not in OCCUPANCY_PRIMITIVES for c in self.children):
            raise ValueError(f"occupancy children must be primitives: {sorted(OCCUPANCY_PRIMITIVES)}")
        if t == "shell" and len(self.children) != 1:
            raise ValueError("shell requires exactly one child solid")
        if t == "shell" and self.children and self.children[0].type in FREEFORM_TYPES:
            raise ValueError("shell hollows a parametric child; use occupancy.hollow for freeform bodies")
        if t == "tube" and self.wall_mm >= self.radius_mm:
            raise ValueError("tube wall must be smaller than radius")
        if t == "wheel" and self.wall_mm >= self.radius_mm:
            raise ValueError("wheel tyre thickness must be smaller than radius")
        if t == "torus" and self.minor_radius_mm >= self.radius_mm:
            raise ValueError("torus minor radius must be smaller than its major radius")
        if t == "rounded_box" and self.radius_mm * 2 >= min(self.dimensions_mm):
            raise ValueError("rounded_box radius must be less than half its smallest dimension")
        if t == "mesh_reference" and not self.asset_id:
            raise ValueError("mesh_reference requires an imported asset_id")
        if t == "occupancy" and self.hollow and self.wall_mm < self.pitch_mm:
            raise ValueError("occupancy hollow wall must be at least one voxel pitch")
        points = list(self.profile_mm) + [p for s in self.sections for p in s]
        if not all(_bounded(p) for p in points) or not all(_bounded(p) for p in self.path_mm):
            raise ValueError("profile or path exceeds workspace bounds")
        return self


class Feature(StrictModel):
    """A bounded feature applied to the body's solid, in the body's local frame.

    hole/counterbore: radius_mm, depth_mm along `axis` from position_mm (count/spacing_mm
      repeat along pattern_axis). boss/rib: additive cylinder / plate. fillet/chamfer:
      radius_mm on edge set `edges`. shell: hollow with wall_mm, open on `open_face`.
    slot/window/pocket: width_mm x length_mm cut, depth_mm deep (window cuts through).
    grill: `count` slots of width_mm x length_mm, spacing_mm apart.
    """

    id: Id
    type: Literal["hole", "counterbore", "boss", "fillet", "chamfer", "shell", "slot", "grill", "pocket", "window", "rib"]
    radius_mm: Positive = 2
    depth_mm: Positive = 10
    wall_mm: Positive = 2
    counterbore_radius_mm: Positive = 4
    counterbore_depth_mm: Positive = 2
    position_mm: Vec3 = (0, 0, 0)
    axis: Axis = "Y"
    edges: Literal["all", "vertical", "horizontal", "top", "bottom"] = "all"
    count: Annotated[int, Field(ge=1, le=64)] = 1
    spacing_mm: Positive = 5
    pattern_axis: Axis = "X"
    width_mm: Positive = 2
    length_mm: Positive = 10
    open_face: Literal["none", "top", "bottom", "left", "right", "front", "back"] = "top"
    required: bool = False

    @model_validator(mode="after")
    def bounded(self):
        if not _bounded(self.position_mm):
            raise ValueError("feature position exceeds workspace")
        if self.type == "counterbore" and self.counterbore_radius_mm <= self.radius_mm:
            raise ValueError("counterbore radius must exceed the hole radius")
        return self


class Anchor(StrictModel):
    """An explicit named frame in body-local coordinates. Its +Y axis is the outward normal
    of the mating face; attached bodies meet it with their own anchor normal opposed."""

    id: Id
    frame: Frame = Field(default_factory=Frame)
    kind: JointKind = "rigid"
    diameter_mm: Positive | None = None
    bolt_pattern_mm: list[Point2] = Field(default_factory=list, max_length=64)
    accepts: list[str] = Field(default_factory=list, max_length=16)
    verified: Literal[False] = False

    @model_validator(mode="after")
    def not_implicit(self):
        if implicit_anchor_axes(self.id) is not None:
            raise ValueError(f"anchor id {self.id!r} collides with an implicit bounding-box anchor name")
        return self


class Fastener(StrictModel):
    spec: str = Field(default="M3", pattern=r"^(M[1-9](\.[0-9])?|#[0-9]{1,2}|adhesive|press_fit|snap_fit|zip_tie)$")
    count: Annotated[int, Field(ge=1, le=64)] = 2
    length_mm: Positive | None = None


class Attachment(StrictModel):
    """How a child meets its parent: the child's `child_anchor` face is placed against the
    parent's `parent_anchor` face (normals opposed, upright when possible). offset_mm then
    moves the child along the PARENT body's axes (x right, y up, z front); rotation_deg
    (XYZ Euler) and the joint `axis` turn it about the parent anchor point, in the parent's
    axes. Hinge `value`/`limits` are degrees, slide ones millimetres."""

    parent_anchor: Id = "top"
    child_anchor: Id = "bottom"
    joint: JointKind = "rigid"
    offset_mm: Vec3 = (0, 0, 0)
    rotation_deg: Vec3 = (0, 0, 0)
    axis: Axis = "Y"
    value: float = 0
    limits: tuple[float, float] = (0, 0)
    clearance_mm: Annotated[float, Field(ge=0, le=1000)] = 0
    contact: Literal["touch", "fastened", "clearance", "embedded"] = "touch"
    fasteners: Fastener | None = None
    # Bounded range the deterministic repair may slide the child within (mm, per axis).
    adjust_mm: Annotated[float, Field(ge=0, le=500)] = 0

    @model_validator(mode="after")
    def limits_valid(self):
        if self.limits[0] > self.limits[1] or not self.limits[0] <= self.value <= self.limits[1]:
            raise ValueError("joint value must be inside ordered limits")
        if not _bounded(self.offset_mm):
            raise ValueError("attachment offset exceeds workspace")
        if self.joint == "hinge" and abs(self.limits[1] - self.limits[0]) > 360:
            raise ValueError("hinge limits exceed one turn; use a shaft joint for continuous rotation")
        return self


class Material(StrictModel):
    name: str = Field(default="plastic", max_length=80)
    color: str = Field(default="#a8b4c0", pattern=r"^#[0-9a-fA-F]{6}$")
    metallic: Annotated[float, Field(ge=0, le=1)] = 0
    roughness: Annotated[float, Field(ge=0, le=1)] = 0.5
    opacity: Annotated[float, Field(gt=0, le=1)] = 1
    density_g_cm3: Annotated[float, Field(gt=0, le=30)] | None = None
    density_source: str | None = Field(default=None, max_length=1024)


class Provenance(StrictModel):
    origin: Literal["prompted", "calculated", "imported", "measured", "inferred"] = "prompted"
    source_url: str | None = Field(default=None, max_length=2048)
    license: str | None = Field(default=None, max_length=160)
    notes: list[str] = Field(default_factory=list, max_length=32)


class DesignBody(StrictModel):
    id: Id
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="body", max_length=60, pattern=r"^[a-z][a-z0-9_]*$")
    tags: list[str] = Field(default_factory=list, max_length=16)
    kind: Literal["purchased", "fabricated", "concept_visual"] = "concept_visual"
    parent_id: Id | None = None
    shape: Shape | None = None
    frame: Frame = Field(default_factory=Frame)
    anchors: list[Anchor] = Field(default_factory=list, max_length=64)
    attachment: Attachment | None = None
    features: list[Feature] = Field(default_factory=list, max_length=128)
    material: Material = Field(default_factory=Material)
    manufacturing: MANUFACTURING = "none"
    catalog_id: str | None = Field(default=None, max_length=160)
    provenance: Provenance = Field(default_factory=Provenance)
    required: bool = True
    standalone: bool = False
    internal: bool = False

    @model_validator(mode="after")
    def consistent(self):
        if self.kind == "purchased" and not self.catalog_id:
            raise ValueError("purchased bodies require an exact catalog_id")
        if self.kind != "purchased" and self.catalog_id is not None:
            raise ValueError("only purchased bodies may claim a catalog_id")
        if self.kind != "purchased" and self.shape is None:
            raise ValueError("fabricated and concept_visual bodies require a shape")
        if self.kind == "purchased" and self.features:
            raise ValueError("purchased parts cannot be modified with features; add a fabricated body instead")
        if self.kind == "purchased" and self.manufacturing != "none":
            raise ValueError("purchased parts are not manufactured by the user")
        if self.kind == "fabricated" and self.manufacturing == "none":
            raise ValueError("fabricated bodies need a manufacturing route")
        if self.kind == "fabricated" and self.shape is not None and self.shape.type == "mesh_reference":
            raise ValueError("an imported mesh cannot be a dimensioned fabricated part; use concept_visual")
        if (self.parent_id is None) != (self.attachment is None):
            raise ValueError("every child requires an attachment; roots cannot have one")
        if self.parent_id and self.frame != Frame():
            raise ValueError("child placement must use named attachment frames, not world positions")
        if len({a.id for a in self.anchors}) != len(self.anchors):
            raise ValueError("duplicate anchor id")
        if len({f.id for f in self.features}) != len(self.features):
            raise ValueError("duplicate feature id")
        return self

    def anchor_ids(self) -> set[str]:
        return {a.id for a in self.anchors}


class PaletteEntry(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    hex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class VisualGoal(StrictModel):
    signature_features: list[str] = Field(default_factory=list, max_length=12)
    reference_image_ids: list[str] = Field(default_factory=list, max_length=24)
    description: str = Field(default="", max_length=8000)
    uncertainties: list[str] = Field(default_factory=list, max_length=32)
    proportion_targets: dict[str, Annotated[float, Field(gt=0, le=100)]] = Field(default_factory=dict, max_length=12)
    palette: list[PaletteEntry] = Field(default_factory=list, max_length=16)
    target_size_mm: tuple[Positive, Positive, Positive] | None = None


class Constraints(StrictModel):
    units: Literal["mm"] = "mm"
    up_axis: Literal["Y"] = "Y"
    handedness: Literal["right"] = "right"
    max_bounds_mm: tuple[Positive, Positive, Positive] = (20000, 20000, 20000)
    min_wall_mm: Positive = 1
    min_general_clearance_mm: Annotated[float, Field(ge=0, le=1000)] = 0.5
    must_be_stable: bool = True
    mesh_tolerance_mm: Annotated[float, Field(ge=0.01, le=2)] = 0.15
    printer_volume_mm: tuple[Positive, Positive, Positive] = (256, 256, 256)


class DesignSpec(StrictModel):
    schema_version: Literal["2.0"] = "2.0"
    mode: Literal["engineered", "concept_only"] = "concept_only"
    subject: str = Field(min_length=1, max_length=240)
    seed: Annotated[int, Field(ge=0, le=2**31 - 1)] = 0
    strategy: Literal["closest_to_reference", "simpler_manufacture", "signature_geometry", "revision", "user"] = "closest_to_reference"
    visual_goal: VisualGoal = Field(default_factory=VisualGoal)
    constraints: Constraints = Field(default_factory=Constraints)
    bodies: list[DesignBody] = Field(min_length=1, max_length=128)
    notes: list[str] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def topology(self):
        by_id = {b.id: b for b in self.bodies}
        if len(by_id) != len(self.bodies):
            raise ValueError("duplicate body id")
        for b in self.bodies:
            visited = {b.id}
            parent = b.parent_id
            while parent is not None:
                if parent not in by_id:
                    raise ValueError(f"body {b.id!r} has unknown parent {parent!r}")
                if parent in visited:
                    raise ValueError("attachment hierarchy contains a cycle")
                visited.add(parent)
                parent = by_id[parent].parent_id
            if b.attachment is not None and b.parent_id is not None:
                parent_body = by_id[b.parent_id]
                for label, name, owner in (("parent_anchor", b.attachment.parent_anchor, parent_body), ("child_anchor", b.attachment.child_anchor, b)):
                    if implicit_anchor_axes(name) is None and name not in owner.anchor_ids():
                        raise ValueError(
                            f"body {b.id!r} {label} {name!r} is neither an implicit face/edge/corner name "
                            f"(top, bottom, left, right, front, back, combinations, center) nor an anchor of {owner.id!r}"
                        )
        roots = [b for b in self.bodies if b.parent_id is None]
        loose = [b.id for b in roots[1:] if not b.standalone]
        if loose:
            raise ValueError(f"only one root body may be unattached unless marked standalone; attach or mark: {loose}")
        count = 0

        def visit(shape: Shape, depth: int):
            nonlocal count
            count += 1
            if depth > 12 or count > 2048:
                raise ValueError("shape operation complexity limit exceeded")
            for child in shape.children:
                visit(child, depth + 1)

        for b in self.bodies:
            if b.shape is not None:
                visit(b.shape, 0)
        return self


class BodyPatch(StrictModel):
    """add/replace carry a whole body; update sets dotted fields of an existing body
    (e.g. {"shape.dimensions_mm": [200, 40, 120], "material.color": "#ff8800"}); remove
    deletes an optional body and nothing else."""

    operation: Literal["add", "replace", "remove", "update"]
    body_id: Id
    body: DesignBody | None = None
    set: dict[str, Any] = Field(default_factory=dict, max_length=32)

    @model_validator(mode="after")
    def identity(self):
        if self.operation in ("add", "replace") and (self.body is None or self.body.id != self.body_id):
            raise ValueError("patch body must preserve the target id")
        if self.operation in ("remove", "update") and self.body is not None:
            raise ValueError(f"{self.operation} cannot include a whole body")
        if self.operation == "update" and not self.set:
            raise ValueError("update needs at least one field in set")
        if self.operation != "update" and self.set:
            raise ValueError("only update patches use set")
        for path in self.set:
            if not path or path.split(".")[0] not in _PATCHABLE_ROOTS:
                raise ValueError(f"field {path!r} cannot be patched")
        return self


_PATCHABLE_ROOTS = {"name", "role", "tags", "shape", "anchors", "attachment", "features", "material", "manufacturing", "internal", "required", "frame", "parent_id"}


class DesignPatch(StrictModel):
    reason: str = Field(min_length=1, max_length=4000)
    operations: list[BodyPatch] = Field(min_length=1, max_length=128)
    visual_goal: VisualGoal | None = None


def _set_path(target: dict, path: str, value: Any) -> None:
    keys = path.split(".")
    node: Any = target
    for key in keys[:-1]:
        if isinstance(node, list):
            node = node[int(key)]
        else:
            if node.get(key) is None:
                node[key] = {}
            node = node[key]
    last = keys[-1]
    if isinstance(node, list):
        node[int(last)] = value
    else:
        node[last] = value


def apply_patch(spec: DesignSpec | dict, patch: DesignPatch | dict) -> DesignSpec:
    """Atomic body patches, validated as a whole; no partial mutations on failure."""
    current = DesignSpec.model_validate(spec)
    edits = DesignPatch.model_validate(patch)
    raw = copy.deepcopy(current.model_dump(mode="json"))
    order = [b["id"] for b in raw["bodies"]]
    bodies = {b["id"]: b for b in raw["bodies"]}
    for op in edits.operations:
        old = bodies.get(op.body_id)
        if op.operation == "add":
            if old is not None:
                raise ValueError(f"add target {op.body_id!r} already exists")
        elif old is None:
            raise ValueError(f"patch target {op.body_id!r} does not exist")
        if op.operation == "remove":
            if old["required"]:
                raise ValueError(f"cannot remove required body {op.body_id!r}")
            if any(b.get("parent_id") == op.body_id for b in bodies.values()):
                raise ValueError(f"cannot remove {op.body_id!r} while other bodies are attached to it")
            del bodies[op.body_id]
            order.remove(op.body_id)
        elif op.operation == "update":
            updated = copy.deepcopy(old)
            for path, value in op.set.items():
                try:
                    _set_path(updated, path, value)
                except (KeyError, IndexError, ValueError, TypeError) as exc:
                    raise ValueError(f"cannot set {path!r} on {op.body_id!r}: {exc}") from None
            if old["kind"] == "purchased" and updated.get("catalog_id") != old["catalog_id"]:
                raise ValueError("purchased part replacement requires an explicit catalog substitution")
            bodies[op.body_id] = DesignBody.model_validate(updated).model_dump(mode="json")
        else:
            assert op.body is not None
            if old and old["kind"] == "purchased" and op.body.catalog_id != old["catalog_id"]:
                raise ValueError("purchased part replacement requires an explicit catalog substitution")
            bodies[op.body_id] = op.body.model_dump(mode="json")
            if op.operation == "add":
                order.append(op.body_id)
    raw["bodies"] = [bodies[i] for i in order]
    if edits.visual_goal is not None:
        raw["visual_goal"] = edits.visual_goal.model_dump(mode="json")
    return DesignSpec.model_validate(raw)


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def spec_digest(spec: DesignSpec | dict) -> str:
    """Content hash of a validated spec (defaults filled in), stable across key order."""
    return hashlib.sha256(canonical_json(DesignSpec.model_validate(spec).model_dump(mode="json"))).hexdigest()


def changed_bodies(before: DesignSpec | dict, after: DesignSpec | dict) -> dict[str, list[str]]:
    """Which body ids were added, removed or changed between two specs."""
    a = {b.id: b.model_dump(mode="json") for b in DesignSpec.model_validate(before).bodies}
    b = {x.id: x.model_dump(mode="json") for x in DesignSpec.model_validate(after).bodies}
    return {
        "added": sorted(set(b) - set(a)),
        "removed": sorted(set(a) - set(b)),
        "changed": sorted(k for k in set(a) & set(b) if a[k] != b[k]),
        "unchanged": sorted(k for k in set(a) & set(b) if a[k] == b[k]),
    }


def topology_signature(spec: DesignSpec | dict) -> str:
    """Shape-and-structure fingerprint used to reject near-duplicate candidates: body count,
    roles, shape types, kinds, hierarchy depth and coarse (10 mm) primary dimensions."""
    model = DesignSpec.model_validate(spec)
    by_id = {b.id: b for b in model.bodies}

    def depth(b: DesignBody) -> int:
        d = 0
        while b.parent_id:
            b = by_id[b.parent_id]
            d += 1
        return d

    rows = []
    for b in model.bodies:
        s = b.shape
        dims = (
            [round(v / 10) for v in s.dimensions_mm] if s and s.type in ("box", "rounded_box", "plate", "ellipsoid")
            else [round(s.radius_mm / 5), round(s.height_mm / 10)] if s else [b.catalog_id]
        )
        rows.append([b.role, b.kind, s.type if s else "catalog", depth(b), dims, len(b.features)])
    rows.sort(key=lambda r: json.dumps(r, sort_keys=True, default=str))
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


def json_schema() -> dict[str, Any]:
    """The JSON Schema served as contracts/design-spec.v2.schema.json (kept in sync by a test)."""
    schema = DesignSpec.model_json_schema()
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = "https://rivet.dev/contracts/design-spec.v2.schema.json"
    schema["title"] = "Rivet DesignSpec v2"
    return schema
