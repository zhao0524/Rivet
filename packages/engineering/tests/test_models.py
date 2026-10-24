import json
import typing

import pytest
from pydantic import ValidationError

import rivet_engine
from rivet_engine import models
from rivet_engine.models import BuildPlan, CatalogComponent, Connection, IntentSpec
from rivet_engine.ports import Catalog, CatalogError, EngineError, EngineNotImplementedError, finding
from tests import support


# --- fixtures parse and round-trip ------------------------------------------------


def test_appendix_fixtures_parse_and_round_trip():
    for model, raw in (
        (IntentSpec, support.appendix_intent_dict()),
        (BuildPlan, support.appendix_plan_dict()),
        *((CatalogComponent, r) for r in support.appendix_catalog_records()),
    ):
        assert model.model_validate(raw).to_wire() == raw


def test_synthetic_inputs_parse_and_round_trip():
    raw = support.synthetic_plan_dict()
    assert BuildPlan.model_validate(raw).to_wire() == raw
    for record in support.synthetic_catalog_records():
        assert CatalogComponent.model_validate(record).to_wire() == record


def test_json_text_round_trip_is_stable():
    plan = support.synthetic_plan()
    text = json.dumps(plan.to_wire(), sort_keys=True)
    assert json.dumps(BuildPlan.model_validate_json(text).to_wire(), sort_keys=True) == text


def test_connection_uses_from_on_the_wire():
    conn = support.synthetic_plan().connections[0]
    wire = conn.to_wire()
    assert "from" in wire and "from_" not in wire
    assert Connection.model_validate(wire) == conn


def test_shared_fixtures_match_private_copies_when_present():
    for relative, private in (
        ("plans/rover_obstacle_v1.json", support.appendix_plan_dict()),
        ("catalog/seed-components.json", support.appendix_catalog_records()),
        ("intent/rover_obstacle_v1.json", support.appendix_intent_dict()),
    ):
        path = support.shared_fixture(relative)
        if path is None:
            continue
        assert json.loads(path.read_text()) == private, f"shared {relative} drifted from Appendix A copy"


# --- nulls are preserved, never filled in -------------------------------------------


def test_unknown_catalog_values_stay_null():
    record = support.appendix_catalog_records()[0]
    wire = CatalogComponent.model_validate(record).to_wire()
    assert wire["physical"]["mass_g"] is None
    assert wire["sourcing"]["price_amount"] is None
    assert wire["identity"]["sku"] is None


def test_null_bom_prices_and_budget_survive():
    plan = support.appendix_plan().to_wire()
    assert plan["bom"]["known_subtotal_amount"] is None
    assert all(i["unit_price_amount"] is None for i in plan["bom"]["items"])
    intent = support.appendix_intent().to_wire()
    assert intent["requirements"]["max_budget"] is None


def test_numeric_budget_becomes_decimal_string():
    raw = support.appendix_intent_dict()
    raw["requirements"]["max_budget"] = 60.5
    assert IntentSpec.model_validate(raw).requirements.max_budget == "60.5"


# --- every enum value accepted, anything else rejected --------------------------------

ENUM_FIELDS = [
    ("status", models.PlanStatus),
    ("verification.overall", models.PlanStatus),
    ("verification.findings.0.result", models.FindingResult),
    ("verification.findings.0.severity", models.FindingSeverity),
    ("firmware.compile_status", models.CompileStatus),
    ("bom.total_status", models.BomTotalStatus),
    ("bom.items.0.link_status", models.LinkStatus),
    ("simulation.kind", models.SimulationKind),
    ("provenance.generation_mode", models.GenerationMode),
    ("connections.0.kind", models.ConnectionKind),
    ("project_family", models.ProjectFamily),
]


def _set(obj, dotted, value):
    *path, last = dotted.split(".")
    for key in path:
        obj = obj[int(key)] if key.isdigit() else obj[key]
    obj[int(last) if last.isdigit() else last] = value


@pytest.mark.parametrize("dotted,enum", ENUM_FIELDS)
def test_plan_enums(dotted, enum):
    for value in typing.get_args(enum):
        raw = support.synthetic_plan_dict()
        raw["verification"]["findings"] = [finding("x", "PASS", "advisory", "m").to_wire()]
        _set(raw, dotted, value)
        BuildPlan.model_validate(raw)
    raw = support.synthetic_plan_dict()
    raw["verification"]["findings"] = [finding("x", "PASS", "advisory", "m").to_wire()]
    _set(raw, dotted, "not-a-real-value")
    with pytest.raises(ValidationError):
        BuildPlan.model_validate(raw)


