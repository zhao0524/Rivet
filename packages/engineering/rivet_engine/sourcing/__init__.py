"""Sourcing: evidence records, deterministic verification, polite source adapters and
product decomposition (docs/plan-verified-parts.md). Pure and offline except `PoliteFetcher`."""

from rivet_engine.sourcing.adapters import (
    DEFAULT_ADAPTERS,
    AdafruitAdapter,
    DigiKeyAdapter,
    LookupResult,
    ManufacturerPageAdapter,
    MouserAdapter,
    SparkFunAdapter,
    lookup_all,
)
from rivet_engine.sourcing.decompose import (
    Decomposition,
    Part,
    TypicalPart,
    decompose,
    load_reference_architectures,
    reference_architecture,
    typical_parts,
)
from rivet_engine.sourcing.evidence import (
    HOST_TIERS,
    Claim,
    ClaimStatus,
    Evidence,
    HostTier,
    Verdict,
    tier_for_url,
    verify,
    verify_product,
)
from rivet_engine.sourcing.extract import evidence_from_jsonld, evidence_from_text, included_items, jsonld_products
from rivet_engine.sourcing.fetch import FetchResult, Fetcher, PoliteFetcher, RecordedFetcher, trim_html

__all__ = [
    "AdafruitAdapter", "Claim", "ClaimStatus", "DEFAULT_ADAPTERS", "Decomposition", "DigiKeyAdapter", "Evidence",
    "FetchResult", "Fetcher", "HOST_TIERS", "HostTier", "LookupResult", "ManufacturerPageAdapter", "MouserAdapter",
    "Part", "PoliteFetcher", "RecordedFetcher", "SparkFunAdapter", "TypicalPart", "Verdict", "decompose",
    "evidence_from_jsonld", "evidence_from_text", "included_items", "jsonld_products", "load_reference_architectures",
    "lookup_all", "reference_architecture", "tier_for_url", "trim_html", "typical_parts", "verify", "verify_product",
]
