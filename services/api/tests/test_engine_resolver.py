"""Lane B's engine behind the API resolver protocol (skipped without rivet_engine)."""

import pytest

from rivet_api.agents.product import ProductGuess
from rivet_api.config import Settings
from rivet_api.resolution.factory import build_resolver

sourcing = pytest.importorskip("rivet_engine.sourcing")


def guess(model, category="rover"):
    return ProductGuess(brand="Adafruit", model_guess=model, category=category, confidence="high", verdict="supported")


@pytest.fixture
def resolver():
    from rivet_api.resolution.engine_resolver import EngineResolver

    return EngineResolver.recorded()


def test_recorded_mode_is_never_live(resolver):
    assert resolver.mode == "fixture" and resolver.name == "engine"


def test_exact_partial_and_no_match_from_recorded_pages(resolver):
    exact = resolver.resolve(guess("3801"), None)
    assert exact.product.sku == "3801" and [p.sku for p in exact.parts] == ["3801"]
    assert all(ev.matched_text for ev in exact.product.evidence)
    partial = resolver.resolve(guess("KIT-21301"), None)
    assert partial.product.sku == "KIT-21301" and sum(1 for p in partial.parts if p.sku) == 22
    assert sum(1 for p in partial.parts if p.unavailable_reason) == 1 and partial.typical_parts
    none = resolver.resolve(guess("9999999"), None)
    assert none.product is None and none.parts == [] and none.alternatives and none.typical_parts


def test_offline_pages_report_offline(tmp_path):
    from rivet_api.resolution.engine_resolver import EngineResolver

    r = EngineResolver(sourcing.RecordedFetcher(tmp_path), mode="fixture")
    assert r.resolve(guess("3801"), None).fetch_status == "offline"


def test_factory_builds_engine_resolvers(tmp_path):
    assert build_resolver(Settings(mode="fixture", data_root=tmp_path, resolver_provider="engine-recorded")).mode == "fixture"
    assert build_resolver(Settings(mode="live", data_root=tmp_path, resolver_provider="engine")).mode == "live"
    with pytest.raises(ValueError):
        build_resolver(Settings(mode="fixture", data_root=tmp_path, resolver_provider="nope"))
