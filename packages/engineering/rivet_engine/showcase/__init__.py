"""Showcase catalogue: real, buildable products with verified parts lists
(docs/e-commerce-layer/plan-showcase.md). Offline except `build(..., replay=False)`."""

from rivet_engine.showcase.ingest import ingest
from rivet_engine.showcase.models import (
    Image,
    IndexEntry,
    ManifestEntry,
    Rejection,
    ShowcaseIndex,
    ShowcasePart,
    ShowcaseProduct,
    Source,
    Totals,
    UnsourcedPart,
    to_wire,
)
from rivet_engine.showcase.offers import direct_offers
from rivet_engine.showcase.sources import BomItem, SourceMeta, extract_parts

__all__ = [
    "BomItem",
    "Image",
    "IndexEntry",
    "ManifestEntry",
    "Rejection",
    "ShowcaseIndex",
    "ShowcasePart",
    "ShowcaseProduct",
    "Source",
    "SourceMeta",
    "Totals",
    "UnsourcedPart",
    "build",
    "direct_offers",
    "extract_parts",
    "ingest",
    "to_wire",
]


def build(*args, **kwargs):
    """See `rivet_engine.showcase.build.build`; imported lazily so the models import stays light."""
    from rivet_engine.showcase.build import build as _build

    return _build(*args, **kwargs)
