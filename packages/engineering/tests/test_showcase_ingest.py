"""rivet_engine.showcase.ingest over recorded pages (plan-showcase.md 2 and 3.3): a product is
accepted only when every linked part's vendor page quotes its SKU, at least four parts verify
and no more parts are unsourced than sourced. Offline and deterministic."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from rivet_engine.showcase import Rejection, ShowcaseProduct, ingest
from rivet_engine.showcase.ingest import price_total
from rivet_engine.showcase.models import ManifestEntry
from rivet_engine.showcase.offers import direct_offers
from rivet_engine.sourcing.extract import page_text
from tests.support.showcase_fixtures import (
    RECORDED_SHOWCASE,
    SYNTHETIC_GUIDE,
    OverlayFetcher,
    manifest_entries,
    product_errors,
    synthetic_guide,
)

NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)
FOUR_REAL_CARDS = [("3333", "Circuit Playground Express"), ("3000", "Circuit Playground Classic"),
                   ("727", "3 x AAA Battery Holder"), ("1578", "Lithium Ion Polymer Battery")]


@pytest.fixture(scope="module")
def fetcher() -> OverlayFetcher:
    return OverlayFetcher()


@pytest.fixture(scope="module")
def bike_light(fetcher) -> ShowcaseProduct:
    product = ingest(manifest_entries()["circuit-playground-bike-light"], fetcher)
    assert isinstance(product, ShowcaseProduct), product
    return product


@pytest.fixture(scope="module")
def romi(fetcher) -> ShowcaseProduct:
    product = ingest(manifest_entries()["pololu-romi-chassis-kit"], fetcher)
    assert isinstance(product, ShowcaseProduct), product
    return product


def synthetic_entry(product_id: str = "synthetic-test-only") -> ManifestEntry:
    return ManifestEntry(product_id=product_id, name="SYNTHETIC TEST-ONLY", category="other", source_url=SYNTHETIC_GUIDE)


# ---- accepted products ----------------------------------------------------------------------


def test_adafruit_guide_validates_against_the_contract(bike_light):
    assert product_errors(bike_light.to_wire()) == []
    assert bike_light.synthetic is False and bike_light.status == "complete"
    assert bike_light.totals.parts_total == bike_light.totals.parts_verified == 5


def test_every_part_traces_to_its_recorded_vendor_page(bike_light, romi):
    index = json.loads((RECORDED_SHOWCASE / "index.json").read_text(encoding="utf-8"))
    for product in (bike_light, romi):
        for part in product.parts:
            entry = index[part.url]
            assert part.fetched_at == entry["fetched_at"] and part.source_sha256 == entry["content_sha256"]
            body = (RECORDED_SHOWCASE / entry["file"]).read_text(encoding="utf-8")
            assert part.evidence_quote in body and part.sku in part.evidence_quote
            if part.price_amount is not None:
                assert part.price_amount.rstrip("0").rstrip(".") in body or part.price_amount in body
        source_entry = index[product.source.url]
        assert product.source.content_sha256 == source_entry["content_sha256"]
        assert product.source.fetched_at == source_entry["fetched_at"]


def test_bom_quotes_come_from_the_source_page(bike_light, fetcher):
    text = page_text(fetcher.fetch(bike_light.source.url).body)
    for part in bike_light.parts:
        assert part.bom_quote in text and part.name in part.bom_quote


def test_part_fields_are_read_from_the_vendor_page(bike_light):
    by_sku = {p.sku: p for p in bike_light.parts}
    cable = by_sku["3064"]
    assert cable.part_id == "adafruit-3064" and cable.vendor.id == "adafruit" and cable.vendor.tier == "manufacturer"
    assert cable.availability == "out_of_stock" and cable.currency == "USD" and cable.price_amount is not None
    assert cable.evidence_level == "verified" and cable.url == "https://www.adafruit.com/product/3064"
    assert by_sku["3333"].availability == "in_stock"


def test_pololu_kit_is_complete_with_quantities_and_manufacturer_tier(romi):
    assert product_errors(romi.to_wire()) == []
    assert romi.source.host_tier == "manufacturer" and romi.status == "complete"
    by_sku = {p.sku: p for p in romi.parts}
    assert by_sku["1520"].quantity == 2 and by_sku["3510"].quantity == 1
    assert by_sku["3510"].manufacturer == "Pololu" and by_sku["3510"].vendor.id == "pololu"
    assert romi.image.credit == "Pololu Corporation" and romi.image.url.startswith("https://a.pololu-files.com/")


def test_totals_sum_quantity_times_price_in_one_currency(romi):
    expected = sum(float(p.price_amount) * p.quantity for p in romi.parts)
    assert romi.totals.currency == "USD"
    assert float(romi.totals.price_total_amount) == pytest.approx(expected, abs=0.001)


def test_price_total_is_null_unless_every_part_is_priced(romi):
    unpriced = romi.parts[0].model_copy(update={"price_amount": None, "currency": None})
    assert price_total([unpriced, *romi.parts[1:]]) == (None, None)
    euro = romi.parts[0].model_copy(update={"currency": "EUR"})
    assert price_total([euro, *romi.parts[1:]]) == (None, None)


def test_generated_at_is_the_latest_fetch_so_replay_is_deterministic(bike_light, fetcher):
    stamps = [fetcher.fetch(bike_light.source.url).fetched_at] + [p.fetched_at for p in bike_light.parts]
    assert bike_light.generated_at == max(stamps)
    again = ingest(manifest_entries()["circuit-playground-bike-light"], fetcher)
    assert again.to_wire() == bike_light.to_wire()


def test_parts_older_than_thirty_days_are_marked_stale(fetcher):
    product = ingest(manifest_entries()["circuit-playground-bike-light"], fetcher, now=datetime(2027, 1, 1, tzinfo=timezone.utc))
    assert isinstance(product, ShowcaseProduct)
    assert {p.evidence_level for p in product.parts} == {"stale"}
    assert product_errors(product.to_wire()) == []


def test_manifest_image_override_wins(fetcher):
    entry = manifest_entries()["circuit-playground-bike-light"].model_copy(update={"image_url": "https://example.org/override.jpg"})
    product = ingest(entry, fetcher)
    assert isinstance(product, ShowcaseProduct) and product.image.url == "https://example.org/override.jpg"
    assert product.image.license == "CC BY-SA 3.0"


# ---- the gate ------------------------------------------------------------------------------


def test_mostly_unsourced_bom_is_rejected(fetcher):
    outcome = ingest(manifest_entries()["nvidia-jetbot"], fetcher)
    assert isinstance(outcome, Rejection)
    assert outcome.reason == "mostly_unsourced" and "7 linked" in outcome.details


def test_part_page_returning_404_rejects_the_whole_product():
    fetcher = OverlayFetcher({SYNTHETIC_GUIDE: synthetic_guide(FOUR_REAL_CARDS + [("9999999", "Phantom part")])})
    outcome = ingest(synthetic_entry(), fetcher)
    assert isinstance(outcome, Rejection) and outcome.reason == "unverified_part"
    assert "Phantom part (https://www.adafruit.com/product/9999999): HTTP 404" in outcome.details


def test_part_page_stating_another_sku_rejects_the_whole_product():
    fetcher = OverlayFetcher(
        {SYNTHETIC_GUIDE: synthetic_guide(FOUR_REAL_CARDS + [("4444444", "Mislabelled part")])},
        aliases={"https://www.adafruit.com/product/4444444": "https://www.adafruit.com/product/3333"},
    )
    outcome = ingest(synthetic_entry(), fetcher)
    assert isinstance(outcome, Rejection) and outcome.reason == "unverified_part"
    assert "Mislabelled part" in outcome.details and "4444444" in outcome.details


def test_fewer_than_four_linked_parts_is_rejected_without_fetching_parts():
    fetcher = OverlayFetcher({SYNTHETIC_GUIDE: synthetic_guide(FOUR_REAL_CARDS[:3])})
    outcome = ingest(synthetic_entry(), fetcher)
    assert isinstance(outcome, Rejection) and outcome.reason == "too_few_parts"
    assert fetcher.fetched == [SYNTHETIC_GUIDE]


def test_unrecorded_part_pages_reject_rather_than_guess():
    fetcher = OverlayFetcher({SYNTHETIC_GUIDE: synthetic_guide(FOUR_REAL_CARDS + [("5555555", "Never fetched part")])})
    outcome = ingest(synthetic_entry(), fetcher)
    assert isinstance(outcome, Rejection) and outcome.reason == "unverified_part"
    assert "Never fetched part" in outcome.details and "not recorded" in outcome.details


def test_kit_tutorial_with_more_unlinked_than_linked_rows_is_rejected(fetcher):
    outcome = ingest(manifest_entries()["sparkfun-redbot-shadow-chassis"], fetcher)
    assert isinstance(outcome, Rejection) and outcome.reason == "mostly_unsourced"
    assert outcome.details == "13 parts without a vendor link vs 12 linked"


def test_unreachable_source_page_is_rejected(fetcher):
    entry = synthetic_entry().model_copy(update={"source_url": "https://learn.adafruit.com/never-recorded"})
    outcome = ingest(entry, fetcher)
    assert isinstance(outcome, Rejection) and outcome.reason == "source_unavailable"


def test_source_without_image_is_rejected():
    page = synthetic_guide(FOUR_REAL_CARDS).replace('<meta property="og:image" content="https://learn.adafruit.com/synthetic-test-only.jpg" />', "")
    outcome = ingest(synthetic_entry(), OverlayFetcher({SYNTHETIC_GUIDE: page}))
    assert isinstance(outcome, Rejection) and outcome.reason == "no_image"


# ---- direct offers -------------------------------------------------------------------------


def test_direct_offers_use_the_part_page_and_adapters_only(bike_light, fetcher):
    part = next(p for p in bike_light.parts if p.sku == "3333")
    offer_set = direct_offers(part, fetcher, NOW)
    assert offer_set.query.normalized_key == "3333|||adafruit industries"
    assert offer_set.provider_mode == "live" and offer_set.synthetic is False
    assert offer_set.offers and all(o.vendor.id == "adafruit" and o.sku == "3333" for o in offer_set.offers)
    assert not any(o.vendor.domain.endswith(".example") for o in offer_set.offers + offer_set.possible_matches)
    brave = [e for e in offer_set.ledger if e.source == "brave-search"]
    assert [e.status for e in brave] == ["skipped"] and "no web search" in brave[0].reason
    sources = {e.source for e in offer_set.ledger}
    assert {"sparkfun", "pololu"} <= sources, "URL adapters were consulted"


# ---- review fixes -----------------------------------------------------------------------------


def test_saved_sku_is_the_one_verified_url_first():
    from types import SimpleNamespace

    from rivet_engine.showcase.ingest import claimed_sku

    page = SimpleNamespace(sku="ROB-13302")
    assert claimed_sku("https://www.sparkfun.com/products/13302", page) == "13302"
    assert claimed_sku("https://www.sparkfun.com/hobby-gearmotor-140-rpm-pair.html", page) == "ROB-13302"


@pytest.mark.parametrize("status", [429, 403, 503])
def test_recording_fetcher_does_not_save_error_pages(tmp_path, status):
    from rivet_engine.showcase.build import RecordingFetcher
    from rivet_engine.sourcing.fetch import FetchResult, sha256_text

    class Inner:
        calls = 0

        def fetch(self, url):
            self.calls += 1
            return FetchResult(url, status, "<p>busy</p>", "2026-10-24T00:00:00Z", sha256_text("<p>busy</p>"))

    inner = Inner()
    recording = RecordingFetcher(inner, tmp_path / "recorded")
    url = "https://www.adafruit.com/product/3333"
    assert recording.fetch(url).status == status and recording.fetch(url).status == status
    assert inner.calls == 2 and url not in recording.store.index and recording.recorded == []
    assert recording.failed[0] == (url, f"HTTP {status}")
