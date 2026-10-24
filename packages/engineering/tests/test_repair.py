"""Repair tests use injected rebuild/verify callbacks only (no placement, wiring or validators)."""

import copy

from rivet_engine.models import BuildPlan, Finding
from rivet_engine.ports import (
    OffsetCorrection,
    PlacementError,
    Substitution,
    VerificationReport,
    finding,
)
from rivet_engine.repair import candidate_actions, is_acceptable_substitute, repair_candidate, summarize
from rivet_engine.validators import aggregate
from tests import support


def report(*findings: Finding) -> VerificationReport:
    return VerificationReport(aggregate(findings), tuple(findings))


def swap_rebuild(calls=None):
    def rebuild(plan: BuildPlan, action, catalog):
        if calls is not None:
            calls.append(action)
        if isinstance(action, Substitution):
            raw = support.substitute(plan.to_wire(), list(action.instance_ids), action.catalog_id)
            return BuildPlan.model_validate(raw)
        out = plan.model_copy(deep=True)
        inst = next(c for c in out.components if c.instance_id == action.instance_id)
        inst.pose.position_mm = [p + o for p, o in zip(inst.pose.position_mm, action.offset_mm)]
        return out

    return rebuild


def current_rule(plan: BuildPlan, catalog):
    """Fake verifier: motors with stall > 1.0 A fail; the driver part is irrelevant."""
    motors = [c for c in plan.components if c.role == "motor"]
    bad = [c.instance_id for c in motors if catalog.require(c.catalog_id).ports[0].current_limit_a in (None, 2.8)]
    if bad:
        return report(finding("electrical.motor_driver_current", "FAIL", "blocking", "stall too high", bad))
    return report(finding("electrical.motor_driver_current", "PASS", "blocking", "ok", [m.instance_id for m in motors]))


def high_stall_plan():
    return BuildPlan.model_validate(
        support.substitute(support.synthetic_plan_dict(), ["motor-left-1", "motor-right-1"], "synthetic.motor_high_stall")
    )


def test_documented_substitution_repairs_and_reverifies():
    calls = []
    verified = []

    def verify(plan, catalog):
        verified.append(plan)
        return current_rule(plan, catalog)

    result = repair_candidate(high_stall_plan(), support.synthetic_catalog(), rebuild=swap_rebuild(calls), verify=verify)
    assert result.outcome == "repaired"
    assert {c.catalog_id for c in result.plan.components if c.role == "motor"} == {"synthetic.motor"}
    assert result.plan.status == result.report.overall == "verified"
    assert len(verified) == len(calls) + 1  # every rebuild was re-verified
    assert any(a.accepted for a in result.attempts)
    assert summarize(result)


def test_already_valid_plan_is_unchanged():
    plan = support.synthetic_plan()
    result = repair_candidate(plan, support.synthetic_catalog(), rebuild=swap_rebuild(), verify=current_rule)
    assert result.outcome == "unchanged" and result.attempts == ()
    assert [c.catalog_id for c in result.plan.components] == [c.catalog_id for c in plan.components]


def test_no_alternative_is_an_honest_rejection():
    def verify(plan, catalog):
        return report(finding("mechanical.mount_mates", "FAIL", "blocking", "chassis cannot hold the caster", ["chassis-1"]))

    result = repair_candidate(support.synthetic_plan(), support.synthetic_catalog(), rebuild=swap_rebuild(), verify=verify)
    assert result.outcome == "rejected"
    assert result.report.overall == "unbuildable"
    assert result.plan.verification.findings[0].message == "chassis cannot hold the caster"


def test_unknowns_never_disappear():
    unknown = finding("electrical.motor_driver_current", "UNKNOWN", "blocking", "stall not sourced", ["motor-left-1"])

    def verify(plan, catalog):
        return report(unknown)

    result = repair_candidate(support.synthetic_plan(), support.synthetic_catalog(), rebuild=swap_rebuild(), verify=verify)
    assert result.outcome == "unchanged" and result.report.findings == (unknown,)
    assert result.plan.status == "needs_review"


def test_layout_correction():
    def verify(plan, catalog):
        sensor = next(c for c in plan.components if c.instance_id == "sensor-1")
        if sensor.pose.position_mm[1] < 60:
            return report(finding("mechanical.overlap", "FAIL", "blocking", "sensor blocked", ["sensor-1"]))
        return report()

    def layout(f, plan):
        return [OffsetCorrection("sensor-1", (0, 10, 0), "raise sensor")] if f.rule_id == "mechanical.overlap" else []

    result = repair_candidate(support.synthetic_plan(), support.synthetic_catalog(), rebuild=swap_rebuild(), verify=verify, layout_options=layout)
    assert result.outcome == "repaired"
    assert next(c for c in result.plan.components if c.instance_id == "sensor-1").pose.position_mm[1] == 62


