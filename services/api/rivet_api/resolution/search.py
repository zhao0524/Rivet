"""Web search for the resolver's bridge step (docs/e-commerce-layer/plan-showcase.md 3.4).

A product search provider turns a free-text term into candidate https URLs. Search only ever
proposes pages; `engine_resolver.py` fetches each one and accepts it only when the page itself
quotes a SKU and agrees on the brand. The live implementation wraps the engine's
`BraveSearchProvider` so the key handling and error classes stay in one place.
"""

from __future__ import annotations

import os
from typing import Any, Protocol

BRAVE_API_KEY_ENV = "BRAVE_SEARCH_API_KEY"


class ProductSearchProvider(Protocol):
    name: str

    @property
    def disabled_reason(self) -> str | None:
        """Why `search_pages` must not be called (missing key, offline mode); None when usable."""

    def search_pages(self, term: str) -> list[str]:
        """Candidate https URLs for a free-text term, most relevant first."""


class BraveProductSearch:
    """Free-text search over the engine's Brave client. Disabled, never faked, without the key."""

    name = "brave-search"

    def __init__(self, api_key: str | None = None):
        from rivet_engine.ecommerce.providers import BraveSearchProvider

        self._brave: Any = BraveSearchProvider(api_key if api_key is not None else os.environ.get(BRAVE_API_KEY_ENV))

    @property
    def disabled_reason(self) -> str | None:
        return self._brave.disabled_reason

    def search_pages(self, term: str) -> list[str]:
        return self._brave.search_text(term)
