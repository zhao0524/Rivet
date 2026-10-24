"""Generation and edit orchestration.

A never decides hardware validity: it passes the intent to the engineering port,
checks the result is structurally coherent (contract guard), stamps provenance
honestly, and stores whatever the engine said, status and findings untouched.
"""

from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from rivet_api.agents.editor import EditSelector, parse_edit
from rivet_api.agents.intent_sanitizer import sanitize_intent
from rivet_api.agents.vision import VisionPort, ensure_supported, support_limitation
from rivet_api.adapters.engineering import EngineeringPort
from rivet_api.config import Settings
from rivet_api.contract import ContractViolation, assert_build_plan_contract
from rivet_api.errors import ApiError
from rivet_api.models.intent import IntentSpec
from rivet_api.models.plan import BuildPlan
from rivet_api.models.requests import EditRequest, GenerateRequest, InterpretRequest
from rivet_api.models.responses import InterpretResponse, Limitation
from rivet_api.orchestration.interpretation import (
    CLOSEST_ROVER_NOTE,
    IntentStore,
    StoredIntent,
    check_same_input,
    closest_supported_rover,
)
from rivet_api.orchestration.jobs import JobManager, JobSnapshot
from rivet_api.orchestration.versions import ProjectStore
from rivet_api.provenance import check_bom_links, is_verified_product, is_synthetic_catalog_id, plan_is_synthetic, plan_synthetic_ids


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
    intents: IntentStore = field(default_factory=IntentStore)

    resolver: Any = None  # ProductResolver (resolution/resolver.py)
    resolutions: Any = None  # ResolutionStore


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
    """Structure and sourcing check; raises ENGINE_CONTRACT_VIOLATION or SYNTHETIC_PARTS_IN_LIVE_PLAN (502)."""
    try:
        model = BuildPlan.model_validate(plan)
    except ValidationError as exc:
        errors = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        raise ApiError(
            "ENGINE_CONTRACT_VIOLATION", "Engine returned a malformed BuildPlan", 502, {"errors": errors}
        ) from exc
    catalog = engine.get_catalog()
    try:
        assert_build_plan_contract(model, catalog)
    except ContractViolation as exc:
        raise ApiError(
            "ENGINE_CONTRACT_VIOLATION",
            "Engine returned a BuildPlan with unresolved references",
            502,
            {"errors": exc.errors},
        ) from exc
    problems = check_bom_links(plan, catalog)
    if problems:
        raise ApiError(
            "ENGINE_CONTRACT_VIOLATION",
            "Engine returned a BuildPlan whose BOM claims sourcing the catalog does not back",
            502,
            {"errors": problems},
        )
    if model.provenance.generation_mode == "live" and plan_is_synthetic(plan, catalog):
        raise ApiError(
            "SYNTHETIC_PARTS_IN_LIVE_PLAN",
            "A live plan contains synthetic demo parts; only real catalog products may be served as live",
            502,
            {"synthetic_catalog_ids": plan_synthetic_ids(plan, catalog)},
        )
    return model


def _label_provenance(plan: dict[str, Any], vision_mode: str) -> None:
    prov = plan["provenance"]
    if prov["generation_mode"] == "live" and vision_mode != "live":
        prov["generation_mode"] = "fallback"
        prov["notes"].append(f"Intent came from the {vision_mode} vision provider, not a live model")


def _finding_counts(plan: dict[str, Any]) -> str:
    results = [f["result"] for f in plan["verification"]["findings"]]
    return ", ".join(f"{results.count(r)} {r}" for r in ("PASS", "WARN", "FAIL", "UNKNOWN"))


def _record_choice(plan: dict[str, Any], note: str) -> None:
    notes = plan["provenance"].get("notes")
    if isinstance(notes, list) and note not in notes:
        notes.append(note)


def _carry_choice_notes(previous: dict[str, Any], plan: dict[str, Any]) -> None:
    """Preserve input provenance and explicit choices when engines rebuild revisions."""
    if not isinstance(plan.get("provenance"), dict):
        return  # check_plan rejects it
    previous_prov = previous.get("provenance", {})
    if plan["provenance"].get("generation_mode") == "live" and previous_prov.get("generation_mode") in {"fixture", "fallback", "manual_template"}:
        plan["provenance"]["generation_mode"] = previous_prov["generation_mode"]
    for note in previous_prov.get("notes", []):
        if isinstance(note, str) and note.startswith((CLOSEST_ROVER_NOTE, "Intent came from the ")):
            _record_choice(plan, note)


