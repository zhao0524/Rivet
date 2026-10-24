"""Shared helpers for validators: indexed plan view, range comparison, rule results."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from rivet_engine.models import BuildPlan, CatalogComponent, ComponentInstance, Connection, Finding, Port
from rivet_engine.ports import Catalog, VerificationContext, finding


@dataclass
class PlanView:
    plan: BuildPlan
    catalog: Catalog
    context: VerificationContext
    by_id: dict[str, ComponentInstance] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # First occurrence wins; duplicates are reported by integrity rules.
        for c in self.plan.components:
            self.by_id.setdefault(c.instance_id, c)

    def component(self, instance_id: str) -> CatalogComponent | None:
        inst = self.by_id.get(instance_id)
        return self.catalog.get(inst.catalog_id) if inst else None

    def port(self, instance_id: str, port_id: str | None) -> Port | None:
        comp = self.component(instance_id)
        return comp.port(port_id) if comp and port_id else None

    def role(self, role: str) -> list[ComponentInstance]:
        return [c for c in self.plan.components if c.role == role]

    @property
    def electrical(self) -> list[Connection]:
        return [c for c in self.plan.connections if c.kind == "electrical"]

    def resolvable(self, conn: Connection) -> bool:
        return all(self.port(e.instance_id, e.port_id) is not None for e in (conn.from_, conn.to))

    def urls(self, instance_ids: Iterable[str]) -> list[str]:
        out = []
        for iid in instance_ids:
            comp = self.component(iid)
            if comp:
                out += [comp.sourcing.datasheet_url, comp.sourcing.manufacturer_reference_url]
        return [u for u in out if u]

    def ratings_verified(self, instance_ids: Iterable[str]) -> bool:
        return all((c := self.component(i)) is not None and c.evidence.electrical == "verified" for i in instance_ids)


class Rule:
    """Collects findings for one rule_id; emits a single PASS if nothing went wrong."""

    def __init__(self, rule_id: str, severity: str = "blocking", pass_message: str = "Check passed"):
        self.rule_id = rule_id
        self.severity = severity
        self.pass_message = pass_message
        self.findings: list[Finding] = []
        self.checked: set[str] = set()
        self.evidence: set[str] = set()
        self.applicable = True

    def add(self, result: str, message: str, ids: Iterable[str] = (), urls: Iterable[str] = (), severity: str | None = None) -> None:
        self.findings.append(finding(self.rule_id, result, severity or self.severity, message, ids, urls))

    def fail(self, message, ids=(), urls=(), severity=None):
        self.add("FAIL", message, ids, urls, severity)

    def unknown(self, message, ids=(), urls=(), severity=None):
        self.add("UNKNOWN", message, ids, urls, severity)

    def warn(self, message, ids=(), urls=()):
        self.add("WARN", message, ids, urls, "advisory")

    def ok(self, ids: Iterable[str] = (), urls: Iterable[str] = ()) -> None:
        self.checked.update(ids)
        self.evidence.update(u for u in urls if u)

    def result(self) -> list[Finding]:
        if self.findings or not self.applicable:
            return self.findings
        return [finding(self.rule_id, "PASS", self.severity, self.pass_message, self.checked, self.evidence)]


def compare_range(supply: tuple[float | None, float | None], accept: tuple[float | None, float | None]) -> str:
    """'inside' | 'partial' | 'outside' | 'unknown' for a supply range against an accepted range."""
    smin, smax = supply
    amin, amax = accept
    if None in (smin, smax, amin, amax):
        return "unknown"
    if smin >= amin and smax <= amax:
        return "inside"
    if smax < amin or smin > amax:
        return "outside"
    return "partial"
