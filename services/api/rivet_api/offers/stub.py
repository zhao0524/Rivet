"""Canned offers from the packaged fixture mirror (`rivet_api/data/fixtures/offers/`).

Never a live lookup: every set it serves says `provider_mode: "stub"` and carries a notice,
and an identifier it has no fixture for comes back `not_found` with an empty ledger entry
saying no search was made.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from rivet_api.offers.models import LedgerEntry, OfferQuery, OfferSet

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "offers"
STUB_NOTICE = "Stub offers provider: canned fixture data, not a live lookup. Prices and stock were not checked."
STUB_MISS_NOTICE = "Stub offers provider: no canned fixture for this identifier and no live lookup was made."


class StubOffersProvider:
    name = "stub"
    mode = "stub"

    def __init__(self, fixture_dir: Path = FIXTURE_DIR):
        self.by_key: dict[str, OfferSet] = {}
        self.by_sku: dict[str, list[OfferSet]] = {}
        for path in sorted(fixture_dir.glob("*.json")):
            offer_set = OfferSet.model_validate(json.loads(path.read_text()))
            self.by_key[offer_set.query.normalized_key] = offer_set
            if offer_set.query.sku:
                self.by_sku.setdefault(offer_set.query.sku.lower(), []).append(offer_set)

    def _lookup(self, query: OfferQuery) -> OfferSet | None:
        hit = self.by_key.get(query.normalized_key)
        if hit is None and query.sku and query.mpn is None and query.gtin is None:
            candidates = self.by_sku.get(" ".join(query.sku.split()).lower(), [])
            hit = candidates[0] if len(candidates) == 1 else None
        return hit

    def find(self, query: OfferQuery) -> OfferSet:
        hit = self._lookup(query)
        if hit is None:
            return self.not_found(query)
        notices = [STUB_NOTICE, *[n for n in hit.notices if n != STUB_NOTICE]]
        return hit.model_copy(update={"query": query, "provider_mode": self.mode, "notices": notices})

    def not_found(self, query: OfferQuery) -> OfferSet:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return OfferSet(
            schema_version="1.0",
            query=query,
            outcome="not_found",
            provider_mode=self.mode,
            synthetic=False,
            generated_at=now,
            offers=[],
            possible_matches=[],
            alternatives=[],
            ledger=[
                LedgerEntry(
                    source="stub",
                    url=None,
                    status="skipped",
                    reason="The stub provider has no fixture for this identifier and does not search the web.",
                    checked_at=None,
                )
            ],
            notices=[STUB_MISS_NOTICE],
        )
