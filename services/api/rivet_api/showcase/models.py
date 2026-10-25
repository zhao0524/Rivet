"""Pydantic mirror of contracts/showcase-product.schema.json.

A showcase product is a real, buildable product whose maker publishes a parts list, collected
ahead of time (docs/e-commerce-layer/plan-showcase.md). Every constraint here is in the JSON
schema; `synthetic` is pinned to `False` because no showcase product may be synthetic.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from rivet_api.offers.models import Availability, Currency, HttpsUrl, Money, Timestamp, Vendor

Category = Literal["rover", "robot", "drone", "wearable", "iot", "audio", "display", "tool", "other"]
ShowcaseStatus = Literal["complete", "partial"]
HostTier = Literal["manufacturer", "distributor", "teardown", "community"]
PartEvidenceLevel = Literal["verified", "inferred", "stale"]

ProductId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{2,79}$")]
PartId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,79}$")]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Quote = Annotated[str, StringConstraints(min_length=1, max_length=400)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShowcaseImage(_Strict):
    url: HttpsUrl
    credit: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    license: Annotated[str, StringConstraints(min_length=1, max_length=80)]


class ShowcaseSource(_Strict):
    url: HttpsUrl
    host_tier: HostTier
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    fetched_at: Timestamp
    content_sha256: Sha256


class ShowcasePart(_Strict):
    part_id: PartId
    name: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    quantity: Annotated[int, Field(ge=1)]
    sku: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    mpn: Annotated[str, StringConstraints(min_length=1, max_length=64)] | None
    manufacturer: Annotated[str, StringConstraints(min_length=1, max_length=120)] | None
    vendor: Vendor
    url: HttpsUrl
    price_amount: Money | None
    currency: Currency | None
    availability: Availability
    fetched_at: Timestamp
    source_sha256: Sha256
    evidence_level: PartEvidenceLevel
    evidence_quote: Quote
    bom_quote: Quote

    @model_validator(mode="after")
    def _price_needs_currency(self) -> "ShowcasePart":
        if self.price_amount is not None and self.currency is None:
            raise ValueError("price_amount needs a currency")
        return self


class UnsourcedPart(_Strict):
    name: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    quantity: Annotated[int, Field(ge=1)] | None
    note: Annotated[str, StringConstraints(min_length=1, max_length=300)]


class Totals(_Strict):
    parts_total: Annotated[int, Field(ge=0)]
    parts_verified: Annotated[int, Field(ge=0)]
    price_total_amount: Money | None
    currency: Currency | None


class ShowcaseProduct(_Strict):
    schema_version: Literal["1.0"]
    product_id: ProductId
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    category: Category
    summary: Annotated[str, StringConstraints(max_length=600)]
    image: ShowcaseImage
    source: ShowcaseSource
    parts: list[ShowcasePart]
    unsourced_parts: list[UnsourcedPart]
    totals: Totals
    status: ShowcaseStatus
    generated_at: Timestamp
    synthetic: Literal[False]

    def part(self, part_id: str) -> ShowcasePart | None:
        return next((p for p in self.parts if p.part_id == part_id), None)


class IndexEntry(_Strict):
    product_id: ProductId
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    category: Category
    image: ShowcaseImage
    parts_total: Annotated[int, Field(ge=0)]
    parts_verified: Annotated[int, Field(ge=0)]
    status: ShowcaseStatus


class ShowcaseIndex(_Strict):
    schema_version: Literal["1.0"]
    generated_at: Timestamp
    products: list[IndexEntry]
