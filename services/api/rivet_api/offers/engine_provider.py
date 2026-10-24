"""`recorded` and `live` offers via `rivet_engine.ecommerce`.

This is the only module that names engine symbols, so a rename on the engine side is a
one-file change here. Engine exceptions become `ApiError`s by class, never by message, so no
provider text reaches a client.
"""

import logging
from typing import Any

from rivet_api.errors import ApiError
from rivet_api.offers.models import InvalidIdentifier, OfferQuery, ProviderMode

log = logging.getLogger("rivet_api")

try:
    from rivet_engine.ecommerce import (
        InvalidIdentifier as EngineInvalidIdentifier,
        ProviderAuth,
        ProviderQuota,
        ProviderUnavailable,
        find_offers,
        normalize_query,
    )

    ENGINE_AVAILABLE = True
except ImportError:
    ENGINE_AVAILABLE = False

    class EngineInvalidIdentifier(ValueError): ...

    class ProviderQuota(Exception): ...

    class ProviderAuth(Exception): ...

    class ProviderUnavailable(Exception): ...

    def find_offers(query: Any, mode: str) -> Any:
        raise ApiError("PROVIDER_UNAVAILABLE", "The offers engine is not installed", 503, retryable=False)

    def normalize_query(**kwargs: Any) -> Any:
        raise ApiError("PROVIDER_UNAVAILABLE", "The offers engine is not installed", 503, retryable=False)


_ERROR_MAP: tuple[tuple[type[Exception], str, str, int, bool], ...] = (
    (ProviderQuota, "PROVIDER_QUOTA", "An offers source rate limit was reached", 429, True),
    (ProviderAuth, "PROVIDER_AUTH", "An offers source rejected the server credentials", 502, False),
    (ProviderUnavailable, "PROVIDER_UNAVAILABLE", "An offers source could not be reached", 503, True),
)


def map_offers_error(exc: Exception) -> ApiError:
    """Engine/provider exception to `ApiError`, keyed on the exception class only."""
    if isinstance(exc, ApiError):
        return exc
    if isinstance(exc, (InvalidIdentifier, EngineInvalidIdentifier)):
        return ApiError("INVALID_IDENTIFIER", str(exc) or "The identifier cannot be searched", 400)
    log.warning("offers provider call failed: %s", type(exc).__name__)
    for cls, code, message, status, retryable in _ERROR_MAP:
        if isinstance(exc, cls):
            return ApiError(code, message, status, retryable=retryable)
    return ApiError("PROVIDER_ERROR", "The offers provider returned an error", 502)


class EngineOffersProvider:
    def __init__(self, mode: ProviderMode):
        if mode not in ("recorded", "live"):
            raise ValueError(f"EngineOffersProvider mode must be recorded or live, got {mode!r}")
        self.mode = mode
        self.name = f"engine-{mode}"

    def find(self, query: OfferQuery) -> Any:
        try:
            engine_query = normalize_query(
                sku=query.sku,
                mpn=query.mpn,
                gtin=query.gtin,
                manufacturer=query.manufacturer,
                catalog_id=query.catalog_id,
            )
            result = find_offers(engine_query, mode=self.mode)
        except Exception as exc:
            raise map_offers_error(exc) from None
        if hasattr(result, "to_wire"):
            return result.to_wire()
        return result.model_dump(mode="json") if hasattr(result, "model_dump") else result
