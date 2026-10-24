"""What the API stores and returns for one resolution."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from rivet_api.agents.product import ProductGuess
from rivet_api.resolution.evidence import Evidence, Support

Outcome = Literal["exact_match", "partial_match", "no_match_with_alternatives", "unsupported"]
ClaimStatus = Literal["verified", "inferred", "conflict", "not_found", "stale", "unavailable"]
TYPICAL_LABEL = "typical_for_category"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LedgerEntry(_Strict):
    """One fetched record and what the gates concluded about it, kept even when rejected."""

    evidence_id: str
    subject: str  # product | part:<id> | alternative:<sku> | typical:<name>
    support: Support
    reason: str
    evidence: Evidence


class ClaimResult(_Strict):
    claim: str
    status: ClaimStatus
    value: str | None = None
    conflicting_values: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    note: str | None = None


class ProductResult(_Strict):
    brand: str
    name: str
    sku: str | None
    status: ClaimStatus
    claims: list[ClaimResult]


class PartResult(_Strict):
    part_id: str
    name: str
    sku: str | None
    status: ClaimStatus
    claims: list[ClaimResult]
    note: str | None = None


class AlternativeResult(_Strict):
    brand: str
    name: str
    sku: str
    reason: str
    status: ClaimStatus
    evidence_ids: list[str]


class TypicalPartResult(_Strict):
    """Never the user's product. Always shown separately, under its own label."""

    label: Literal["typical_for_category"] = TYPICAL_LABEL
    name: str
    rationale: str
    sku: str | None
    evidence_ids: list[str]


class Counts(_Strict):
    parts_total: int = 0
    verified: int = 0
    inferred: int = 0
    not_found: int = 0
    stale: int = 0
    conflict: int = 0
    unavailable: int = 0
    dropped_claims: int = 0


class Provenance(_Strict):
    vision_mode: str
    resolver: str
    resolver_mode: str
    saved_example: bool
    banner: str | None = None


class Resolution(_Strict):
    schema_version: Literal["1.0"] = "1.0"
    resolution_id: str
    created_at: str
    outcome: Outcome
    headline: str
    input: dict
    guess: ProductGuess
    product: ProductResult | None = None
    parts: list[PartResult] = Field(default_factory=list)
    alternatives: list[AlternativeResult] = Field(default_factory=list)
    typical_parts: list[TypicalPartResult] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    counts: Counts = Field(default_factory=Counts)
    unsupported_reason: str | None = None
    ledger: list[LedgerEntry] = Field(default_factory=list)
    provenance: Provenance
