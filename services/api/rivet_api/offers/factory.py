from rivet_api.config import Settings
from rivet_api.offers.provider import OffersProvider
from rivet_api.offers.stub import StubOffersProvider


def build_offers_provider(settings: Settings) -> OffersProvider:
    """`stub` (default, canned fixtures), `recorded` (engine replays saved pages) or `live`.

    The engine providers need `rivet_engine.ecommerce`; a missing engine or a bad value fails at startup.
    """
    provider = settings.offers_provider
    if provider == "stub":
        return StubOffersProvider()
    if provider in ("recorded", "live"):
        from rivet_api.offers.engine_provider import ENGINE_AVAILABLE, EngineOffersProvider

        if not ENGINE_AVAILABLE:
            raise ValueError(f"RIVET_OFFERS_PROVIDER={provider} needs the rivet_engine package with rivet_engine.ecommerce")
        return EngineOffersProvider(provider)
    raise ValueError(f"Unknown RIVET_OFFERS_PROVIDER {provider!r} (expected stub, recorded or live)")