@pytest.mark.parametrize(
    "dotted,enum",
    [
        ("project_family", models.ProjectFamily),
        ("requested_behavior", models.RequestedBehavior),
        ("support_status", models.SupportStatus),
        ("confidence", models.Confidence),
        ("input.kind", models.InputKind),
    ],
)
def test_intent_enums(dotted, enum):
    for value in typing.get_args(enum):
        raw = support.appendix_intent_dict()
        _set(raw, dotted, value)
        IntentSpec.model_validate(raw)
    raw = support.appendix_intent_dict()
    _set(raw, dotted, "bogus")
    with pytest.raises(ValidationError):
        IntentSpec.model_validate(raw)


# --- malformed input rejected -----------------------------------------------------


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.update(extra_field=1),
        lambda p: p["components"][0].update(camelCase=True),
        lambda p: p.pop("bom"),
        lambda p: p.update(schema_version="2.0"),
        lambda p: p.update(revision=0),
        lambda p: p["components"][0]["pose"].update(position_mm=[0, 0]),
        lambda p: p["bom"]["items"][0].update(unit_price_amount="twelve"),
        lambda p: p["bom"]["items"][0].update(unit_price_amount=12.0),
        lambda p: p["bom"]["items"][0].update(quantity=0),
        lambda p: p["firmware"]["pin_map"].update(i2c_sda="21"),
        lambda p: p["connections"][0].pop("from"),
    ],
)
def test_malformed_plans_rejected(mutate):
    raw = support.synthetic_plan_dict()
    mutate(raw)
    with pytest.raises(ValidationError):
        BuildPlan.model_validate(raw)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda c: c.update(price=1),
        lambda c: c["identity"].update(category="spaceship"),
        lambda c: c["sourcing"].update(price_amount="-1"),
        lambda c: c["evidence"].update(dimensions="trust me"),
        lambda c: c["ports"][0].update(signal="telepathy"),
        lambda c: c["physical"].pop("bounds_verified"),
    ],
)
def test_malformed_catalog_records_rejected(mutate):
    record = next(r for r in support.synthetic_catalog_records() if r["ports"])
    mutate(record)
    with pytest.raises(ValidationError):
        CatalogComponent.model_validate(record)


def test_validate_assignment_rejects_bad_enum():
    plan = support.synthetic_plan()
    with pytest.raises(ValidationError):
        plan.status = "probably_fine"


# --- internal types -----------------------------------------------------------------


def test_catalog_rejects_duplicates_and_sorts():
    records = support.synthetic_catalog_records()
    comps = [CatalogComponent.model_validate(r) for r in reversed(records)]
    catalog = Catalog("v", tuple(comps))
    assert list(catalog.ids) == sorted(catalog.ids)
    with pytest.raises(CatalogError):
        Catalog("v", (comps[0], comps[0]))


def test_finding_helper_is_canonical():
    f = finding("r", "UNKNOWN", "blocking", "m", ["b", "a", "a"], ["", "https://x"])
    assert f.affected_instance_ids == ["a", "b"]
    assert f.evidence_urls == ["https://x"]


def test_error_envelope_shape():
    err = EngineNotImplementedError("nope", {"stage": "x"})
    assert isinstance(err, EngineError)
    assert err.to_envelope() == {
        "error": {"code": "ENGINE_NOT_IMPLEMENTED", "message": "nope", "details": {"stage": "x"}, "retryable": False}
    }


@pytest.mark.skipif(not rivet_engine._ENTRY_POINTS_ARE_STUBS, reason="entry points implemented")
@pytest.mark.parametrize(
    "call",
    [
        lambda: rivet_engine.solve(support.appendix_intent_dict()),
        lambda: rivet_engine.apply_edit(support.appendix_plan_dict(), {"op": "set_budget"}),
        lambda: rivet_engine.verify(support.appendix_plan_dict()),
        lambda: rivet_engine.get_catalog(),
    ],
)
def test_unimplemented_entry_points_reject_instead_of_faking(call):
    with pytest.raises(EngineError):
        call()
