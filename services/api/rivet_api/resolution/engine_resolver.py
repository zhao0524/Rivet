"""Lane B's resolver behind the API's `ProductResolver` protocol.

Drives `rivet_engine.sourcing` (adapters, verifier, decomposition, reference architectures)
and maps its results into `ResolverResult`. It only proposes candidates with their Evidence;
`gates.py` re-checks every record and decides the outcome. `mode` is "live" with the polite
network fetcher and "fixture" when replaying recorded pages (never presented as live).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Literal

from rivet_api.agents.product import ProductGuess
from rivet_api.resolution.evidence import Evidence
from rivet_api.resolution.resolver import (
    AlternativeProduct,
    PartCandidate,
    ProductCandidate,
    ResolverResult,
    TypicalPart,
)

RECORDED_PAGES = Path(__file__).resolve().parents[4] / "packages" / "engineering" / "tests" / "support" / "recorded"


def _evidence(records: Any) -> list[Evidence]:
    """Engine records with a quote become API Evidence; quoteless records cannot support a claim."""
    out: list[Evidence] = []
    for ev in records:
        wire = ev.to_wire() if hasattr(ev, "to_wire") else dict(ev)
        if not wire.get("matched_text"):
            continue
        out.append(Evidence.model_validate(wire))
    return out


class EngineResolver:
    name = "engine"

    def __init__(self, fetcher: Any, *, mode: Literal["fixture", "live"] = "live"):
        self.fetcher = fetcher
        self.mode = mode

    @classmethod
    def live(cls, cache_dir: Path) -> "EngineResolver":
        from rivet_engine.sourcing import PoliteFetcher

        return cls(PoliteFetcher(cache_dir), mode="live")

    @classmethod
    def recorded(cls, directory: Path | None = None) -> "EngineResolver":
        from rivet_engine.sourcing import RecordedFetcher

        return cls(RecordedFetcher(directory or RECORDED_PAGES), mode="fixture")

    def resolve(self, guess: ProductGuess, user_text: str | None) -> ResolverResult:
        from rivet_engine.sourcing import decompose, lookup_all, typical_parts, verify

        identifiers = [i for i in (guess.model_guess, *re.findall(r"\b(?:[A-Z]{3}-\d{4,6}|\d{3,7})\b", user_text or "")) if i]
        fetch_status: Literal["ok", "offline", "blocked"] = "ok"
        product: ProductCandidate | None = None
        product_url: str | None = None
        for ident in dict.fromkeys(identifiers):
            results = lookup_all(ident, self.fetcher)
            if results and all(r.status in ("error", "blocked", "needs_api_key", "unsupported") for r in results):
                fetch_status = "blocked" if any(r.status == "blocked" for r in results) else "offline"
            records = [ev for r in results for ev in r.evidence]
            sku = verify("sku", records)
            if sku.status == "verified" and sku.value and re.sub(r"\D", "", sku.value) == re.sub(r"\D", "", ident):
                name = verify("name", records)
                brand = verify("brand", records)
                product_url = next((r.url for r in results if r.found), None)
                product = ProductCandidate(
                    brand=brand.value or guess.brand or "", name=name.value or ident, sku=sku.value,
                    evidence=_evidence(records),
                )
                fetch_status = "ok"
                break

        parts: list[PartCandidate] = []
        if product and product_url:
            dec = decompose(product_url, self.fetcher)
            for i, p in enumerate(dec.parts):
                records = list(p.name_evidence)
                for claim in (p.sku, p.price, p.purchase_url, p.material):
                    if claim is not None:
                        records += list(claim.evidence)
                parts.append(
                    PartCandidate(
                        part_id=f"part-{i + 1}", name=p.name, sku=p.sku.value if p.sku and p.sku.status == "verified" else None,
                        unavailable_reason=None if p.status == "verified" else (p.reason or "no source publishes this part"),
                        evidence=_evidence(records),
                    )
                )

        typical: list[TypicalPart] = []
        alternatives: list[AlternativeProduct] = []
        if product is None or any(p.sku is None for p in parts):
            for t in typical_parts(guess.category if guess.category in ("rover", "drone", "robot_arm") else "rover", self.fetcher):
                if t.entry is None:
                    typical.append(TypicalPart(name=t.role.replace("_", " "), rationale=t.reason, sku=None))
                    continue
                typical.append(TypicalPart(name=t.entry.name, rationale=t.reason, sku=t.entry.sku, evidence=_evidence(t.sku.evidence if t.sku else [])))
                if product is None and t.sku is not None and t.sku.status == "verified":
                    alternatives.append(AlternativeProduct(brand=t.entry.vendor, name=t.entry.name, sku=t.entry.sku, reason=t.reason, evidence=_evidence(t.sku.evidence)))

        return ResolverResult(fetch_status=fetch_status, product=product, parts=parts, alternatives=alternatives[:3], typical_parts=typical)
