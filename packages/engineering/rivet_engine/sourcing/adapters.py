"""Source adapters (docs/plan-verified-parts.md 5 steps 2, 3, 5).

Given a SKU or MPN, each adapter returns Evidence records or an explicit outcome
(`not_found`, `blocked`, `error`, `needs_api_key`). Nothing here invents fields: every record
quotes the page or API response it came from.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Literal, Protocol

from rivet_engine.sourcing.evidence import Evidence, HostTier, tier_for_url
from rivet_engine.sourcing.extract import DEFAULT_TTL_DAYS, evidence_from_jsonld, evidence_from_text
from rivet_engine.sourcing.fetch import FetchResult, Fetcher

LookupStatus = Literal["found", "not_found", "blocked", "error", "needs_api_key", "unsupported"]


@dataclass(frozen=True)
class LookupResult:
    adapter: str
    identifier: str
    status: LookupStatus
    url: str | None
    evidence: list[Evidence] = field(default_factory=list)
    reason: str = ""

    @property
    def found(self) -> bool:
        return self.status == "found"


class SourceAdapter(Protocol):
    name: str
    tier: HostTier

    def lookup(self, identifier: str, fetcher: Fetcher) -> LookupResult: ...


def _from_fetch(name: str, identifier: str, result: FetchResult) -> LookupResult | None:
    """Common fetch outcomes; None means the page was fetched and can be read."""
    if result.blocked:
        return LookupResult(name, identifier, "blocked", result.url, reason=result.error or "blocked")
    if result.error:
        return LookupResult(name, identifier, "error", result.url, reason=result.error)
    if result.status == 404:
        return LookupResult(name, identifier, "not_found", result.url, reason="page returned 404")
    if result.status != 200:
        return LookupResult(name, identifier, "error", result.url, reason=f"HTTP {result.status}")
    return None


class _ProductPageAdapter:
    """Vendor whose product pages carry JSON-LD and can be addressed by a numeric SKU."""

    name = "product-page"
    tier: HostTier = "distributor"
    url_template = ""
    sku_pattern = re.compile(r"^\d{1,7}$")

    def product_url(self, identifier: str) -> str | None:
        ident = identifier.strip()
        return self.url_template.format(id=ident) if self.sku_pattern.match(ident) else None

    def lookup(self, identifier: str, fetcher: Fetcher) -> LookupResult:
        url = self.product_url(identifier)
        if url is None:
            return LookupResult(self.name, identifier, "unsupported", None, reason="identifier shape not handled by this adapter")
        result = fetcher.fetch(url)
        early = _from_fetch(self.name, identifier, result)
        if early:
            return early
        evidence = evidence_from_jsonld(result)
        if not any(ev.claim in ("sku", "mpn") for ev in evidence):
            return LookupResult(self.name, identifier, "not_found", url, evidence, reason="page has no product SKU in JSON-LD")
        return LookupResult(self.name, identifier, "found", url, evidence)


class AdafruitAdapter(_ProductPageAdapter):
    name = "adafruit"
    url_template = "https://www.adafruit.com/product/{id}"


class SparkFunAdapter(_ProductPageAdapter):
    name = "sparkfun"
    url_template = "https://www.sparkfun.com/products/{id}"
    sku_pattern = re.compile(r"^(?:[A-Z]{3}-)?(\d{4,6})$")

    def product_url(self, identifier: str) -> str | None:
        m = self.sku_pattern.match(identifier.strip().upper())
        return self.url_template.format(id=m.group(1)) if m else None


class PololuAdapter(_ProductPageAdapter):
    name = "pololu"
    tier: HostTier = "manufacturer"
    url_template = "https://www.pololu.com/product/{id}"


class MouserAdapter:
    """Mouser Search API (keyed). Without `MOUSER_API_KEY` it reports `needs_api_key`."""

    name = "mouser"
    tier: HostTier = "distributor"
    endpoint = "https://api.mouser.com/api/v1/search/partnumber?apiKey={key}"

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key if api_key is not None else os.environ.get("MOUSER_API_KEY")

    def lookup(self, identifier: str, fetcher: Fetcher) -> LookupResult:
        if not self.api_key:
            return LookupResult(self.name, identifier, "needs_api_key", None, reason="MOUSER_API_KEY is not set")
        url = self.endpoint.format(key=self.api_key) + f"&partNumber={identifier}"
        result = fetcher.fetch(url)
        early = _from_fetch(self.name, identifier, result)
        if early:
            return early
        return parse_mouser_response(result, identifier, self.name)


class DigiKeyAdapter:
    """Digi-Key Product Information API (OAuth client credentials). Reports `needs_api_key` without them."""

    name = "digikey"
    tier: HostTier = "distributor"
    endpoint = "https://api.digikey.com/products/v4/search/{mpn}/productdetails"

    def __init__(self, client_id: str | None = None, client_secret: str | None = None):
        self.client_id = client_id if client_id is not None else os.environ.get("DIGIKEY_CLIENT_ID")
        self.client_secret = client_secret if client_secret is not None else os.environ.get("DIGIKEY_CLIENT_SECRET")

    def lookup(self, identifier: str, fetcher: Fetcher) -> LookupResult:
        if not (self.client_id and self.client_secret):
            return LookupResult(self.name, identifier, "needs_api_key", None, reason="DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET are not set")
        # The OAuth token exchange needs a POST, which the polite GET fetcher does not do on purpose;
        # a keyed deployment wires its own fetcher. Recorded responses still exercise the parser.
        result = fetcher.fetch(self.endpoint.format(mpn=identifier))
        early = _from_fetch(self.name, identifier, result)
        if early:
            return early
        return parse_digikey_response(result, identifier, self.name)


def _json_evidence(result: FetchResult, claim: str, value: object, key: str) -> Evidence | None:
    if value in (None, ""):
        return None
    text = str(value)
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*"?' + re.escape(text) + r'"?', result.body)
    if not m:
        return None
    return Evidence(
        claim=claim,  # type: ignore[arg-type]
        value=text,
        source_url=result.url.split("?apiKey=")[0],
        source_host_tier="distributor",
        fetched_at=result.fetched_at,
        content_sha256=result.content_sha256,
        extractor="jsonld",
        matched_text=m.group(0),
        ttl_days=DEFAULT_TTL_DAYS,
    )


def parse_mouser_response(result: FetchResult, identifier: str, name: str = "mouser") -> LookupResult:
    try:
        data = json.loads(result.body)
    except json.JSONDecodeError:
        return LookupResult(name, identifier, "error", result.url, reason="response is not JSON")
    parts = (data.get("SearchResults") or {}).get("Parts") or []
    match = next((p for p in parts if str(p.get("ManufacturerPartNumber", "")).casefold() == identifier.casefold()), None)
    if match is None:
        return LookupResult(name, identifier, "not_found", result.url, reason="no part with that manufacturer part number")
    price = ((match.get("PriceBreaks") or [{}])[0]).get("Price")
    evidence = [
        ev
        for ev in (
            _json_evidence(result, "mpn", match.get("ManufacturerPartNumber"), "ManufacturerPartNumber"),
            _json_evidence(result, "sku", match.get("MouserPartNumber"), "MouserPartNumber"),
            _json_evidence(result, "brand", match.get("Manufacturer"), "Manufacturer"),
            _json_evidence(result, "name", match.get("Description"), "Description"),
            _json_evidence(result, "price", price, "Price"),
            _json_evidence(result, "availability", match.get("Availability"), "Availability"),
            _json_evidence(result, "purchase_url", match.get("ProductDetailUrl"), "ProductDetailUrl"),
            _json_evidence(result, "datasheet_url", match.get("DataSheetUrl"), "DataSheetUrl"),
        )
        if ev is not None
    ]
    return LookupResult(name, identifier, "found", result.url.split("?apiKey=")[0], evidence)


def parse_digikey_response(result: FetchResult, identifier: str, name: str = "digikey") -> LookupResult:
    try:
        data = json.loads(result.body)
    except json.JSONDecodeError:
        return LookupResult(name, identifier, "error", result.url, reason="response is not JSON")
    product = data.get("Product") or {}
    mpn = product.get("ManufacturerProductNumber")
    if not mpn or str(mpn).casefold() != identifier.casefold():
        return LookupResult(name, identifier, "not_found", result.url, reason="no product with that manufacturer part number")
    variation = (product.get("ProductVariations") or [{}])[0]
    evidence = [
        ev
        for ev in (
            _json_evidence(result, "mpn", mpn, "ManufacturerProductNumber"),
            _json_evidence(result, "sku", variation.get("DigiKeyProductNumber"), "DigiKeyProductNumber"),
            _json_evidence(result, "brand", (product.get("Manufacturer") or {}).get("Name"), "Name"),
            _json_evidence(result, "name", (product.get("Description") or {}).get("ProductDescription"), "ProductDescription"),
            _json_evidence(result, "price", product.get("UnitPrice"), "UnitPrice"),
            _json_evidence(result, "purchase_url", product.get("ProductUrl"), "ProductUrl"),
            _json_evidence(result, "datasheet_url", product.get("DatasheetUrl"), "DatasheetUrl"),
        )
        if ev is not None
    ]
    return LookupResult(name, identifier, "found", result.url, evidence)


class ManufacturerPageAdapter:
    """A known product URL on an allowlisted manufacturer (or distributor) host.

    Reads JSON-LD when present and otherwise quotes the visible text that states the identifier.
    """

    name = "manufacturer-page"

    def __init__(self, url: str):
        self.url = url
        self.tier: HostTier = tier_for_url(url) or "community"

    def lookup(self, identifier: str, fetcher: Fetcher) -> LookupResult:
        if tier_for_url(self.url) is None:
            return LookupResult(self.name, identifier, "blocked", self.url, reason="host is not on the allowlist")
        result = fetcher.fetch(self.url)
        early = _from_fetch(self.name, identifier, result)
        if early:
            return early
        evidence = evidence_from_jsonld(result)
        if not any(ev.claim in ("sku", "mpn") and ev.value.casefold() == identifier.casefold() for ev in evidence):
            quoted = evidence_from_text(result, "mpn", identifier)
            if quoted is None:
                return LookupResult(self.name, identifier, "not_found", self.url, evidence, reason="page does not mention the identifier")
            evidence.append(quoted)
        return LookupResult(self.name, identifier, "found", self.url, evidence)


DEFAULT_ADAPTERS: tuple[SourceAdapter, ...] = (AdafruitAdapter(), SparkFunAdapter(), PololuAdapter(), MouserAdapter(), DigiKeyAdapter())


def lookup_all(identifier: str, fetcher: Fetcher, adapters: tuple[SourceAdapter, ...] | list[SourceAdapter] = DEFAULT_ADAPTERS) -> list[LookupResult]:
    """Ask every adapter; the caller verifies the collected evidence. Order is deterministic."""
    return [adapter.lookup(identifier, fetcher) for adapter in adapters]


__all__ = [
    "AdafruitAdapter",
    "DEFAULT_ADAPTERS",
    "DigiKeyAdapter",
    "LookupResult",
    "LookupStatus",
    "ManufacturerPageAdapter",
    "MouserAdapter",
    "PololuAdapter",
    "SourceAdapter",
    "SparkFunAdapter",
    "lookup_all",
    "parse_digikey_response",
    "parse_mouser_response",
]
