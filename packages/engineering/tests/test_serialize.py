import json

import pytest

from rivet_engine.ports import InvalidInputError
from rivet_engine.serialize import plan_from_dict, plan_to_dict, plan_to_json
from tests import support


def test_json_is_deterministic_and_round_trips():
    plan = support.synthetic_plan()
    text = plan_to_json(plan)
    assert text == plan_to_json(plan_from_dict(json.loads(text)))
    assert text.endswith("\n")
    assert list(json.loads(text)) == sorted(json.loads(text))


def test_nulls_identity_and_revision_preserved():
    raw = support.appendix_plan_dict()
    out = plan_to_dict(plan_from_dict(raw))
    assert out == raw
    assert out["bom"]["known_subtotal_amount"] is None
    assert (out["build_id"], out["revision"]) == (raw["build_id"], raw["revision"])


def test_no_extra_fields_emitted_or_accepted():
    raw = support.synthetic_plan_dict()
    raw["internal_repair_log"] = []
    with pytest.raises(InvalidInputError) as err:
        plan_from_dict(raw)
    assert any("internal_repair_log" in e for e in err.value.details["errors"])


def test_serialization_does_not_mutate():
    plan = support.synthetic_plan()
    before = plan.model_dump()
    plan_to_json(plan)
    plan_to_dict(plan)["title"] = "changed"
    assert plan.model_dump() == before


def test_rejects_non_mapping():
    with pytest.raises(InvalidInputError):
        plan_from_dict(["not", "a", "plan"])
