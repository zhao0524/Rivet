from pathlib import Path

from rivet_api.config import Settings
from rivet_api.resolution.resolver import ProductResolver
from rivet_api.resolution.stub import StubResolver


def build_resolver(settings: Settings) -> ProductResolver:
    """`stub` (default), `engine` (live, polite network fetcher) or `engine-recorded` (replays recorded pages).

    The engine resolvers need `rivet_engine` installed; a missing engine or a bad value fails at startup.
    """
    provider = settings.resolver_provider
    if provider == "stub":
        return StubResolver()
    if provider in ("engine", "engine-recorded"):
        try:
            from rivet_api.resolution.engine_resolver import EngineResolver
            import rivet_engine.sourcing  # noqa: F401
        except ImportError as exc:
            raise ValueError(f"RIVET_RESOLVER={provider} needs the rivet_engine package installed") from exc
        if provider == "engine":
            return EngineResolver.live(Path(settings.data_root) / "sourcing-cache")
        return EngineResolver.recorded()
    raise ValueError(f"Unknown RIVET_RESOLVER {provider!r} (expected stub, engine or engine-recorded)")
