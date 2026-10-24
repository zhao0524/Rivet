from rivet_api.config import Settings
from rivet_api.resolution.resolver import ProductResolver
from rivet_api.resolution.stub import StubResolver


def build_resolver(settings: Settings) -> ProductResolver:
    """Only the stub exists until lane B's resolver lands. A bad value fails at startup."""
    if settings.resolver_provider == "stub":
        return StubResolver()
    raise ValueError(f"Unknown RIVET_RESOLVER {settings.resolver_provider!r} (expected stub)")
