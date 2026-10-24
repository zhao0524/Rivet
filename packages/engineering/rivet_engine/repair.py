"""Bounded, deterministic repair loop (B5).

    verify -> for each blocking FAIL, try catalog-backed substitutions (and optional
    layout corrections) in a stable order -> rebuild -> re-verify everything -> keep the
    first change that removes a blocking failure without adding one -> repeat (<= 3 rounds)

The injected `verify` is the only authority: repair never edits findings, catalog
records or evidence, and never swaps in a part with weaker evidence than the one it
replaces. Rebuild and verify are callbacks, so this module does not depend on the
placement, wiring or validator implementations.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

from rivet_engine.models import BuildPlan, CatalogComponent, Finding
from rivet_engine.ports import (
    Catalog,
    EngineError,
    LayoutOptionsFn,
    RebuildFn,
    RepairAction,
    RepairAttempt,
    RepairResult,
    Substitution,
    VerificationReport,
    VerifyFn,
)

EVIDENCE_RANK = {"verified": 4, "approximated": 3, "synthetic_approximation": 2, "unverified": 1, "unknown": 0}


def _blocking_fails(report: VerificationReport) -> set[tuple[str, tuple[str, ...], str]]:
    return {
        (f.rule_id, tuple(f.affected_instance_ids), f.message)
        for f in report.findings
        if f.result == "FAIL" and f.severity == "blocking"
    }


def _fail_keys(report: VerificationReport) -> set[tuple[str, tuple[str, ...]]]:
    return {(rule, ids) for rule, ids, _ in _blocking_fails(report)}


def _fingerprint(plan: BuildPlan) -> str:
    return json.dumps(
        sorted((c.instance_id, c.catalog_id, c.pose.position_mm, c.pose.rotation_deg) for c in plan.components)
    )


def is_acceptable_substitute(current: CatalogComponent, candidate: CatalogComponent) -> bool:
    """Same category, same real/synthetic kind, and evidence no weaker in any dimension."""
    if candidate.catalog_id == current.catalog_id or candidate.identity.category != current.identity.category:
        return False
    if candidate.is_synthetic != current.is_synthetic:
        return False
    return all(
        EVIDENCE_RANK[getattr(candidate.evidence, field)] >= EVIDENCE_RANK[getattr(current.evidence, field)]
        for field in ("electrical", "dimensions")
    )


def candidate_actions(
    plan: BuildPlan,
    catalog: Catalog,
    report: VerificationReport,
    layout_options: LayoutOptionsFn | None = None,
) -> list[RepairAction]:
    """All actions worth trying for the current blocking failures, in a stable order."""
    actions: list[RepairAction] = []
    fails: list[Finding] = sorted(
        (f for f in report.findings if f.result == "FAIL" and f.severity == "blocking"),
        key=lambda f: (f.rule_id, f.affected_instance_ids, f.message),
    )
    by_id = {c.instance_id: c for c in plan.components}
    for f in fails:
        for iid in f.affected_instance_ids:
            inst = by_id.get(iid)
            current = catalog.get(inst.catalog_id) if inst else None
            if current is None:
                continue
            same_part = tuple(sorted(c.instance_id for c in plan.components if c.catalog_id == inst.catalog_id and c.role == inst.role))
            for alt in catalog.by_category(current.identity.category):
                if is_acceptable_substitute(current, alt):
                    actions.append(Substitution(same_part, alt.catalog_id, f"{f.rule_id}: {f.message}"))
        if layout_options is not None:
            actions += list(layout_options(f, plan))
    unique: list[RepairAction] = []
    for a in actions:
        if a not in unique:
            unique.append(a)
    return unique


def _with_report(plan: BuildPlan, report: VerificationReport) -> BuildPlan:
    out = plan.model_copy(deep=True)
    out.verification = report.to_verification()
    out.status = report.overall
    return out


def repair_candidate(
    plan: BuildPlan,
    catalog: Catalog,
    *,
    rebuild: RebuildFn,
    verify: VerifyFn,
    layout_options: LayoutOptionsFn | None = None,
    max_rounds: int = 3,
) -> RepairResult:
    best = plan.model_copy(deep=True)
    best_report = verify(best, catalog)
    if not _blocking_fails(best_report):
        return RepairResult(_with_report(best, best_report), best_report, "unchanged")

    start_fails = len(_blocking_fails(best_report))
    seen = {_fingerprint(best)}
    attempts: list[RepairAttempt] = []
    for round_no in range(1, min(max_rounds, 3) + 1):
        improved = False
        for action in candidate_actions(best, catalog, best_report, layout_options):
            try:
                candidate = rebuild(best.model_copy(deep=True), action, catalog)
            except EngineError as err:
                attempts.append(RepairAttempt(round_no, action, False, None, f"rebuild rejected: {err.message}"))
                continue
            fp = _fingerprint(candidate)
            if fp in seen:
                attempts.append(RepairAttempt(round_no, action, False, None, "candidate already tried"))
                continue
            seen.add(fp)
            report = verify(candidate, catalog)
            before, after = _fail_keys(best_report), _fail_keys(report)
            if after < before:
                attempts.append(RepairAttempt(round_no, action, True, report.overall, f"removed {len(before - after)} blocking failure(s)"))
                best, best_report, improved = candidate, report, True
                break
            added = sorted(rule for rule, _ in after - before)
            note = f"introduced {', '.join(added)}" if added else "did not remove a blocking failure"
            attempts.append(RepairAttempt(round_no, action, False, report.overall, note))
        if not improved or not _blocking_fails(best_report):
            break

    remaining = len(_blocking_fails(best_report))
    outcome = "repaired" if remaining == 0 else "improved" if remaining < start_fails else "rejected"
    return RepairResult(_with_report(best, best_report), best_report, outcome, tuple(attempts))


def summarize(result: RepairResult) -> Sequence[str]:
    """Human-readable attempt log (for provenance notes; not a wire field)."""
    lines = []
    for a in result.attempts:
        what = f"swap {', '.join(a.action.instance_ids)} to {a.action.catalog_id}" if isinstance(a.action, Substitution) else f"move {a.action.instance_id} by {list(a.action.offset_mm)} mm"
        lines.append(f"Repair round {a.round}: {what}: {'accepted' if a.accepted else 'rejected'} ({a.note})")
    return lines
