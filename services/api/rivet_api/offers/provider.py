"""The offers provider interface this API codes against.

A provider answers one normalised query with an `OfferSet` (or a dict in that shape, which the
service validates). It does not rank or filter for the API: `ranking.py` does that, so the
routes behave the same whichever provider is configured.
"""

from typing import Any, Protocol

from rivet_api.offers.models import OfferQuery, OfferSet, ProviderMode


class OffersProvider(Protocol):
    name: str
    mode: ProviderMode

    def find(self, query: OfferQuery) -> OfferSet | dict[str, Any]: ...
