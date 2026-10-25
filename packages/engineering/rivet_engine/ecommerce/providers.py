"""Offer providers: stub fixtures, recorded replay and the live search layer (plan 3.2 steps 2, 3).

Three modes, chosen by the caller (`RIVET_OFFERS_PROVIDER` in the API):

- `stub`: canned `fixtures/offers/*.json`, keyed by the query's normalised key. Never a lookup.
- `recorded`: `RecordedFetcher` replay over saved pages; search is a lookup of the recorded
  index, so CI is offline and deterministic.
- `live`: `PoliteFetcher` plus Brave web search behind `BRAVE_SEARCH_API_KEY`.

Structured vendor APIs that need a key report `needs_api_key` when it is missing. Nothing in
this module fabricates a result: a provider either answers from a real source or says why not.
"""

from __future__ import annotations

import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from rivet_engine.ecommerce.models import LedgerEntry, OfferQuery, OfferSet
from rivet_engine.sourcing.adapters import DEFAULT_ADAPTERS, LookupResult, SourceAdapter
from rivet_engine.sourcing.fetch import USER_AGENT, FetchResult, Fetcher, PoliteFetcher, RecordedFetcher

PACKAGE_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = PACKAGE_DIR.parents[1]
FIXTURES_DIR = REPO_ROOT / "fixtures" / "offers"
RECORDED_DIRS: tuple[Path, ...] = (
    PACKAGE_DIR / "tests" / "support" / "recorded",
    PACKAGE_DIR / "tests" / "support" / "recorded_offers",
)
BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"
BRAVE_RESULT_COUNT = 20

# Ledger source names for the structured APIs, matching fixtures/offers/*.json.
ADAPTER_SOURCE_NAMES = {"adafruit": "adafruit", "sparkfun": "sparkfun", "mouser": "mouser-api", "digikey": "digikey-api"}
KEYED_API_ENV = {"octopart-api": "NEXAR_CLIENT_ID", "element14-api": "ELEMENT14_API_KEY"}


class OffersProviderError(Exception):
    """A live provider failed; the API maps subclasses to PROVIDER_* error codes."""

    code = "PROVIDER_UNAVAILABLE"

    def __init__(self, provider: str, message: str):
        super().__init__(f"{provider}: {message}")
        self.provider = provider
        self.message = message


class ProviderQuota(OffersProviderError):
    code = "PROVIDER_QUOTA"


class ProviderAuth(OffersProviderError):
    code = "PROVIDER_AUTH"


class ProviderUnavailable(OffersProviderError):
    code = "PROVIDER_UNAVAILABLE"


class SearchProvider(Protocol):
    name: str

    @property
    def disabled_reason(self) -> str | None:
        """Why `search` must not be called (missing key, offline mode); None when usable."""

    def search(self, query: OfferQuery) -> list[str]:
        """Candidate https URLs for the query, most relevant first. Raises OffersProviderError."""


class StructuredApiProvider(Protocol):
    name: str

    def lookup(self, query: OfferQuery, fetcher: Fetcher) -> list[LookupResult]: ...


def search_terms(query: OfferQuery) -> list[str]:
    """Search strings in priority order: SKU, MPN, GTIN, each with the manufacturer when known."""
    terms: list[str] = []
    for ident in (query.sku, query.mpn, query.gtin):
        if not ident:
            continue
        if query.manufacturer:
            terms.append(f'"{ident}" {query.manufacturer} buy')
        terms.append(f'"{ident}" buy')
    out: list[str] = []
    for term in terms:
        if term not in out:
            out.append(term)
    return out


def _https_only(urls: Sequence[str]) -> list[str]:
    out: list[str] = []
    for url in urls:
        if isinstance(url, str) and url.startswith("https://") and url not in out:
            out.append(url)
    return out


