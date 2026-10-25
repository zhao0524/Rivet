"""In-memory, bounded store of offer sets.

Two indexes: `offer_set_id` for `GET /api/offers/{id}` (kept until evicted) and the query's
`normalized_key` for a short-lived cache so repeated reads of one part do not refetch.
Stored sets are the provider's unfiltered answer; views are computed on read.
"""

import re
import threading
import time
import uuid
from collections import OrderedDict

from rivet_api.errors import ApiError
from rivet_api.offers.models import OfferSet

_ID_RE = re.compile(r"^ofs-[0-9a-f]{12}$")


class OfferSetStore:
    def __init__(self, max_items: int = 500, cache_ttl_s: float = 900.0, clock=time.monotonic):
        self.max_items = max_items
        self.cache_ttl_s = cache_ttl_s
        self._clock = clock
        self._lock = threading.Lock()
        self._by_id: OrderedDict[str, OfferSet] = OrderedDict()
        self._by_key: dict[str, tuple[str, float]] = {}

    @staticmethod
    def new_id() -> str:
        return f"ofs-{uuid.uuid4().hex[:12]}"

    def put(self, offer_set: OfferSet) -> str:
        offer_set_id = self.new_id()
        with self._lock:
            self._by_id[offer_set_id] = offer_set
            self._by_key[offer_set.query.normalized_key] = (offer_set_id, self._clock() + self.cache_ttl_s)
            while len(self._by_id) > self.max_items:
                evicted, _ = self._by_id.popitem(last=False)
                self._by_key = {k: v for k, v in self._by_key.items() if v[0] != evicted}
        return offer_set_id

    def get(self, offer_set_id: str) -> OfferSet:
        with self._lock:
            found = self._by_id.get(offer_set_id) if isinstance(offer_set_id, str) and _ID_RE.match(offer_set_id) else None
        if found is None:
            raise ApiError("OFFER_SET_NOT_FOUND", "No such offer set", 404)
        return found

    def cached(self, normalized_key: str) -> tuple[str, OfferSet] | None:
        with self._lock:
            entry = self._by_key.get(normalized_key)
            if entry is None:
                return None
            offer_set_id, expires = entry
            if expires < self._clock() or offer_set_id not in self._by_id:
                self._by_key.pop(normalized_key, None)
                return None
            return offer_set_id, self._by_id[offer_set_id]
