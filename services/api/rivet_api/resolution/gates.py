"""Outcome gates (plan sections 4 and 6). Pure and deterministic: no network, no model.

Everything a resolver returns is re-checked here. A claim that cannot be backed by an
assessed record is dropped, a disagreement between sources is a conflict (never averaged),
and any doubt resolves toward the less certain outcome.
"""

from dataclasses import dataclass, field
from datetime import datetime

from rivet_api.agents.product import LOW_CONFIDENCE_REASON, ProductGuess
from rivet_api.resolution.evidence import Evidence, assess
from rivet_api.resolution.models import (
    AlternativeResult,
    ClaimResult,
    ClaimStatus,
    Counts,
    LedgerEntry,
    Outcome,
    PartResult,
    ProductResult,
    TypicalPartResult,
)
from rivet_api.resolution.resolver import ResolverResult

HEADLINES: dict[str, str] = {
    "exact_match": "We found this product: {name} (SKU {sku}). Here are its parts, each with its source.",
    "partial_match": (
        "We found {name} (SKU {sku}) but could not confirm {gaps} of {total} parts. "
        "Here is what we do know, and what similar products use for the rest."
    ),
    "no_match_with_alternatives": (
        "We could not find this exact product. These are the closest products we can verify, "
        "and what similar products use for each part."
    ),
    "unsupported": "This is not a product Rivet can reason about. {reason}",
    "low_confidence": "We could not tell which product this is. {reason}",
}


def _norm(value: str | None) -> str:
    return " ".join((value or "").split()).casefold()


@dataclass
class Ledger:
    now: datetime
    entries: list[LedgerEntry] = field(default_factory=list)

    def add(self, subject: str, ev: Evidence) -> LedgerEntry:
        support, reason = assess(ev, self.now)
        entry = LedgerEntry(
            evidence_id=f"ev-{len(self.entries) + 1:03d}", subject=subject, support=support, reason=reason, evidence=ev
        )
        self.entries.append(entry)
        return entry


def resolve_claims(subject: str, evidence: list[Evidence], ledger: Ledger) -> dict[str, ClaimResult]:
    """Group records by claim and decide each claim from its assessed records."""
    by_claim: dict[str, list[LedgerEntry]] = {}
    for ev in evidence:
        by_claim.setdefault(ev.claim, []).append(ledger.add(subject, ev))
    out: dict[str, ClaimResult] = {}
    for claim, entries in by_claim.items():
        ids = [e.evidence_id for e in entries]
        backing = [e for e in entries if e.support in ("verified", "inferred")]
        values: dict[str, str] = {}
        for e in backing:
            values.setdefault(_norm(e.evidence.value), e.evidence.value)
        if len(values) > 1:
            out[claim] = ClaimResult(
                claim=claim,
                status="conflict",
                conflicting_values=sorted(values.values()),
                evidence_ids=ids,
                note="Sources disagree; no value is chosen",
            )
        elif backing:
            verified = [e for e in backing if e.support == "verified"]
            best = verified[0] if verified else backing[0]
            out[claim] = ClaimResult(
                claim=claim,
                status="verified" if verified else "inferred",
                value=best.evidence.value,
                evidence_ids=ids,
                note=None if verified else best.reason,
            )
        else:
            # Only out-of-date records back the value: it needs refetching, it is not confirmed.
            stale = any(e.support == "stale" for e in entries)
            reasons = sorted({e.reason for e in entries})
            out[claim] = ClaimResult(
                claim=claim, status="stale" if stale else "not_found", evidence_ids=ids, note="; ".join(reasons)
            )
    return out


def _sku_status(claims: dict[str, ClaimResult], declared_sku: str | None) -> tuple[ClaimStatus, str | None]:
    """Status and value of the SKU claim. A declared SKU the evidence does not carry is not found."""
    if any(c.status == "conflict" for c in claims.values()):
        return "conflict", None
    sku = claims.get("sku")
    if sku is None:
        return "not_found", None
    if sku.status in ("not_found", "stale"):
        return sku.status, None
    if declared_sku is not None and _norm(declared_sku) != _norm(sku.value):
        return "conflict", None
    return sku.status, sku.value


@dataclass
class GateResult:
    outcome: Outcome
    headline: str
    product: ProductResult | None = None
    parts: list[PartResult] = field(default_factory=list)
    alternatives: list[AlternativeResult] = field(default_factory=list)
    typical_parts: list[TypicalPartResult] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    counts: Counts = field(default_factory=Counts)
    unsupported_reason: str | None = None
    ledger: list[LedgerEntry] = field(default_factory=list)


