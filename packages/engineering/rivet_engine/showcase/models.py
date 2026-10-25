"""Showcase wire models mirroring contracts/showcase-product.schema.json (plan-showcase.md 3.1).

A showcase part exists only because a fetched source page names it and a fetched vendor page
quotes its SKU. Unknown price, stock and identifiers are None; `synthetic` is always false.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from rivet_engine.ecommerce.models import Availability, Currency, HttpsUrl, Identifier, Money, Vendor
from rivet_engine.models import SCHEMA_VERSION, UtcTimestamp, WireModel
from rivet_engine.sourcing.evidence import HostTier

Category = Literal["rover", "robot", "drone", "wearable", "iot", "audio", "display", "tool", "other"]
ShowcaseStatus = Literal["complete", "partial"]
PartEvidenceLevel = Literal["verified", "inferred", "stale"]
RejectionReason = Literal["source_unavailable", "no_image", "too_few_parts", "mostly_unsourced", "unverified_part"]

PRODUCT_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{2,79}$")
PART_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Quote = Annotated[str, Field(min_length=1, max_length=400)]
ProductId = Annotated[str, Field(pattern=PRODUCT_ID_PATTERN.pattern)]
Name = Annotated[str, Field(min_length=1, max_length=160)]


class Image(WireModel):
    url: HttpsUrl
    credit: Annotated[str, Field(min_length=1, max_length=200)]
    license: Annotated[str, Field(min_length=1, max_length=80)]


class Source(WireModel):
    url: HttpsUrl
    host_tier: HostTier
    title: Annotated[str, Field(min_length=1, max_length=200)]
    fetched_at: UtcTimestamp
    content_sha256: Sha256


class ShowcasePart(WireModel):
    part_id: Annotated[str, Field(pattern=PART_ID_PATTERN.pattern)]
    name: Annotated[str, Field(min_length=1, max_length=200)]
    quantity: Annotated[StrictInt, Field(ge=1)]
    sku: Identifier
    mpn: Identifier | None
    manufacturer: Annotated[str, Field(min_length=1, max_length=120)] | None
    vendor: Vendor
    url: HttpsUrl
    price_amount: Money | None
    currency: Currency | None
    availability: Availability
    fetched_at: UtcTimestamp
    source_sha256: Sha256
    evidence_level: PartEvidenceLevel
    evidence_quote: Quote
    bom_quote: Quote

    @model_validator(mode="after")
    def _price_needs_currency(self) -> ShowcasePart:
        if self.price_amount is not None and self.currency is None:
            raise ValueError("a price needs a currency")
        return self


class UnsourcedPart(WireModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    quantity: Annotated[StrictInt, Field(ge=1)] | None
    note: Annotated[str, Field(min_length=1, max_length=300)]


class Totals(WireModel):
    parts_total: Annotated[StrictInt, Field(ge=0)]
    parts_verified: Annotated[StrictInt, Field(ge=0)]
    price_total_amount: Money | None
    currency: Currency | None


class ShowcaseProduct(WireModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    product_id: ProductId
    name: Name
    category: Category
    summary: Annotated[str, Field(max_length=600)]
    image: Image
    source: Source
    parts: list[ShowcasePart]
    unsourced_parts: list[UnsourcedPart]
    totals: Totals
    status: ShowcaseStatus
    generated_at: UtcTimestamp
    synthetic: Literal[False] = False

    def index_entry(self) -> IndexEntry:
        return IndexEntry(
            product_id=self.product_id,
            name=self.name,
            category=self.category,
            image=self.image,
            parts_total=self.totals.parts_total,
            parts_verified=self.totals.parts_verified,
            status=self.status,
        )


class IndexEntry(WireModel):
    product_id: ProductId
    name: Name
    category: Category
    image: Image
    parts_total: Annotated[StrictInt, Field(ge=0)]
    parts_verified: Annotated[StrictInt, Field(ge=0)]
    status: ShowcaseStatus


class ShowcaseIndex(WireModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    generated_at: UtcTimestamp
    products: list[IndexEntry]


class ManifestEntry(BaseModel):
    """One curated candidate from `fixtures/showcase/manifest.json`; unknown keys are ignored."""

    model_config = ConfigDict(extra="ignore")

    product_id: ProductId
    name: Name
    category: Category
    source_url: HttpsUrl
    image_url: HttpsUrl | None = None
    notes: str | None = None


class Rejection(WireModel):
    product_id: ProductId
    reason: RejectionReason
    details: Annotated[str, Field(min_length=1, max_length=1000)]


def to_wire(model: WireModel) -> dict[str, Any]:
    return model.to_wire()


__all__ = [
    "Category",
    "Image",
    "IndexEntry",
    "ManifestEntry",
    "PartEvidenceLevel",
    "Rejection",
    "RejectionReason",
    "ShowcaseIndex",
    "ShowcasePart",
    "ShowcaseProduct",
    "ShowcaseStatus",
    "Source",
    "Totals",
    "UnsourcedPart",
    "to_wire",
]
