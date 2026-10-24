"""Plan section 6 gates, tested against the pure functions with injected evidence."""

import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from rivet_api.agents.product import ProductGuess
from rivet_api.resolution.evidence import Evidence, assess, synthetic_reason
from rivet_api.resolution.gates import apply_gates
from rivet_api.resolution.resolver import (
    AlternativeProduct,
    PartCandidate,
    ProductCandidate,
    ResolverResult,
    TypicalPart,
)
from rivet_api.resolution.stub import StubResolver

NOW = datetime(2026, 10, 24, 18, 0, tzinfo=timezone.utc)


def ev(value="SKU-1", claim="sku", tier="manufacturer", extractor="jsonld", matched=None, age_days=0,
       url="https://maker.example/p", sha=None, ttl=14):
    matched = f"SKU: {value}" if matched is None else matched
    return Evidence(
        claim=claim,
        value=value,
        source_url=url,
        source_host_tier=tier,
        fetched_at=(NOW - timedelta(days=age_days)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        content_sha256=sha or hashlib.sha256(matched.encode()).hexdigest(),
        extractor=extractor,
        matched_text=matched,
        ttl_days=ttl,
    )


def guess(brand="Acme", model="X1", category="drone", verdict="supported", reason=None):
    return ProductGuess(brand=brand, model_guess=model, category=category, confidence="medium",
                        verdict=verdict, unsupported_reason=reason)


def product(sku="SKU-1", evidence=None, brand="Acme"):
    return ProductCandidate(brand=brand, name="Acme X1", sku=sku, evidence=[ev(sku)] if evidence is None else evidence)


def part(pid, sku="P-1", evidence=None, **kw):
    return PartCandidate(part_id=pid, name=pid.title(), sku=sku, evidence=[ev(sku, tier="distributor")] if evidence is None else evidence, **kw)


# ---- evidence assessment ---------------------------------------------------------
@pytest.mark.parametrize("tier", ["manufacturer", "distributor"])
def test_trusted_tiers_with_matching_text_are_verified(tier):
    assert assess(ev(tier=tier), NOW)[0] == "verified"


def test_teardown_is_inferred_never_verified():
    assert assess(ev(tier="teardown"), NOW)[0] == "inferred"


def test_community_is_rejected():
    assert assess(ev(tier="community"), NOW)[0] == "rejected"


def test_llm_extract_alone_is_never_verified():
    assert assess(ev(extractor="llm-extract"), NOW)[0] == "inferred"


def test_llm_extract_whose_text_lacks_the_value_is_rejected():
    """A model hallucinating a value is re-checked against the fetched text."""
    assert assess(ev(extractor="llm-extract", matched="a page about something else"), NOW)[0] == "rejected"


def test_page_returning_200_without_the_sku_is_not_verified():
    assert assess(ev("FAKE-9", matched="Welcome to our store. Product: Acme X1"), NOW)[0] == "rejected"


def test_match_is_case_and_whitespace_insensitive_but_not_fuzzy():
    assert assess(ev("ab-12", matched="SKU:  AB-12 in stock"), NOW)[0] == "verified"
    assert assess(ev("AB-12", matched="SKU: AB-123"), NOW)[0] == "rejected"  # whole token only
    assert assess(ev("AB-12", matched="XAB-12"), NOW)[0] == "rejected"
    assert assess(ev("AB-12", matched="SKU: AB-13"), NOW)[0] == "rejected"


def test_stale_evidence_is_downgraded():
    assert assess(ev(age_days=15), NOW)[0] == "stale"
    assert assess(ev(age_days=13), NOW)[0] == "verified"


def test_future_dated_evidence_is_stale():
    assert assess(ev(age_days=-3), NOW)[0] == "stale"


@pytest.mark.parametrize("url", ["http://maker.example/p", "ftp://x/y", "maker.example/p", "https://"])
def test_non_https_sources_are_rejected(url):
    assert assess(ev(url=url), NOW)[0] == "rejected"


@pytest.mark.parametrize("sha", ["", "abc", "Z" * 64])
def test_missing_or_bad_content_hash_is_rejected(sha):
    assert assess(ev(sha=sha or "x"), NOW)[0] == "rejected"


def test_bad_timestamp_is_rejected():
    e = ev().model_copy(update={"fetched_at": "yesterday"})
    assert assess(e, NOW)[0] == "rejected"


# ---- outcomes --------------------------------------------------------------------
def test_exact_match_when_product_and_every_part_verified_or_unavailable():
    r = ResolverResult(
        product=product(),
        parts=[part("frame"), part("motor", "P-2"), PartCandidate(part_id="gimbal", name="Gimbal", unavailable_reason="Not sold separately")],
    )
    out = apply_gates(guess(), r, NOW)
    assert out.outcome == "exact_match"
    assert [p.status for p in out.parts] == ["verified", "verified", "unavailable"]
    assert out.alternatives == [] and out.typical_parts == []
    assert out.counts.verified == 2 and out.counts.unavailable == 1
    assert "SKU-1" in out.headline


def test_partial_match_when_a_part_is_not_confirmed():
    r = ResolverResult(product=product(), parts=[part("frame"), PartCandidate(part_id="battery", name="Battery")])
    out = apply_gates(guess(), r, NOW)
    assert out.outcome == "partial_match"
    assert out.counts.not_found == 1 and "1 of 2" in out.headline


def test_inferred_part_keeps_the_product_partial():
    r = ResolverResult(product=product(), parts=[part("frame", evidence=[ev("P-1", tier="teardown")])])
    out = apply_gates(guess(), r, NOW)
    assert out.outcome == "partial_match" and out.parts[0].status == "inferred"


def test_product_with_no_parts_is_partial_not_exact():
    out = apply_gates(guess(), ResolverResult(product=product()), NOW)
    assert out.outcome == "partial_match" and "could not confirm any" in out.headline


def test_unavailable_mark_cannot_replace_a_failed_sku_claim():
    """If a record was supplied but rejected, the part is not_found, not conveniently unavailable."""
    bad = ev("P-1", tier="community")
    r = ResolverResult(product=product(), parts=[PartCandidate(part_id="m", name="M", sku="P-1", evidence=[bad], unavailable_reason="n/a")])
    assert apply_gates(guess(), r, NOW).parts[0].status == "not_found"


def test_no_product_gives_no_match_with_alternatives():
    r = ResolverResult(alternatives=[AlternativeProduct(brand="B", name="B1", sku="ALT-1", reason="same category", evidence=[ev("ALT-1")])])
    out = apply_gates(guess(), r, NOW)
    assert out.outcome == "no_match_with_alternatives"
    assert out.product is None and [a.sku for a in out.alternatives] == ["ALT-1"]


def test_unsupported_guess_never_reaches_resolution():
    out = apply_gates(guess(brand=None, model=None, category="not_a_product", verdict="unsupported", reason="A landscape"),
                      ResolverResult(product=product()), NOW)
    assert out.outcome == "unsupported" and out.product is None and "A landscape" in out.headline
    assert out.ledger == []


# ---- fabricated and mismatched claims ---------------------------------------------
def test_fabricated_product_sku_is_never_verified():
    fake = ev("FAKE-123", matched="This page does not mention that")
    out = apply_gates(guess(), ResolverResult(product=product("FAKE-123", [fake])), NOW)
    assert out.outcome == "no_match_with_alternatives"
    assert out.product.status == "not_found" and out.product.sku is None
    assert out.ledger[0].support == "rejected"


def test_product_with_no_evidence_is_not_found():
    out = apply_gates(guess(), ResolverResult(product=product("SKU-1", [])), NOW)
    assert out.outcome == "no_match_with_alternatives" and out.product.status == "not_found"


def test_declared_sku_must_match_the_evidence_value():
    out = apply_gates(guess(), ResolverResult(product=product("OTHER", [ev("SKU-1")])), NOW)
    assert out.product.status == "conflict" and out.outcome == "no_match_with_alternatives"


def test_brand_disagreement_is_not_a_match():
    out = apply_gates(guess(brand="Acme"), ResolverResult(product=product(brand="Globex")), NOW)
    assert out.outcome == "no_match_with_alternatives" and out.product.status == "not_found"


def test_unknown_brand_guess_does_not_block_a_verified_product():
    out = apply_gates(guess(brand=None), ResolverResult(product=product(), parts=[part("f")]), NOW)
    assert out.outcome == "exact_match"


def test_stale_product_evidence_does_not_confirm():
    out = apply_gates(guess(), ResolverResult(product=product("SKU-1", [ev(age_days=30)])), NOW)
    assert out.outcome == "no_match_with_alternatives"
    assert out.ledger[0].support == "stale"
    assert out.product.status == "stale" and out.product.sku is None


def test_stale_part_is_labelled_stale_and_keeps_the_product_partial():
    r = ResolverResult(product=product(), parts=[part("f"), part("m", "P-2", [ev("P-2", tier="distributor", age_days=20)])])
    out = apply_gates(guess(), r, NOW)
    assert out.outcome == "partial_match" and out.counts.stale == 1
    stale = next(p for p in out.parts if p.part_id == "m")
    assert stale.status == "stale" and stale.sku is None and "14-day" in stale.claims[0].note


def test_fresh_record_beats_a_stale_one_for_the_same_value():
    r = ResolverResult(product=product("SKU-1", [ev(age_days=30), ev()]), parts=[part("f")])
    assert apply_gates(guess(), r, NOW).outcome == "exact_match"


# ---- sample data is recognised (live mode refuses it) ---------------------------------
@pytest.mark.parametrize(
    ("url", "value"),
    [
        ("https://manufacturer.stub.invalid/p", "SKU-1"),
        ("https://maker.example/p", "SKU-1"),
        ("https://shop.example.com/p", "SKU-1"),
        ("https://localhost/p", "SKU-1"),
        ("https://shop.test/p", "SKU-1"),
        ("https://10.0.0.5/p", "SKU-1"),
        ("https://[::1]/p", "SKU-1"),
        ("https://www.dji.com/p", "STUB-DJI-MINI4"),
        ("https://www.dji.com/p", "synthetic.motor"),
    ],
)
def test_sample_hosts_and_values_are_flagged(url, value):
    assert synthetic_reason(ev(value, url=url)) is not None


@pytest.mark.parametrize("url", ["https://www.dji.com/p", "https://www.digikey.com/x", "https://cafe.de/p"])
def test_real_looking_hosts_are_not_flagged(url):
    assert synthetic_reason(ev("MT4MFVD", url=url)) is None


def test_hallucinated_part_cannot_reach_the_plan_as_verified():
    fake = ev("GHOST-1", tier="distributor", extractor="llm-extract", matched="nothing relevant")
    r = ResolverResult(product=product(), parts=[part("ghost", "GHOST-1", [fake])])
    out = apply_gates(guess(), r, NOW)
    assert out.parts[0].status == "not_found" and out.parts[0].sku is None
    assert out.outcome == "partial_match"


# ---- conflicts -----------------------------------------------------------------
def test_two_sources_disagreeing_on_a_part_sku_is_conflict_and_not_averaged():
    r = ResolverResult(product=product(), parts=[part("motor", "M-1", [ev("M-1", tier="distributor"), ev("M-2", tier="manufacturer")])])
    out = apply_gates(guess(), r, NOW)
    p = out.parts[0]
    assert p.status == "conflict" and p.sku is None
    assert p.claims[0].conflicting_values == ["M-1", "M-2"]
    assert out.outcome == "partial_match" and out.conflicts == ["part motor: sources disagree"]


def test_price_conflict_surfaces_on_the_part_claim():
    prices = [ev("12.00", claim="price", tier="distributor"), ev("14.50", claim="price", tier="manufacturer")]
    r = ResolverResult(product=product(), parts=[part("motor", "M-1", [ev("M-1", tier="distributor"), *prices])])
    out = apply_gates(guess(), r, NOW)
    assert out.parts[0].status == "conflict"
    price = next(c for c in out.parts[0].claims if c.claim == "price")
    assert price.status == "conflict" and price.value is None


def test_product_sku_conflict_blocks_exact_match():
    out = apply_gates(guess(), ResolverResult(product=product("A-1", [ev("A-1"), ev("B-2")])), NOW)
    assert out.outcome == "no_match_with_alternatives" and out.product.status == "conflict"
    assert out.conflicts == ["product: sources disagree on the SKU"]


def test_a_rejected_record_does_not_create_a_conflict():
    r = ResolverResult(product=product(), parts=[part("m", "M-1", [ev("M-1", tier="distributor"), ev("M-9", tier="community")])])
    assert apply_gates(guess(), r, NOW).parts[0].status == "verified"


def test_agreeing_sources_are_not_a_conflict():
    r = ResolverResult(product=product(), parts=[part("m", "M-1", [ev("M-1", tier="distributor"), ev("m-1", tier="manufacturer")])])
    assert apply_gates(guess(), r, NOW).parts[0].status == "verified"


# ---- fallback section ------------------------------------------------------------
def test_unverified_alternatives_and_unsourced_typical_parts_are_dropped():
    r = ResolverResult(
        alternatives=[
            AlternativeProduct(brand="B", name="Good", sku="ALT-1", reason="r", evidence=[ev("ALT-1")]),
            AlternativeProduct(brand="B", name="Bad", sku="ALT-2", reason="r", evidence=[]),
            AlternativeProduct(brand="B", name="Blog", sku="ALT-3", reason="r", evidence=[ev("ALT-3", tier="community")]),
        ],
        typical_parts=[
            TypicalPart(name="Motor", rationale="3 of 4 comparable drones", sku="T-1", evidence=[ev("T-1", tier="distributor")]),
            TypicalPart(name="Prop", rationale="most", sku="T-2", evidence=[]),
        ],
    )
    out = apply_gates(guess(), r, NOW)
    assert [a.sku for a in out.alternatives] == ["ALT-1"]
    assert [t.name for t in out.typical_parts] == ["Motor"]
    assert out.counts.dropped_claims == 3


def test_typical_parts_carry_their_own_label_and_are_not_merged_into_parts():
    r = ResolverResult(product=product(), parts=[part("f"), PartCandidate(part_id="b", name="Battery")],
                       typical_parts=[TypicalPart(name="Battery", rationale="x", sku="T-1", evidence=[ev("T-1")])])
    out = apply_gates(guess(), r, NOW)
    assert out.typical_parts[0].label == "typical_for_category"
    assert all(p.part_id != "T-1" for p in out.parts) and [p.part_id for p in out.parts] == ["f", "b"]


def test_alternative_evidence_is_in_the_ledger():
    r = ResolverResult(alternatives=[AlternativeProduct(brand="B", name="N", sku="ALT-1", reason="r", evidence=[ev("ALT-1")])])
    out = apply_gates(guess(), r, NOW)
    assert out.alternatives[0].evidence_ids == [out.ledger[0].evidence_id]
    assert out.ledger[0].subject == "alternative:ALT-1"


def test_ledger_ids_are_unique_and_ordered():
    r = ResolverResult(product=product(), parts=[part("a"), part("b", "P-2")])
    ids = [e.evidence_id for e in apply_gates(guess(), r, NOW).ledger]
    assert ids == ["ev-001", "ev-002", "ev-003"]


# ---- the stub follows the same rules ------------------------------------------------
@pytest.mark.parametrize(
    "brand,model,category,outcome",
    [
        ("DJI", "Mini 4", "drone", "exact_match"),
        ("Parrot", "Anafi", "drone", "partial_match"),
        ("Nobody", "Nothing 9", "drone", "no_match_with_alternatives"),
        ("Nobody", "Thing", "other_product", "no_match_with_alternatives"),
    ],
)
def test_stub_resolver_reaches_each_outcome_through_the_gates(brand, model, category, outcome):
    g = guess(brand, model, category)
    out = apply_gates(g, StubResolver(clock=lambda: NOW).resolve(g, None), NOW)
    assert out.outcome == outcome


def test_stub_alternatives_exist_for_unknown_drone_but_not_other_categories():
    drone = StubResolver(clock=lambda: NOW).resolve(guess("X", "Y", "drone"), None)
    other = StubResolver(clock=lambda: NOW).resolve(guess("X", "Y", "other_product"), None)
    assert drone.alternatives and not other.alternatives


def test_stub_is_deterministic():
    g = guess("DJI", "Mini 4")
    a = StubResolver(clock=lambda: NOW).resolve(g, None)
    b = StubResolver(clock=lambda: NOW).resolve(g, None)
    assert a == b


def test_stub_evidence_matches_the_section_5_1_shape():
    e = StubResolver(clock=lambda: NOW).resolve(guess("DJI", "Mini 4"), None).product.evidence[0]
    assert set(e.model_dump()) == {"claim", "value", "source_url", "source_host_tier", "fetched_at",
                                   "content_sha256", "extractor", "matched_text", "ttl_days"}
