"""rivet_engine.sourcing: evidence verifier (#81), adapters (#82), decomposition and fallbacks (#83).

Everything runs offline against recorded pages in tests/support/recorded (see index.json).
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from rivet_engine.sourcing import (
    AdafruitAdapter,
    DigiKeyAdapter,
    Evidence,
    FetchResult,
    ManufacturerPageAdapter,
    MouserAdapter,
    PoliteFetcher,
    RecordedFetcher,
    SparkFunAdapter,
    decompose,
    evidence_from_jsonld,
    included_items,
    load_reference_architectures,
    lookup_all,
    tier_for_url,
    trim_html,
    typical_parts,
    verify,
    verify_product,
)
from rivet_engine.sourcing.adapters import parse_digikey_response, parse_mouser_response

RECORDED = Path(__file__).parent / "support" / "recorded"
NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)
SHA = hashlib.sha256(b"page").hexdigest()


def ev(claim="sku", value="DJI-MINI4-FMC", url="https://www.dji.com/mini-4", tier="manufacturer", *,
       matched="SKU: DJI-MINI4-FMC", extractor="jsonld", fetched="2026-10-24T18:00:00Z", ttl=14) -> Evidence:
    return Evidence(claim=claim, value=value, source_url=url, source_host_tier=tier, fetched_at=fetched,
                    content_sha256=SHA, extractor=extractor, matched_text=matched, ttl_days=ttl)


@pytest.fixture(scope="module")
def recorded() -> RecordedFetcher:
    return RecordedFetcher(RECORDED)


# ---- #81 evidence schema and verifier -------------------------------------------------


class TestEvidenceSchema:
    def test_plan_5_1_example_round_trips(self):
        record = ev()
        assert json.loads(json.dumps(record.to_wire()))["source_host_tier"] == "manufacturer"
        assert set(record.to_wire()) == {"claim", "value", "source_url", "source_host_tier", "fetched_at",
                                         "content_sha256", "extractor", "matched_text", "ttl_days"}

    @pytest.mark.parametrize("bad", [
        {"claim": "colour"}, {"source_host_tier": "blog"}, {"extractor": "guess"}, {"ttl_days": 0},
        {"content_sha256": "abc"}, {"fetched_at": "2026-10-24 18:00"}, {"value": ""},
    ])
    def test_rejects_unknown_or_malformed_fields(self, bad):
        with pytest.raises(ValidationError):
            Evidence(**{**ev().model_dump(), **bad})

    def test_rejects_extra_keys(self):
        with pytest.raises(ValidationError):
            Evidence(**{**ev().model_dump(), "confidence": 0.9})


class TestTiers:
    @pytest.mark.parametrize("url,tier", [
        ("https://www.adafruit.com/product/3801", "distributor"),
        ("https://store.dji.com/mini", "manufacturer"),
        ("https://www.ifixit.com/Teardown/x", "teardown"),
        ("https://www.reddit.com/r/drones", "community"),
        ("https://evil.example/adafruit.com", None),
        ("https://adafruit.com.evil.example/", None),
        ("http://www.adafruit.com/product/3801", None),
    ])
    def test_allowlist_is_a_suffix_match_on_https_hosts(self, url, tier):
        assert tier_for_url(url) == tier


class TestVerifier:
    def test_verified_needs_manufacturer_or_distributor_and_matching_text(self):
        v = verify("sku", [ev()], now=NOW)
        assert v.status == "verified" and v.value == "DJI-MINI4-FMC" and v.evidence == [ev()]

    def test_llm_extract_alone_never_verifies(self):
        v = verify("sku", [ev(extractor="llm-extract")], now=NOW)
        assert v.status == "inferred"

    def test_teardown_tier_is_inferred_only(self):
        v = verify("sku", [ev(url="https://www.ifixit.com/Teardown/mini4", tier="teardown")], now=NOW)
        assert v.status == "inferred"

    def test_community_tier_cannot_support_a_claim(self):
        v = verify("sku", [ev(url="https://www.reddit.com/r/x", tier="community")], now=NOW)
        assert v.status == "not_found"

    def test_fake_sku_fails_when_no_page_quotes_it(self):
        # The page says a different SKU than the one claimed: the fabricated value never verifies.
        v = verify("sku", [ev(matched="SKU: DJI-MINI4-FMC")], now=NOW, expected_value="DJI-MINI9-FAKE")
        assert v.status == "not_found" and "not 'DJI-MINI9-FAKE'" in v.reason

    def test_page_200_without_the_sku_is_not_found(self):
        v = verify("sku", [ev(matched="Welcome to our store")], now=NOW)
        assert v.status == "not_found" and "does not contain the value" in v.reason

    def test_declared_tier_must_match_the_host(self):
        spoofed = ev(url="https://www.reddit.com/r/x", tier="manufacturer")
        assert verify("sku", [spoofed], now=NOW).status == "not_found"

    def test_non_allowlisted_host_is_ignored(self):
        assert verify("sku", [ev(url="https://shop.invented/p/1")], now=NOW).status == "not_found"

    def test_expired_evidence_is_stale(self):
        old = ev(fetched="2026-01-01T00:00:00Z", ttl=14)
        v = verify("sku", [old], now=NOW)
        assert v.status == "stale" and v.value == "DJI-MINI4-FMC"

    def test_fresh_evidence_beats_stale(self):
        assert verify("sku", [ev(fetched="2026-01-01T00:00:00Z"), ev()], now=NOW).status == "verified"

    def test_disagreeing_sources_are_a_conflict_never_averaged(self):
        a = ev("price", "24.95", matched='"price": "24.95"')
        b = ev("price", "29.95", url="https://www.adafruit.com/product/1", tier="distributor", matched='"price": "29.95"')
        v = verify("price", [a, b], now=NOW)
        assert v.status == "conflict" and v.value is None and "24.95" in v.reason and "29.95" in v.reason

    def test_same_value_from_two_sources_is_not_a_conflict(self):
        a = ev(); b = ev(url="https://www.adafruit.com/product/1", tier="distributor", matched="dji-mini4-fmc in stock")
        assert verify("sku", [a, b], now=NOW).status == "verified"

    def test_mismatched_brand_fails_the_product(self):
        records = [ev(), ev("brand", "Autel", matched='"brand": {"name": "Autel"}')]
        verdicts = verify_product(records, sku="DJI-MINI4-FMC", brand="DJI", now=NOW)
        assert verdicts["brand"].status == "not_found"
        assert verdicts["sku"].status == "not_found" and "different brand" in verdicts["sku"].reason

    def test_product_with_agreeing_brand_verifies(self):
        records = [ev(), ev("brand", "DJI", matched='"brand": {"name": "DJI"}')]
        assert verify_product(records, sku="DJI-MINI4-FMC", brand="DJI", now=NOW)["sku"].status == "verified"

    def test_is_deterministic(self):
        records = [ev(), ev(fetched="2026-01-01T00:00:00Z")]
        assert verify("sku", records, now=NOW) == verify("sku", list(reversed(records)), now=NOW)


# ---- #82 fetching, extraction and adapters --------------------------------------------


class TestFetchers:
    def test_recorded_fetcher_replays_index_and_reports_missing_pages(self, recorded):
        hit = recorded.fetch("https://www.adafruit.com/product/3801")
        assert hit.ok and hit.from_cache and hit.content_sha256 == hashlib.sha256(hit.body.encode()).hexdigest()
        miss = recorded.fetch("https://www.adafruit.com/product/1")
        assert not miss.ok and miss.error == "not recorded (offline)"

    def test_recorded_404_is_a_real_status(self, recorded):
        assert recorded.fetch("https://www.adafruit.com/product/9999999").status == 404

    def test_trim_keeps_jsonld_links_and_text_but_drops_scripts(self):
        page = ('<html><head><script>evil()</script><style>a{}</style>'
                '<script type="application/ld+json">{"@type":"Product","sku":"1"}</script></head>'
                '<body class="x" onclick="y()"><nav>menu</nav><p>Kit includes: 1x Wheel</p><a href="https://w/p">W</a></body></html>')
        out = trim_html(page)
        assert "evil()" not in out and "a{}" not in out and "menu" not in out and 'onclick' not in out
        assert '"sku":"1"' in out and "1x Wheel" in out and 'href="https://w/p"' in out

    def test_polite_fetcher_refuses_http_and_never_touches_the_network_for_it(self, tmp_path):
        result = PoliteFetcher(tmp_path).fetch("http://www.adafruit.com/product/1")
        assert result.blocked and "https" in result.error

    def test_polite_fetcher_serves_fresh_cache_without_network(self, tmp_path):
        fetcher = PoliteFetcher(tmp_path, ttl_days=14)
        fetcher._write_cache(FetchResult("https://www.adafruit.com/product/1", 200, "<p>cached</p>", "2026-10-24T00:00:00Z", SHA))
        assert fetcher.fetch("https://www.adafruit.com/product/1").from_cache

    def test_polite_fetcher_expired_cache_is_not_served(self, tmp_path, monkeypatch):
        fetcher = PoliteFetcher(tmp_path, ttl_days=1)
        fetcher._write_cache(FetchResult("https://www.adafruit.com/product/1", 200, "<p>old</p>", "2020-01-01T00:00:00Z", SHA))
        monkeypatch.setattr(fetcher, "_allowed_by_robots", lambda url: False)  # no network in tests
        result = fetcher.fetch("https://www.adafruit.com/product/1")
        assert result.blocked and "robots" in result.error

    def test_robots_disallow_is_reported_as_blocked(self, tmp_path, monkeypatch):
        fetcher = PoliteFetcher(tmp_path)
        monkeypatch.setattr(fetcher, "_allowed_by_robots", lambda url: False)
        assert fetcher.fetch("https://www.adafruit.com/api/x").blocked


class TestExtraction:
    def test_jsonld_evidence_quotes_the_page(self, recorded):
        records = evidence_from_jsonld(recorded.fetch("https://www.adafruit.com/product/3801"))
        by_claim = {r.claim: r for r in records}
        assert by_claim["sku"].value == "3801" and "3801" in by_claim["sku"].matched_text
        assert by_claim["price"].value.startswith("4.5") and by_claim["price"].source_host_tier == "distributor"
        assert by_claim["purchase_url"].value.startswith("https://adafruit.com/product/3801")

    def test_sparkfun_jsonld_has_sku_and_mpn(self, recorded):
        records = evidence_from_jsonld(recorded.fetch("https://www.sparkfun.com/products/13301"))
        assert {r.claim: r.value for r in records}["sku"] == "ROB-13301"

    def test_includes_list_with_quantities(self, recorded):
        items = included_items(recorded.fetch("https://www.sparkfun.com/products/13301"))
        assert (4, "Side Strut") in {(i.quantity, i.name) for i in items}
        assert all(i.link is None for i in items)  # the Shadow Chassis page links no part pages

    def test_includes_list_with_links(self, recorded):
        items = included_items(recorded.fetch("https://www.sparkfun.com/products/15267"))
        assert len(items) == 23 and all(i.link for i in items)


class TestAdapters:
    def test_adafruit_lookup_returns_evidence(self, recorded):
        result = AdafruitAdapter().lookup("3801", recorded)
        assert result.found and verify("sku", result.evidence, now=NOW).value == "3801"

    def test_sparkfun_accepts_prefixed_and_bare_skus(self, recorded):
        assert SparkFunAdapter().lookup("ROB-13301", recorded).found
        assert SparkFunAdapter().lookup("13301", recorded).found

    def test_nonexistent_product_is_an_explicit_not_found(self, recorded):
        result = AdafruitAdapter().lookup("9999999", recorded)
        assert result.status == "not_found" and result.evidence == [] and "404" in result.reason

    def test_unrecorded_page_is_an_error_not_a_guess(self, recorded):
        result = AdafruitAdapter().lookup("1", recorded)
        assert result.status == "error" and result.evidence == []

    def test_unsupported_identifier_shape(self, recorded):
        assert SparkFunAdapter().lookup("99999999", recorded).status == "unsupported"

    def test_keyed_apis_report_missing_keys(self, recorded, monkeypatch):
        monkeypatch.delenv("MOUSER_API_KEY", raising=False)
        monkeypatch.delenv("DIGIKEY_CLIENT_ID", raising=False)
        assert MouserAdapter().lookup("TB6612FNG", recorded).status == "needs_api_key"
        assert DigiKeyAdapter().lookup("TB6612FNG", recorded).status == "needs_api_key"

    def test_lookup_all_is_deterministic_and_never_invents(self, recorded, monkeypatch):
        monkeypatch.delenv("MOUSER_API_KEY", raising=False)
        monkeypatch.delenv("DIGIKEY_CLIENT_ID", raising=False)
        results = lookup_all("3801", recorded)
        assert [r.adapter for r in results] == ["adafruit", "sparkfun", "mouser", "digikey"]
        assert [r.status for r in results] == ["found", "error", "needs_api_key", "needs_api_key"]

    def test_mouser_response_parser(self):
        body = json.dumps({"SearchResults": {"Parts": [{"ManufacturerPartNumber": "TB6612FNG,C,8,EL", "MouserPartNumber": "757-TB6612FNGC8EL",
                 "Manufacturer": "Toshiba", "Description": "Motor driver", "PriceBreaks": [{"Price": "$2.52"}], "Availability": "In Stock",
                 "ProductDetailUrl": "https://www.mouser.com/ProductDetail/1", "DataSheetUrl": "https://www.mouser.com/ds.pdf"}]}})
        result = parse_mouser_response(FetchResult("https://api.mouser.com/api/v1/search/partnumber?apiKey=K", 200, body, "2026-10-24T00:00:00Z", SHA), "TB6612FNG,C,8,EL")
        assert result.found and "apiKey" not in result.url
        assert verify("mpn", result.evidence, now=NOW).status == "verified"
        assert verify("brand", result.evidence, now=NOW).value == "Toshiba"

    def test_mouser_parser_not_found_for_other_part(self):
        body = json.dumps({"SearchResults": {"Parts": [{"ManufacturerPartNumber": "OTHER"}]}})
        assert parse_mouser_response(FetchResult("https://api.mouser.com/x", 200, body, "2026-10-24T00:00:00Z", SHA), "TB6612FNG").status == "not_found"

    def test_digikey_response_parser(self):
        body = json.dumps({"Product": {"ManufacturerProductNumber": "ESP32-DEVKITC-32E", "Manufacturer": {"Name": "Espressif Systems"},
                 "Description": {"ProductDescription": "ESP32 dev board"}, "UnitPrice": 10.0, "ProductUrl": "https://www.digikey.com/en/p/1",
                 "ProductVariations": [{"DigiKeyProductNumber": "1965-ESP32-DEVKITC-32E-ND"}]}})
        result = parse_digikey_response(FetchResult("https://api.digikey.com/products/v4/search/x/productdetails", 200, body, "2026-10-24T00:00:00Z", SHA), "ESP32-DEVKITC-32E")
        assert result.found and verify("sku", result.evidence, now=NOW).value == "1965-ESP32-DEVKITC-32E-ND"

    def test_manufacturer_page_adapter_blocks_non_allowlisted_hosts(self, recorded):
        assert ManufacturerPageAdapter("https://shop.invented/p/1").lookup("X", recorded).status == "blocked"

    def test_manufacturer_page_adapter_not_found_when_page_lacks_identifier(self, recorded):
        result = ManufacturerPageAdapter("https://www.adafruit.com/product/3801").lookup("NOT-ON-PAGE-123", recorded)
        assert result.status == "not_found"


# ---- #83 decomposition and fallbacks ---------------------------------------------------


class TestDecomposition:
    def test_golden_full_bom_leaf_product_is_exact_match(self, recorded):
        d = decompose("https://www.adafruit.com/product/3801", recorded, now=NOW)
        assert d.outcome == "exact_match" and d.counts == {"verified": 1, "inferred": 0, "not_found": 0}
        part = d.parts[0]
        assert part.sku.status == "verified" and part.price.status == "verified" and part.material is None

    def test_golden_partial_kit_with_linked_parts(self, recorded):
        d = decompose("https://www.sparkfun.com/products/15267", recorded, now=NOW)
        assert d.outcome == "partial_match" and d.counts["verified"] == 22 and d.counts["not_found"] == 1
        missing = next(p for p in d.parts if p.status == "not_found")
        assert "TMP36" in missing.name and "404" in missing.reason  # the vendor's own link is dead
        verified = next(p for p in d.parts if p.status == "verified")
        assert verified.sku.evidence[0].source_url == verified.source_url

    def test_golden_partial_kit_without_part_pages(self, recorded):
        d = decompose("https://www.sparkfun.com/products/13301", recorded, now=NOW)
        assert d.outcome == "partial_match" and d.counts["not_found"] == 12 and d.counts["verified"] == 0
        assert all(p.sku is None and p.name_evidence[0].matched_text.endswith(p.name) for p in d.parts)

    def test_golden_nonexistent_product(self, recorded):
        d = decompose("https://www.adafruit.com/product/9999999", recorded, now=NOW)
        assert d.outcome == "no_match_with_alternatives" and d.parts == [] and "404" in d.reason

    def test_offline_is_reported_not_hidden(self, recorded):
        d = decompose("https://www.adafruit.com/product/1", recorded, now=NOW)
        assert d.outcome == "unsupported" and d.fetch_errors == ["not recorded (offline)"]

    def test_part_without_evidence_is_never_guessed(self, recorded):
        d = decompose("https://www.adafruit.com/product/2939", recorded, now=NOW)
        assert {p.status for p in d.parts} == {"not_found"} and all(p.sku is None for p in d.parts)


class TestReferenceArchitectures:
    def test_data_covers_three_categories_with_recorded_sources(self, recorded):
        data = load_reference_architectures()
        assert {"rover", "drone", "robot_arm"} <= set(data)
        for cat in ("rover", "drone", "robot_arm"):
            for role in data[cat]["roles"]:
                for part in role["typical_parts"]:
                    assert recorded.fetch(part["source_url"]).ok, part["source_url"]
                    assert set(part["used_by"]) <= set(data[cat]["comparable_products"])

    def test_typical_parts_are_labelled_with_a_reason_and_reverified(self, recorded):
        parts = {t.role: t for t in typical_parts("rover", recorded, now=NOW)}
        motor = parts["drive_motor"]
        assert motor.label == "typical for category" and motor.sku.status == "verified"
        assert motor.reason == "3 of 4 comparable rovers include a part in this class"
        assert parts["caster"].entry is None and "no sourced reference part" in parts["caster"].reason

    def test_ranking_is_deterministic_by_usage_then_sku(self, recorded):
        first = [t.entry.sku if t.entry else None for t in typical_parts("rover", recorded, now=NOW)]
        second = [t.entry.sku if t.entry else None for t in typical_parts("rover", recorded, now=NOW)]
        assert first == second and first[0] == "2939"  # chassis: both candidates used by 1 product, "2939" < "ROB-13301"

    def test_unknown_category_has_no_fallback(self, recorded):
        assert typical_parts("toaster", recorded, now=NOW) == []

    def test_drone_gaps_are_explicit(self, recorded):
        parts = {t.role: t for t in typical_parts("drone", recorded, now=NOW)}
        assert parts["flight_controller"].entry is None and parts["gps"].sku.status == "verified"
