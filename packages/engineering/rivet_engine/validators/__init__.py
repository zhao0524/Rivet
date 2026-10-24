"""Deterministic verification of a candidate BuildPlan (B4).

`verify_candidate` runs every implemented rule family and aggregates the result. It
ignores the plan's own `status` and `verification`. "verified" means verified against
these supported rules only; it is not a physical safety certification.
"""

from __future__ import annotations

from collections.abc import Sequence

from rivet_engine.models import BuildPlan, Finding, PlanStatus
from rivet_engine.ports import Catalog, VerificationContext, VerificationReport
from rivet_engine.validators import budget, electrical, firmware, integrity, mechanical, requirements, sourcing
from rivet_engine.validators.common import PlanView

CHECKS = (integrity, requirements, mechanical, electrical, budget, firmware, sourcing)


def aggregate(findings: Sequence[Finding]) -> PlanStatus:
    if any(f.result == "FAIL" and f.severity == "blocking" for f in findings):
        return "unbuildable"
    if any(f.result == "UNKNOWN" and f.severity == "blocking" for f in findings):
        return "needs_review"
    if any(f.result != "PASS" for f in findings):
        return "verified_with_warnings"
    return "verified"


def sort_findings(findings: Sequence[Finding]) -> tuple[Finding, ...]:
    unique = {f.model_dump_json(): f for f in findings}
    return tuple(sorted(unique.values(), key=lambda f: (f.rule_id, f.affected_instance_ids, f.result, f.message)))


def verify_candidate(
    plan: BuildPlan, catalog: Catalog, context: VerificationContext = VerificationContext()
) -> VerificationReport:
    view = PlanView(plan.model_copy(deep=True), catalog, context)
    findings: list[Finding] = []
    for module in CHECKS:
        findings += module.check(view)
    ordered = sort_findings(findings)
    return VerificationReport(overall=aggregate(ordered), findings=ordered)


__all__ = ["aggregate", "sort_findings", "verify_candidate"]
