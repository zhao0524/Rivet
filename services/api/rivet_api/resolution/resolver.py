"""The resolver interface this API codes against.

Lane B owns the real resolver (search, source adapters, decomposition, fallback ranking).
Until it lands, `StubResolver` (stub.py) returns the same shapes deterministically. A
resolver proposes candidates with `Evidence`; it never decides an outcome. `gates.py` does,
and it re-checks every record, so a resolver cannot make a claim `verified` by saying so.
"""

from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from rivet_api.agents.product import ProductGuess
from rivet_api.resolution.evidence import Evidence

FetchStatus = Literal["ok", "offline", "blocked"]
ResolverMode = Literal["fixture", "live"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProductCandidate(_Strict):
    brand: str
    name: str
    sku: str
    evidence: list[Evidence] = Field(default_factory=list)


class PartCandidate(_Strict):
    part_id: str
    name: str
    sku: str | None = None
    # Set only when a source states the part is not sold or not published; shown as
    # "unavailable". It never stands in for a missing SKU claim.
    unavailable_reason: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)


class AlternativeProduct(_Strict):
    brand: str
    name: str
    sku: str
    reason: str
    evidence: list[Evidence] = Field(default_factory=list)


class TypicalPart(_Strict):
    name: str
    rationale: str  # for example "3 of 4 comparable drones use a brushless motor in this size range"
    sku: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)


class ResolverResult(_Strict):
    fetch_status: FetchStatus = "ok"
    product: ProductCandidate | None = None
    parts: list[PartCandidate] = Field(default_factory=list)
    alternatives: list[AlternativeProduct] = Field(default_factory=list)
    typical_parts: list[TypicalPart] = Field(default_factory=list)


class ProductResolver(Protocol):
    name: str
    mode: ResolverMode  # "fixture" for stubs and recorded data, "live" only for real fetching

    def resolve(self, guess: ProductGuess, user_text: str | None) -> ResolverResult: ...
