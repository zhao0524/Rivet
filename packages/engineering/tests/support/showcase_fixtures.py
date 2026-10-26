"""Offline inputs for the showcase tests: recorded real pages plus a few SYNTHETIC TEST-ONLY
source pages built in memory to exercise the gate."""

from __future__ import annotations

import json
from functools import cache

from jsonschema import Draft202012Validator

from rivet_engine.ecommerce.providers import MultiRecordedFetcher
from rivet_engine.showcase.models import ManifestEntry
from rivet_engine.sourcing.fetch import FetchResult, sha256_text
from tests import support

RECORDED_SHOWCASE = support.SUPPORT_DIR / "recorded_showcase"
RECORDED = support.SUPPORT_DIR / "recorded"
MANIFEST = support.SUPPORT_DIR / "showcase" / "manifest.json"
SCHEMA_PATH = support.REPO_ROOT / "contracts" / "showcase-product.schema.json"

BIKE_LIGHT = "https://learn.adafruit.com/circuit-playground-bike-light"
ROMI = "https://www.pololu.com/product/3500"
JETBOT = "https://jetbot.org/master/bill_of_materials.html"
REDBOT = "https://learn.sparkfun.com/tutorials/assembly-guide-for-redbot-with-shadow-chassis"
SYNTHETIC_GUIDE = "https://learn.adafruit.com/synthetic-test-only-guide"


@cache
def schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


@cache
def product_validator() -> Draft202012Validator:
    Draft202012Validator.check_schema(schema())
    return Draft202012Validator(schema(), format_checker=Draft202012Validator.FORMAT_CHECKER)


@cache
def index_validator() -> Draft202012Validator:
    doc = {**schema(), "$ref": "#/$defs/ShowcaseIndex"}
    for key in ("type", "properties", "required", "additionalProperties", "title"):
        doc.pop(key, None)
    return Draft202012Validator(doc, format_checker=Draft202012Validator.FORMAT_CHECKER)


def product_errors(doc: dict) -> list[str]:
    wire = json.loads(json.dumps(doc))
    return [f"{e.json_path}: {e.message}" for e in sorted(product_validator().iter_errors(wire), key=lambda e: e.json_path)]


def index_errors(doc: dict) -> list[str]:
    wire = json.loads(json.dumps(doc))
    return [f"{e.json_path}: {e.message}" for e in sorted(index_validator().iter_errors(wire), key=lambda e: e.json_path)]


def manifest_entries() -> dict[str, ManifestEntry]:
    doc = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {c["product_id"]: ManifestEntry.model_validate(c) for c in doc["candidates"]}


def product_card(sku: str, name: str) -> str:
    return (
        f'<li class="small-product-content-card"><div class="product-details">'
        f'<a class="product-title" href="https://www.adafruit.com/product/{sku}">{name}</a>'
        f'<a class="product-buy" data-pid="{sku}" data-qty="1" href="https://www.adafruit.com/product/{sku}">Add to Cart</a>'
        f"</div></li>"
    )


def synthetic_guide(skus: list[tuple[str, str]]) -> str:
    """A SYNTHETIC TEST-ONLY page shaped like an Adafruit Learn guide (never fetched)."""
    cards = "".join(product_card(sku, name) for sku, name in skus)
    return (
        "<html><head><title>SYNTHETIC TEST-ONLY guide</title>"
        '<meta property="og:title" content="SYNTHETIC TEST-ONLY guide" />'
        '<meta property="og:image" content="https://learn.adafruit.com/synthetic-test-only.jpg" />'
        f'</head><body><nav><section><ul>{cards}</ul></section></nav></body></html>'
    )


class OverlayFetcher:
    """Recorded pages, with in-memory SYNTHETIC TEST-ONLY pages (and URL aliases) layered on top."""

    def __init__(self, pages: dict[str, str] | None = None, aliases: dict[str, str] | None = None):
        self.inner = MultiRecordedFetcher((RECORDED_SHOWCASE, RECORDED))
        self.pages = pages or {}
        self.aliases = aliases or {}
        self.fetched: list[str] = []

    def fetch(self, url: str) -> FetchResult:
        self.fetched.append(url)
        if url in self.pages:
            body = self.pages[url]
            return FetchResult(url, 200, body, "2026-10-24T00:00:00Z", sha256_text(body))
        if url in self.aliases:
            real = self.inner.fetch(self.aliases[url])
            return FetchResult(url, real.status, real.body, real.fetched_at, real.content_sha256)
        return self.inner.fetch(url)


__all__ = [
    "BIKE_LIGHT",
    "JETBOT",
    "MANIFEST",
    "OverlayFetcher",
    "RECORDED",
    "RECORDED_SHOWCASE",
    "REDBOT",
    "ROMI",
    "SYNTHETIC_GUIDE",
    "index_errors",
    "manifest_entries",
    "product_errors",
    "synthetic_guide",
]