def test_three_round_bound():
    def verify(plan, catalog):
        sensor = next(c for c in plan.components if c.instance_id == "sensor-1")
        height = sensor.pose.position_mm[1]
        return report(*[finding(f"mechanical.r{n}", "FAIL", "blocking", "x", ["sensor-1"]) for n in range(int(200 - height))][:10])

    def layout(f, plan):
        return [OffsetCorrection("sensor-1", (0, 1, 0), "nudge")]

    result = repair_candidate(support.synthetic_plan(), support.synthetic_catalog(), rebuild=swap_rebuild(), verify=verify, layout_options=layout)
    accepted = [a for a in result.attempts if a.accepted]
    assert len(accepted) <= 3
    assert max(a.round for a in result.attempts) <= 3


def test_repeated_candidates_stop():
    def rebuild(plan, action, catalog):
        return plan.model_copy(deep=True)  # nothing changes

    def verify(plan, catalog):
        return report(finding("electrical.motor_driver_current", "FAIL", "blocking", "x", ["motor-left-1"]))

    result = repair_candidate(high_stall_plan(), support.synthetic_catalog(), rebuild=rebuild, verify=verify)
    assert result.outcome == "rejected"
    assert all(a.note == "candidate already tried" for a in result.attempts)


def test_change_that_adds_a_failure_is_not_kept():
    def verify(plan, catalog):
        motor_ids = {c.catalog_id for c in plan.components if c.role == "motor"}
        if "synthetic.motor_high_stall" in motor_ids:
            return report(finding("electrical.motor_driver_current", "FAIL", "blocking", "stall", ["motor-left-1"]))
        # every substitute "fixes" current but breaks the budget
        return report(finding("budget.max_budget", "FAIL", "blocking", "over budget", []))

    result = repair_candidate(high_stall_plan(), support.synthetic_catalog(), rebuild=swap_rebuild(), verify=verify)
    assert result.outcome == "rejected"
    assert {c.catalog_id for c in result.plan.components if c.role == "motor"} == {"synthetic.motor_high_stall"}
    assert any("introduced budget.max_budget" in a.note for a in result.attempts)


def test_rebuild_errors_are_recorded_not_raised():
    def rebuild(plan, action, catalog):
        raise PlacementError("does not fit")

    result = repair_candidate(high_stall_plan(), support.synthetic_catalog(), rebuild=rebuild, verify=current_rule)
    assert result.outcome == "rejected"
    assert all("does not fit" in a.note for a in result.attempts)


def test_stable_choice_ordering():
    plan = high_stall_plan()
    rep = current_rule(plan, support.synthetic_catalog())
    first = candidate_actions(plan, support.synthetic_catalog(), rep)
    assert first == candidate_actions(plan, support.synthetic_catalog(), rep)
    targets = [a.catalog_id for a in first]
    assert targets == sorted(targets)
    assert all(a.instance_ids == ("motor-left-1", "motor-right-1") for a in first)


def test_never_downgrades_evidence_or_mixes_real_and_synthetic():
    from rivet_engine.catalog import load_catalog

    real = load_catalog()
    synthetic = support.synthetic_catalog()
    assert not is_acceptable_substitute(real.require("motor.adafruit_tt_gearbox_200rpm_3777"), synthetic.require("synthetic.motor"))
    records = support.synthetic_catalog_records()
    weak = next(r for r in records if r["catalog_id"] == "synthetic.motor_unrated")
    weak["evidence"]["electrical"] = "unverified"
    from rivet_engine.catalog import catalog_from_records

    cat = catalog_from_records(records, "t")
    assert not is_acceptable_substitute(cat.require("synthetic.motor"), cat.require("synthetic.motor_unrated"))
    assert is_acceptable_substitute(cat.require("synthetic.motor_unrated"), cat.require("synthetic.motor"))


def test_input_and_catalog_not_mutated():
    plan = high_stall_plan()
    catalog = support.synthetic_catalog()
    before_plan, before_catalog = plan.to_wire(), copy.deepcopy(catalog.to_wire())
    repair_candidate(plan, catalog, rebuild=swap_rebuild(), verify=current_rule)
    assert plan.to_wire() == before_plan and catalog.to_wire() == before_catalog


def test_result_has_no_extra_plan_fields():
    result = repair_candidate(high_stall_plan(), support.synthetic_catalog(), rebuild=swap_rebuild(), verify=current_rule)
    assert set(result.plan.to_wire()) == set(support.synthetic_plan_dict())
