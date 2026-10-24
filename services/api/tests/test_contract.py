import pytest
from pydantic import ValidationError

from rivet_api.contract import ContractViolation, assert_build_plan_contract
from rivet_api.models.events import JobEvent
from rivet_api.models.intent import IntentSpec
from rivet_api.models.plan import BuildPlan


def wire(model) -> dict:
    return model.model_dump(mode="json", exclude_unset=True, by_alias=True)


def test_intent_fixture_round_trips(intent_dict):
    assert wire(IntentSpec.model_validate(intent_dict)) == intent_dict


def test_intent_rejects_unknown_enum_and_extra_keys(intent_dict):
    bad = {**intent_dict, "project_family": "submarine"}
    with pytest.raises(ValidationError):
        IntentSpec.model_validate(bad)
    with pytest.raises(ValidationError):
        IntentSpec.model_validate({**intent_dict, "model_says_verified": True})


def test_plan_fixture_round_trips(plan_dict):
    assert wire(BuildPlan.model_validate(plan_dict)) == plan_dict


def test_plan_rejects_bad_enum_and_missing_schema_version(plan_dict):
    with pytest.raises(ValidationError):
        BuildPlan.model_validate({**plan_dict, "status": "definitely_fine"})
    missing = {k: v for k, v in plan_dict.items() if k != "schema_version"}
    with pytest.raises(ValidationError):
        BuildPlan.model_validate(missing)


def test_contract_accepts_valid_plan(plan_dict, catalog):
    assert_build_plan_contract(BuildPlan.model_validate(plan_dict), catalog)


def test_contract_rejects_missing_driver_reference(plan_dict, catalog):
    plan_dict["components"] = [
        c for c in plan_dict["components"] if c["instance_id"] != "driver-1"
    ]
    with pytest.raises(ContractViolation) as exc:
        assert_build_plan_contract(BuildPlan.model_validate(plan_dict), catalog)
    assert any("driver-1" in e for e in exc.value.errors)


def test_contract_rejects_duplicate_instance_ids(plan_dict, catalog):
    plan_dict["components"].append(dict(plan_dict["components"][1]))
    with pytest.raises(ContractViolation) as exc:
        assert_build_plan_contract(BuildPlan.model_validate(plan_dict), catalog)
    assert any("duplicate" in e.lower() for e in exc.value.errors)


def test_contract_rejects_unknown_catalog_id(plan_dict, catalog):
    plan_dict["components"][1]["catalog_id"] = "nope.not_in_catalog"
    with pytest.raises(ContractViolation) as exc:
        assert_build_plan_contract(BuildPlan.model_validate(plan_dict), catalog)
    assert any("nope.not_in_catalog" in e for e in exc.value.errors)


def test_contract_rejects_unknown_mount_and_port(plan_dict, catalog):
    plan_dict["components"][1]["attached_to_mount_id"] = "no_such_mount"
    plan_dict["connections"][0]["from"]["port_id"] = "no_such_port"
    with pytest.raises(ContractViolation) as exc:
        assert_build_plan_contract(BuildPlan.model_validate(plan_dict), catalog)
    joined = " ".join(exc.value.errors)
    assert "no_such_mount" in joined and "no_such_port" in joined


def test_contract_rejects_bom_quantity_mismatch(plan_dict, catalog):
    plan_dict["bom"]["items"][0]["quantity"] += 1
    with pytest.raises(ContractViolation) as exc:
        assert_build_plan_contract(BuildPlan.model_validate(plan_dict), catalog)
    assert any("quantity" in e for e in exc.value.errors)


def test_contract_rejects_dangling_step_and_bom_instances(plan_dict, catalog):
    plan_dict["assembly_steps"][0]["instance_ids"].append("ghost-1")
    plan_dict["bom"]["items"][0]["instance_ids"].append("ghost-2")
    with pytest.raises(ContractViolation) as exc:
        assert_build_plan_contract(BuildPlan.model_validate(plan_dict), catalog)
    joined = " ".join(exc.value.errors)
    assert "ghost-1" in joined and "ghost-2" in joined


def test_job_event_enforces_stage_actor_status_enums():
    ok = {
        "event_id": 1,
        "job_id": "job-demo-001",
        "stage": "catalog_selection",
        "actor": "planner",
        "status": "running",
        "message": "Finding compatible controller",
        "timestamp": "2026-10-24T00:00:00Z",
        "references": [],
    }
    JobEvent.model_validate(ok)
    for field, bad in [("stage", "dreaming"), ("actor", "wizard"), ("status", "ok!")]:
        with pytest.raises(ValidationError):
            JobEvent.model_validate({**ok, field: bad})
