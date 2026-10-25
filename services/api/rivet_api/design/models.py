"""Typed v2 design domain: requests, distilled intent, reviews, events and DesignBundle.

Separately versioned from the frozen v1 BuildPlan; an engineered DesignBundle links to the
v1 plan the engine produced for its electronics instead of extending that schema.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

EVENT_STAGES = (
    "intake", "distilled", "concept_ready", "view_ready", "candidate_started", "body_ready", "geometry_preview",
    "mechanical_report", "engineering_report", "repair", "render_ready", "visual_review", "candidate_complete",
    "choice_requested", "revision_ready", "export_ready", "complete", "failed", "cancelled", "budget_exhausted",
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DesignInput(StrictModel):
    user_text: str = Field(default="", max_length=12000)
    image_asset_id: str | None = Field(default=None, pattern=r"^asset-[0-9a-f]{64}$")

    @model_validator(mode="after")
    def nonempty(self):
        if not self.user_text.strip() and not self.image_asset_id:
            raise ValueError("Supply a description or a reference image")
        return self


class GenerationRequest(StrictModel):
    input: DesignInput
    mode: Literal["concept_only", "engineered"] = "concept_only"
    quality: Literal["full", "draft"] = "full"
    candidate_count: int = Field(default=3, ge=1, le=3)
    review_rounds: int = Field(default=2, ge=0, le=4)
    visual_target: float = Field(default=8.0, ge=0, le=10)
    allow_cached: bool = False
    generation_budget_usd: float = Field(default=10, gt=0, le=100)
    constraints: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def full_quality(self):
        if self.quality == "full" and (self.candidate_count != 3 or self.review_rounds < 1):
            raise ValueError("full quality generates 3 candidates with at least one review round")
        return self


class PaletteColor(StrictModel):
    name: str
    hex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class DistilledIntent(StrictModel):
    subject: str = Field(min_length=1, max_length=240)
    summary: str = Field(max_length=2000)
    archetype: str = Field(default="object", max_length=40)
    goals: list[str] = Field(default_factory=list, max_length=12)
    signature_features: list[str] = Field(min_length=3, max_length=6)
    proportions: dict[str, float] = Field(default_factory=dict)
    target_size_mm: list[float] | None = Field(default=None, min_length=3, max_length=3)
    palette: list[PaletteColor] = Field(default_factory=list, max_length=8)
    materials: list[str] = Field(default_factory=list, max_length=8)
    functional_behavior: str = Field(default="", max_length=400)
    mechanical_constraints: list[str] = Field(default_factory=list, max_length=12)
    supported: list[str] = Field(default_factory=list, max_length=12)
    unsupported: list[str] = Field(default_factory=list, max_length=12)
    simplifications: list[str] = Field(default_factory=list, max_length=12)
    uncertainties: list[str] = Field(default_factory=list, max_length=12)
    wheel_count: int | None = Field(default=None, ge=0, le=12)
    sensor_height: Literal["low", "mid", "high"] | None = None
    image_observations: list[str] = Field(default_factory=list, max_length=16)
    source: Literal["model", "rules"] = "rules"


class VisualIssue(StrictModel):
    body_id: str | None
    view: str
    severity: Literal["minor", "major", "critical"]
    observed: str
    target: str
    proposed_change: str
    patch: dict[str, Any] | None = None  # machine-readable hint, e.g. {"scale_axis": 2, "factor": 1.1}


class VisualScores(StrictModel):
    silhouette: float = Field(ge=0, le=10)
    proportions: float = Field(ge=0, le=10)
    signature_features: float = Field(ge=0, le=10)
    pose_and_orientation: float = Field(ge=0, le=10)
    colour_and_surface: float = Field(ge=0, le=10)
    reference_consistency: float = Field(ge=0, le=10)


class VisualReview(StrictModel):
    scores: VisualScores
    overall: float = Field(ge=0, le=10)
    issues: list[VisualIssue]
    summary: str
    subjective: Literal[True] = True
    judge_model: str
    render_digest: str
    metrics: dict[str, Any] = Field(default_factory=dict)


class AssetReference(StrictModel):
    type: str
    id: str
    url: str


class GeometrySnapshot(StrictModel):
    scene_asset_url: str
    part_manifest: list[dict[str, Any]]
    geometry_digest: str
    preview_revision: int
    is_partial: bool


class DesignEvent(StrictModel):
    schema_version: Literal["2.0"] = "2.0"
    event_id: int
    job_id: str
    timestamp: str
    stage: str
    actor: str
    status: Literal["running", "ok", "warning", "failed", "cancelled"]
    message: str
    candidate_id: str | None = None
    build_id: str | None = None
    revision: int | None = None
    references: list[AssetReference] = Field(default_factory=list)
    preview_revision: int | None = None
    is_partial: bool = False
    snapshot: GeometrySnapshot | None = None
    provenance: dict[str, Any] | None = None

    @model_validator(mode="after")
    def known_stage(self):
        if self.stage not in EVENT_STAGES:
            raise ValueError(f"unknown event stage {self.stage!r}")
        return self


class ReferenceView(StrictModel):
    id: str
    view: str
    image_url: str
    source: Literal["upload", "generated", "render"]
    camera: dict[str, Any] | None = None
    provenance: dict[str, Any] = Field(default_factory=dict)


class ModelShot(StrictModel):
    view: str
    image_url: str
    camera: dict[str, Any]


class Candidate(StrictModel):
    id: str
    strategy: str
    seed: int = 0
    status: Literal["complete", "failed"]
    spec: dict[str, Any] | None = None
    spec_digest: str | None = None
    scene_asset_url: str | None = None
    part_manifest: list[dict[str, Any]] = Field(default_factory=list)
    joints: list[dict[str, Any]] = Field(default_factory=list)
    geometry_digest: str | None = None
    shots: list[ModelShot] = Field(default_factory=list)
    previews: list[dict[str, Any]] = Field(default_factory=list)
    mechanical: dict[str, Any] = Field(default_factory=dict)
    functional: dict[str, Any] = Field(default_factory=dict)
    claims: dict[str, Any] = Field(default_factory=dict)
    visual: VisualReview | None = None
    feasible: bool = False
    error: dict[str, Any] | None = None
    manufacturing_assets: list[dict[str, Any]] = Field(default_factory=list)
    bom: dict[str, Any] = Field(default_factory=dict)
    assembly_steps: list[dict[str, Any]] = Field(default_factory=list)
    iterations: list[dict[str, Any]] = Field(default_factory=list)


class BudgetSnapshot(StrictModel):
    limit_usd: float
    spent_usd: float
    reserved_usd: float


class DesignProvenance(StrictModel):
    generation_mode: Literal["live", "fixture"]
    cached: bool
    replay_of: str | None
    input_digest: str
    catalog_digest: str
    view_consistency: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
    providers: dict[str, str] = Field(default_factory=dict)
    stages: list[dict[str, Any]] = Field(default_factory=list)


class DesignBundle(StrictModel):
    schema_version: Literal["2.0"] = "2.0"
    build_id: str
    revision: int
    job_id: str
    mode: Literal["concept_only", "engineered"]
    status: Literal["complete", "needs_review", "unbuildable"]
    title: str
    original_request: dict[str, Any]
    distilled: DistilledIntent
    references: list[ReferenceView]
    candidates: list[Candidate]
    selected_candidate_id: str | None
    recommendation: dict[str, Any] = Field(default_factory=dict)
    scene_asset_url: str | None
    assembly: list[dict[str, Any]]
    exports: dict[str, Any] = Field(default_factory=dict)
    linked_plan_url: str | None = None
    generation_trace_url: str | None = None
    model_versions: dict[str, str]
    visual_quality: dict[str, Any] = Field(default_factory=dict)
    provenance: DesignProvenance
    budget: BudgetSnapshot
    parent_revision: int | None
    change: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class SelectionRequest(StrictModel):
    job_id: str
    base_revision: int = Field(ge=1)
    candidate_id: str


class RevisionRequest(StrictModel):
    base_revision: int = Field(ge=1)
    instruction: str = Field(min_length=1, max_length=4000)
    selected_body_ids: list[str] = Field(default_factory=list, max_length=128)


class RestoreRequest(StrictModel):
    base_revision: int = Field(ge=1)
    target_revision: int = Field(ge=1)


class FabricatedPart(StrictModel):
    """One fabricated (custom) part line: dimensioned by Rivet, never a distributor product."""

    body_id: str
    name: str
    route: Literal["3d_print", "cnc", "sheet_cut", "laser_cut", "molded"]
    material: str
    bbox_mm: list[float]
    volume_cm3: float
    mass_g: float | None
    min_wall_mm: float | None
    watertight: bool
    representation: Literal["brep", "mesh"]
    exports: list[Literal["step", "stl"]]
    checks: list[dict[str, Any]]
    estimate_usd: float | None
    estimate_basis: str | None


def contract_schemas() -> dict[str, dict]:
    def schema(model, name: str, title: str) -> dict:
        s = model.model_json_schema()
        s.update({"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": f"https://rivet.dev/contracts/{name}", "title": title})
        return s

    return {
        "design-bundle.v2.schema.json": schema(DesignBundle, "design-bundle.v2.schema.json", "Rivet DesignBundle v2"),
        "geometry-preview-event.v2.schema.json": schema(DesignEvent, "geometry-preview-event.v2.schema.json", "Rivet design job event v2"),
        "visual-review.v2.schema.json": schema(VisualReview, "visual-review.v2.schema.json", "Rivet VisualReview v2 (subjective)"),
        "fabricated-part.v2.schema.json": schema(FabricatedPart, "fabricated-part.v2.schema.json", "Rivet fabricated part v2"),
    }