class BraveSearchProvider:
    """Brave Web Search API. Without `BRAVE_SEARCH_API_KEY` it is disabled, never faked."""

    name = "brave-search"

    def __init__(self, api_key: str | None = None, *, timeout_s: float = 10.0, user_agent: str = USER_AGENT):
        self.api_key = api_key if api_key is not None else os.environ.get("BRAVE_SEARCH_API_KEY")
        self.timeout_s = timeout_s
        self.user_agent = user_agent

    @property
    def disabled_reason(self) -> str | None:
        return None if self.api_key else "BRAVE_SEARCH_API_KEY not set"

    def _request(self, term: str) -> dict:
        params = urllib.parse.urlencode({"q": term, "count": BRAVE_RESULT_COUNT, "safesearch": "off"})
        req = urllib.request.Request(
            f"{BRAVE_ENDPOINT}?{params}",
            headers={"Accept": "application/json", "X-Subscription-Token": self.api_key or "", "User-Agent": self.user_agent},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                return json.loads(resp.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise ProviderAuth(self.name, f"HTTP {exc.code}") from exc
            if exc.code == 429:
                raise ProviderQuota(self.name, "HTTP 429 rate limited") from exc
            raise ProviderUnavailable(self.name, f"HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise ProviderUnavailable(self.name, str(exc)) from exc

    def search(self, query: OfferQuery) -> list[str]:
        if self.disabled_reason:
            raise ProviderAuth(self.name, self.disabled_reason)
        urls: list[str] = []
        for term in search_terms(query):
            data = self._request(term)
            results = ((data.get("web") or {}).get("results")) or []
            urls.extend(r.get("url") for r in results if isinstance(r, dict))
        return _https_only(urls)


class DisabledSearchProvider:
    """Stands in for web search when a mode never searches (stub, recorded)."""

    name = "brave-search"

    def __init__(self, reason: str):
        self.reason = reason

    @property
    def disabled_reason(self) -> str | None:
        return self.reason

    def search(self, query: OfferQuery) -> list[str]:
        raise ProviderUnavailable(self.name, self.reason)


class RecordedSearchProvider:
    """Web search replayed from recorded indexes: an entry lists the lowercase identifiers it would
    have been returned for under `queries`. Only pages saved on disk can ever be candidates."""

    name = "recorded-search"

    def __init__(self, indexes: Sequence[dict[str, dict]]):
        self.indexes = indexes

    @property
    def disabled_reason(self) -> str | None:
        return None

    def search(self, query: OfferQuery) -> list[str]:
        wanted = {value.casefold() for value in (query.sku, query.mpn, query.gtin) if value}
        urls: list[str] = []
        for index in self.indexes:
            for url, entry in index.items():
                recorded_for = {str(q).casefold() for q in entry.get("queries", [])}
                if wanted & recorded_for and url not in urls:
                    urls.append(url)
        return _https_only(sorted(urls, key=lambda u: (self._position(u), u)))

    def _position(self, url: str) -> int:
        for index in self.indexes:
            entry = index.get(url)
            if entry is not None:
                return int(entry.get("rank", 0))
        return 0


class MultiRecordedFetcher:
    """Several recorded directories behind one `Fetcher`; the first index that knows a URL answers."""

    def __init__(self, directories: Sequence[Path | str] = RECORDED_DIRS):
        self.fetchers = [RecordedFetcher(directory) for directory in directories if Path(directory).exists()]

    @property
    def indexes(self) -> list[dict[str, dict]]:
        return [fetcher.index for fetcher in self.fetchers]

    def fetch(self, url: str) -> FetchResult:
        for fetcher in self.fetchers:
            if url in fetcher.index:
                return fetcher.fetch(url)
        return FetchResult.failure(url, "not recorded (offline)")


class AdapterProvider:
    """The sourcing adapters (Adafruit, SparkFun, Mouser, Digi-Key) asked for each identifier."""

    name = "adapters"

    def __init__(self, adapters: Sequence[SourceAdapter] = DEFAULT_ADAPTERS):
        self.adapters = tuple(adapters)

    def lookup(self, query: OfferQuery, fetcher: Fetcher) -> list[LookupResult]:
        identifiers = [value for value in (query.sku, query.mpn) if value]
        results: list[LookupResult] = []
        for adapter in self.adapters:
            produced: list[LookupResult] = []
            for identifier in identifiers:
                result = adapter.lookup(identifier, fetcher)
                if any(p.url == result.url and p.status == result.status for p in produced):
                    continue
                produced.append(result)
            results.extend(produced)
        return results


class KeyedApiProvider:
    """Octopart/Nexar and element14: no client is implemented yet, so with or without a key the
    ledger says so honestly instead of returning anything."""

    def __init__(self, name: str, env_var: str):
        self.name = name
        self.env_var = env_var

    def lookup(self, query: OfferQuery, fetcher: Fetcher) -> list[LookupResult]:
        identifier = query.sku or query.mpn or query.gtin or ""
        if not os.environ.get(self.env_var):
            return [LookupResult(self.name, identifier, "needs_api_key", None, reason=f"{self.env_var} not set")]
        return [LookupResult(self.name, identifier, "unsupported", None, reason=f"{self.name} client not implemented; key present but unused")]


def default_structured_providers() -> list[StructuredApiProvider]:
    return [AdapterProvider()] + [KeyedApiProvider(name, env) for name, env in KEYED_API_ENV.items()]


def ledger_source(result: LookupResult) -> str:
    return ADAPTER_SOURCE_NAMES.get(result.adapter, result.adapter)


@dataclass
class StubOffersProvider:
    """Canned OfferSets from `fixtures/offers/*.json`, keyed by `query.normalized_key`."""

    fixtures_dir: Path = FIXTURES_DIR
    _sets: dict[str, OfferSet] = field(default_factory=dict, init=False)
    _loaded: bool = field(default=False, init=False)

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self.fixtures_dir.exists():
            return
        for path in sorted(self.fixtures_dir.glob("*.json")):
            offer_set = OfferSet.model_validate(json.loads(path.read_text(encoding="utf-8")))
            self._sets.setdefault(offer_set.query.normalized_key, offer_set)
            if offer_set.query.catalog_id:
                self._sets.setdefault(f"catalog:{offer_set.query.catalog_id}", offer_set)

    def find(self, query: OfferQuery) -> OfferSet | None:
        self._load()
        found = self._sets.get(query.normalized_key)
        if found is None and query.catalog_id:
            found = self._sets.get(f"catalog:{query.catalog_id}")
        return found.model_copy(deep=True) if found else None

    @property
    def keys(self) -> list[str]:
        self._load()
        return sorted(k for k in self._sets if not k.startswith("catalog:"))


def default_fetcher(mode: str) -> Fetcher:
    if mode == "recorded":
        override = os.environ.get("RIVET_RECORDED_DIR")
        return MultiRecordedFetcher((override,) if override else RECORDED_DIRS)
    if mode == "live":
        return PoliteFetcher(Path(tempfile.gettempdir()) / "rivet-offers-cache")
    raise ValueError(f"no fetcher for mode {mode!r}")


def needs_api_key_entry(source: str, env_var: str) -> LedgerEntry:
    return LedgerEntry(source=source, url=None, status="needs_api_key", reason=f"{env_var} not set", checked_at=None)


__all__ = [
    "ADAPTER_SOURCE_NAMES",
    "AdapterProvider",
    "BraveSearchProvider",
    "DisabledSearchProvider",
    "FIXTURES_DIR",
    "KEYED_API_ENV",
    "KeyedApiProvider",
    "MultiRecordedFetcher",
    "OffersProviderError",
    "ProviderAuth",
    "ProviderQuota",
    "ProviderUnavailable",
    "RECORDED_DIRS",
    "RecordedSearchProvider",
    "SearchProvider",
    "StructuredApiProvider",
    "StubOffersProvider",
    "default_fetcher",
    "default_structured_providers",
    "ledger_source",
    "needs_api_key_entry",
    "search_terms",
]
