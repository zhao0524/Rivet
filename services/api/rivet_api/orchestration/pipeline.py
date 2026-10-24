"""Generation and edit orchestration.

A never decides hardware validity: it passes the intent to the engineering port,
checks the result is structurally coherent (contract guard), stamps provenance
honestly, and stores whatever the engine said, status and findings untouched.
"""

from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from rivet_api.agents.editor import EditSelector, parse_edit
from rivet_api.agents.intent_sanitizer import sanitize_intent
from rivet_api.agents.vision import VisionPort, ensure_supported
from rivet_api.adapters.engineering import EngineeringPort
from rivet_api.config import Settings
from rivet_api.contract import ContractViolation, assert_build_plan_contract
from rivet_api.errors import ApiError
from rivet_api.models.intent import IntentSpec
from rivet_api.models.plan import BuildPlan
from rivet_api.models.requests import EditRequest, GenerateRequest
from rivet_api.orchestration.jobs import JobManager, JobSnapshot
from rivet_api.orchestration.versions import ProjectStore


@dataclass
class Deps:
    settings: Settings
    vision: VisionPort
    engine: EngineeringPort
    store: ProjectStore
    jobs: JobManager
    assets: Any  # exists(asset_id) -> bool; read_bytes(asset_id) -> (bytes, mime)
    edit_selector: EditSelector | None = None
    grounder: Any = None  # RepoGrounder; optional so tests can omit it


_VALIDATE_STATUS = {
    "verified": "ok",
    "verified_with_warnings": "warning",
    "needs_review": "warning",
    "unbuildable": "failed",
}


def planned_stages(deps: Deps, req: GenerateRequest) -> list[str]:
    stages = ["upload"] if req.input.image_asset_id else []
    stages += ["understand", "catalog_selection"]
    if getattr(deps.engine, "generation_mode", None) is None:
        stages += ["assembly", "validate"]
    return stages + ["complete"]


def check_plan(plan: Any, engine: EngineeringPort) -> BuildPlan:
    """Structural check only; raises ENGINE_CONTRACT_VIOLATION (502)."""
    try:
        model = BuildPlan.model_validate(plan)
    except ValidationError as exc:
        errors = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        raise ApiError(
            "ENGINE_CONTRACT_VIOLATION", "Engine returned a malformed BuildPlan", 502, {"errors": errors}
        ) from exc
    try:
        assert_build_plan_contract(model, engine.get_catalog())
    except ContractViolation as exc:
        raise ApiError(
            "ENGINE_CONTRACT_VIOLATION",
            "Engine returned a BuildPlan with unresolved references",
            502,
            {"errors": exc.errors},
        ) from exc
    return model


def _label_provenance(plan: dict[str, Any], vision_mode: str) -> None:
    prov = plan["provenance"]
    if prov["generation_mode"] == "live" and vision_mode != "live":
        prov["generation_mode"] = "fallback"
        prov["notes"].append(f"Intent came from the {vision_mode} vision provider, not a live model")


def _finding_counts(plan: dict[str, Any]) -> str:
    results = [f["result"] for f in plan["verification"]["findings"]]
    return ", ".join(f"{results.count(r)} {r}" for r in ("PASS", "WARN", "FAIL", "UNKNOWN"))


def generate_project(req: GenerateRequest, deps: Deps, job: JobSnapshot) -> tuple[str, int]:
    jobs, job_id = deps.jobs, job.job_id

    image = None
    if req.input.image_asset_id:
        image = deps.assets.read_bytes(req.input.image_asset_id)
        jobs.emit(job_id, "upload", "system", "ok", f"Image received ({len(image[0])} bytes, {image[1]})")

    jobs.emit(job_id, "understand", "vision", "running", "Reading the request")
    intent: IntentSpec = deps.vision.interpret(req, image)
    catalog_ids = {c["catalog_id"] for c in deps.engine.get_catalog()}
    intent = sanitize_intent(intent, catalog_ids, req)
    ensure_supported(intent)
    jobs.emit(
        job_id,
        "understand",
        "vision",
        "ok",
        f"Interpreted as a {intent.project_family} ({intent.confidence} confidence, {deps.vision.mode} vision)",
    )

    saved_label = getattr(deps.engine, "generation_mode", None)  # set only by fixture adapters
    if saved_label is None:
        jobs.emit(job_id, "catalog_selection", "planner", "running", "Asking the engineering engine for a build")
    else:
        what = "Engineering engine unavailable" if saved_label == "fallback" else "Fixture mode"
        jobs.emit(
            job_id,
            "catalog_selection",
            "system",
            "warning",
            f"{what}: loaded a saved demo build ({saved_label}); no live engineering run",
        )

    plan = deps.engine.solve(intent.model_dump(mode="json"))
    if isinstance(plan, dict) and isinstance(plan.get("provenance"), dict):
        _label_provenance(plan, deps.vision.mode)
    check_plan(plan, deps.engine)

    if saved_label is None:
        jobs.emit(
            job_id,
            "assembly",
            "engineer",
            "ok",
            f"Engine placed {len(plan['components'])} components in {len(plan['assembly_steps'])} assembly steps",
        )
        overall = plan["verification"]["overall"]
        jobs.emit(
            job_id,
            "validate",
            "validator",
            _VALIDATE_STATUS[overall],
            f"Engine reported {overall}: {_finding_counts(plan)}",
        )

    stored = deps.store.create(plan)
    jobs.complete(job_id, stored["build_id"], stored["revision"])
    return stored["build_id"], stored["revision"]


def apply_edit_request(build_id: str, req: EditRequest, deps: Deps) -> dict[str, Any]:
    current = deps.store.get(build_id)
    if req.base_revision != current["revision"]:
        raise ApiError(
            "STALE_REVISION",
            f"base_revision {req.base_revision} is not the latest ({current['revision']})",
            409,
            {"latest_revision": current["revision"]},
        )
    op = parse_edit(req.instruction, req.operation, deps.edit_selector)
    operation = op.model_dump(exclude_none=True)
    entry: dict[str, Any] = {
        "base_revision": req.base_revision,
        "instruction": req.instruction,
        "operation": operation,
    }
    try:
        result = deps.engine.apply_edit(current, operation)
        if not isinstance(result, dict) or not isinstance(result.get("accepted"), bool):
            raise ApiError("ENGINE_CONTRACT_VIOLATION", "Engine returned a malformed edit result", 502)
        if not result["accepted"]:
            finding = result.get("finding") or {"message": "The engine rejected this edit"}
            deps.store.log_edit(build_id, {**entry, "accepted": False, "finding": finding})
            return {"accepted": False, "build_id": build_id, "finding": finding}
        if not isinstance(result.get("plan"), dict):
            raise ApiError("ENGINE_CONTRACT_VIOLATION", "Engine accepted an edit without a plan", 502)
        check_plan(result["plan"], deps.engine)
        revision = deps.store.append_revision(build_id, req.base_revision, result["plan"])
    except ApiError as err:
        deps.store.log_edit(build_id, {**entry, "accepted": False, "error": err.envelope()["error"]})
        raise
    deps.store.log_edit(build_id, {**entry, "accepted": True, "revision": revision})
    return {"accepted": True, "build_id": build_id, "revision": revision}