def unsupported_result(guess: ProductGuess) -> GateResult:
    reason = guess.unsupported_reason or "It does not look like a physical product."
    # A product we could not read is not "not a product": the copy must not claim more than we know.
    template = HEADLINES["low_confidence" if reason == LOW_CONFIDENCE_REASON else "unsupported"]
    return GateResult(
        outcome="unsupported",
        headline=template.format(reason=reason).strip(),
        unsupported_reason=reason,
    )


def _fallbacks(result: ResolverResult, ledger: Ledger, counts: Counts):
    alternatives: list[AlternativeResult] = []
    for alt in result.alternatives:
        claims = resolve_claims(f"alternative:{alt.sku}", alt.evidence, ledger)
        status, value = _sku_status(claims, alt.sku)
        # "Closest we can verify": an alternative whose SKU is not verified is dropped.
        if status != "verified":
            counts.dropped_claims += 1
            continue
        ids = [i for c in claims.values() for i in c.evidence_ids]
        alternatives.append(
            AlternativeResult(
                brand=alt.brand, name=alt.name, sku=alt.sku, reason=alt.reason, status=status, evidence_ids=ids
            )
        )
    typical: list[TypicalPartResult] = []
    for tp in result.typical_parts:
        claims = resolve_claims(f"typical:{tp.name}", tp.evidence, ledger)
        status, _ = _sku_status(claims, tp.sku)
        if status != "verified":  # a reference entry is itself sourced, or it is not shown
            counts.dropped_claims += 1
            continue
        ids = [i for c in claims.values() for i in c.evidence_ids]
        typical.append(TypicalPartResult(name=tp.name, rationale=tp.rationale, sku=tp.sku, evidence_ids=ids))
    return alternatives, typical


def apply_gates(guess: ProductGuess, result: ResolverResult, now: datetime) -> GateResult:
    if guess.verdict == "unsupported":
        return unsupported_result(guess)

    ledger = Ledger(now)
    counts = Counts()
    conflicts: list[str] = []
    product_result: ProductResult | None = None

    candidate = result.product
    if candidate is not None:
        claims = resolve_claims("product", candidate.evidence, ledger)
        status, sku = _sku_status(claims, candidate.sku)
        # Brand must agree with what the image/text suggested; a mismatch is a different product.
        if guess.brand and _norm(guess.brand) != _norm(candidate.brand):
            status, sku = "not_found", None
            claims["sku"] = ClaimResult(
                claim="sku", status="not_found", note="The source's brand does not match the identified brand"
            )
        if status == "conflict":
            conflicts.append("product: sources disagree on the SKU")
        product_result = ProductResult(brand=candidate.brand, name=candidate.name, sku=sku, status=status, claims=list(claims.values()))

    product_confirmed = product_result is not None and product_result.status == "verified"

    parts: list[PartResult] = []
    if product_confirmed:
        for part in result.parts:
            claims = resolve_claims(f"part:{part.part_id}", part.evidence, ledger)
            status, sku = _sku_status(claims, part.sku)
            note = None
            if status == "not_found" and part.unavailable_reason and not part.evidence:
                status, note = "unavailable", part.unavailable_reason
            if status == "conflict":
                conflicts.append(f"part {part.part_id}: sources disagree")
                note = "Sources disagree; no value is chosen"
            parts.append(PartResult(part_id=part.part_id, name=part.name, sku=sku, status=status, claims=list(claims.values()), note=note))
        for key in ("verified", "inferred", "not_found", "stale", "conflict", "unavailable"):
            setattr(counts, key, sum(1 for p in parts if p.status == key))
        counts.parts_total = len(parts)

    if product_confirmed:
        assert product_result is not None
        gaps = sum(1 for p in parts if p.status not in ("verified", "unavailable"))
        # Zero parts is "not yet decomposed", never "nothing is missing".
        outcome: Outcome = "exact_match" if parts and gaps == 0 else "partial_match"
        headline = HEADLINES[outcome].format(
            name=product_result.name, sku=product_result.sku, gaps=gaps if parts else 0, total=len(parts)
        )
        if not parts:
            headline = (
                f"We found {product_result.name} (SKU {product_result.sku}) but could not confirm any of its parts. "
                "Here is what similar products use."
            )
    else:
        outcome = "no_match_with_alternatives"
        headline = HEADLINES[outcome]

    alternatives: list[AlternativeResult] = []
    typical: list[TypicalPartResult] = []
    if outcome != "exact_match":
        alternatives, typical = _fallbacks(result, ledger, counts)

    return GateResult(
        outcome=outcome,
        headline=headline,
        product=product_result,
        parts=parts,
        alternatives=alternatives,
        typical_parts=typical,
        conflicts=conflicts,
        counts=counts,
        ledger=ledger.entries,
    )