def interpret_request(req: InterpretRequest, deps: Deps) -> dict[str, Any]:
    """Vision port + sanitizer only (no engine solve). The result is stored for a later build."""
    as_generate = GenerateRequest(input=req.input, requirements=req.requirements)
    image = deps.assets.read_bytes(req.input.image_asset_id) if req.input.image_asset_id else None
    raw, vision_mode = deps.vision.interpret(as_generate, image), deps.vision.mode
    catalog_ids = {c["catalog_id"] for c in deps.engine.get_catalog()}
    intent = sanitize_intent(raw, catalog_ids, as_generate)
    deps.intents.put(intent, vision_mode)
    refused = support_limitation(intent, vision_mode)
    limitation = None if refused is None else Limitation(code=refused.code, message=refused.message, details=refused.details)
    return InterpretResponse(
        intent_id=intent.intent_id,
        intent=intent,
        supported=refused is None,
        limitation=limitation,
        vision_mode=vision_mode,
    ).model_dump(mode="json")


def stored_intent_for(req: GenerateRequest, deps: Deps) -> StoredIntent | None:
    """Resolve `intent_id` before a job exists: 404 INTENT_NOT_FOUND, 409 INTENT_INPUT_MISMATCH."""
    if req.intent_id is None:
        return None
    stored = deps.intents.get(req.intent_id)
    check_same_input(stored.intent, req)
    return stored


def generate_project(
    req: GenerateRequest, deps: Deps, job: JobSnapshot, stored: StoredIntent | None = None
) -> tuple[str, int]:
    jobs, job_id = deps.jobs, job.job_id

    image = None
    if req.input.image_asset_id:
        image = deps.assets.read_bytes(req.input.image_asset_id)
        jobs.emit(job_id, "upload", "system", "ok", f"Image received ({len(image[0])} bytes, {image[1]})")

    if stored is None:
        jobs.emit(job_id, "understand", "vision", "running", "Reading the request")
        raw: IntentSpec = deps.vision.interpret(req, image)
        vision_mode: str = deps.vision.mode
    else:
        raw, vision_mode = stored.intent, stored.vision_mode
        jobs.emit(
            job_id,
            "understand",
            "system",
            "running",
            f"Using the confirmed interpretation {raw.intent_id} ({vision_mode} vision); the input is not read again",
        )
    catalog_ids = {c["catalog_id"] for c in deps.engine.get_catalog()}
    # Requirements always come from this request, also for a stored interpretation.
    intent = sanitize_intent(raw, catalog_ids, req)
    if stored is None:
        deps.intents.put(intent, vision_mode)  # a refused job can still be built as the closest rover

    choice_note = None
    if req.interpretation_choice == "closest_supported_rover":
        intent, choice_note = closest_supported_rover(intent, vision_mode)
        if choice_note is not None:
            intent = sanitize_intent(intent, catalog_ids, req)  # support status stays decided by code
            jobs.emit(job_id, "understand", "system", "warning", choice_note)
    ensure_supported(intent, vision_mode)
    jobs.emit(
        job_id,
        "understand",
        "vision" if stored is None else "system",
        "ok",
        f"Interpreted as a {intent.project_family} ({intent.confidence} confidence, {vision_mode} vision)"
        if choice_note is None
        else "Building the closest supported rover, as the user chose",
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
        _label_provenance(plan, vision_mode)
        if choice_note is not None:
            _record_choice(plan, choice_note)
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

    saved = deps.store.create(plan)
    jobs.complete(job_id, saved["build_id"], saved["revision"])
    return saved["build_id"], saved["revision"]


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
    if operation["op"] == "replace_optional_sensor":
        catalog = deps.engine.get_catalog()
        new_id = operation["catalog_id"]
        if is_synthetic_catalog_id(new_id, catalog) or not is_verified_product(new_id, catalog):
            finding = {
                "rule_id": "api.real_product_only",
                "result": "UNKNOWN",
                "severity": "blocking",
                "affected_instance_ids": [],
                "message": f"{new_id} is not a real catalog product with a SKU and a verified https purchase link",
                "evidence_urls": [],
            }
            deps.store.log_edit(
                build_id,
                {"base_revision": req.base_revision, "instruction": req.instruction, "operation": operation,
                 "accepted": False, "finding": finding},
            )
            return {"accepted": False, "build_id": build_id, "finding": finding}
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
        _carry_choice_notes(current, result["plan"])
        check_plan(result["plan"], deps.engine)
        revision = deps.store.append_revision(build_id, req.base_revision, result["plan"])
    except ApiError as err:
        deps.store.log_edit(build_id, {**entry, "accepted": False, "error": err.envelope()["error"]})
        raise
    deps.store.log_edit(build_id, {**entry, "accepted": True, "revision": revision})
    return {"accepted": True, "build_id": build_id, "revision": revision}
