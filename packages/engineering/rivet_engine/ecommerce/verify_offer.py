"""Decide whether a fetched page is an offer for the requested part (plan 3.2 step 4).

Structured data wins over prose: when the page's JSON-LD names a different SKU, free text that
mentions the requested one (including text that asks to be "marked verified") is at most a
fuzzy possible match. Allowlisted hosts are additionally checked with the sourcing verifier.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from rivet_engine.ecommerce.extract_offer import ExtractedPage, jsonld_quote
from rivet_engine.ecommerce.models import Match, MatchKind, OfferEvidenceLevel, OfferQuery, Vendor
from rivet_engine.sourcing.evidence import normalize, tier_for_url, verify_product
from rivet_engine.sourcing.extract import evidence_from_jsonld, find_quote
from rivet_engine.sourcing.fetch import FetchResult

FUZZY_CONFIDENCE = 0.4
TEXT_ONLY_CONFIDENCE = 0.6
MAX_QUOTE = 400
_LABEL_BEFORE = re.compile(r"(sku|part|model|mfr|art|item|p/n|#|no\.?)\W*$", re.I)


@dataclass(frozen=True)
class Decision:
    accepted: bool
    kind: MatchKind | None
    confidence: float
    evidence_quote: str | None
    evidence_level: OfferEvidenceLevel
    reason: str

    @property
    def match(self) -> Match:
        if self.kind is None:
            raise ValueError("no match for a dropped candidate")
        return Match(kind=self.kind, confidence=self.confidence, evidence_quote=self.evidence_quote)


def _same(a: str | None, b: str | None) -> bool:
    return a is not None and b is not None and normalize(a) == normalize(b)


def _token_occurrences(text: str, value: str) -> tuple[list[re.Match[str]], list[re.Match[str]]]:
    """Whole-token occurrences (not a fragment of a longer part number) and the subset preceded by a label."""
    pattern = re.compile(r"(?<![A-Za-z0-9/-])" + re.escape(value) + r"(?![A-Za-z0-9/-])", re.I)
    matches = list(pattern.finditer(text))
    labelled = [m for m in matches if _LABEL_BEFORE.search(text[max(0, m.start() - 25) : m.start()])]
    return matches, labelled


def _quote_at(text: str, m: re.Match[str]) -> str:
    start = max(0, m.start() - 60)
    return text[start : m.end() + 60][:MAX_QUOTE]


def _token_in_text(text: str, value: str) -> str | None:
    """A whole-token occurrence of the identifier in the visible text, quoted with context."""
    matches, labelled = _token_occurrences(text, value)
    if not matches:
        return None
    return _quote_at(text, (labelled or matches)[0])


def _labelled_or_branded(text: str, value: str, manufacturer: str | None) -> str | None:
    """Text-only evidence: the identifier must be labelled as one, or sit on a page that also names the manufacturer.

    A bare number matching a street address, a radiator model or a listing id is not an offer."""
    matches, labelled = _token_occurrences(text, value)
    if labelled:
        return _quote_at(text, labelled[0])
    if matches and manufacturer and normalize(manufacturer) in normalize(text):
        return _quote_at(text, matches[0])
    return None


def _digit_core(value: str | None) -> str | None:
    if not value:
        return None
    runs = re.findall(r"\d{3,}", value)
    return max(runs, key=len) if runs else None


def _structured_candidates(query: OfferQuery, page: ExtractedPage) -> list[tuple[MatchKind, str, str]]:
    out: list[tuple[MatchKind, str, str]] = []
    if query.gtin and _same(query.gtin, page.gtin):
        out.append(("gtin", query.gtin, "gtin13"))
    if query.sku and _same(query.sku, page.sku):
        out.append(("exact_sku", query.sku, "sku"))
    if query.sku and _same(query.sku, page.mpn):
        out.append(("exact_mpn", query.sku, "mpn"))
    if query.mpn and _same(query.mpn, page.mpn):
        out.append(("exact_mpn", query.mpn, "mpn"))
    if query.mpn and _same(query.mpn, page.sku):
        out.append(("exact_sku", query.mpn, "sku"))
    order = {"exact_sku": 0, "gtin": 1, "exact_mpn": 2}
    return sorted(out, key=lambda item: order[item[0]])


def _sourcing_verdict_rejects(result: FetchResult, sku: str) -> str | None:
    """On allowlisted hosts the sourcing verifier must agree on the SKU; its reason is returned when it does not."""
    if tier_for_url(result.url) is None:
        return None
    records = evidence_from_jsonld(result)
    if not any(r.claim == "sku" for r in records):
        return None
    verdict = verify_product(records, sku=sku)["sku"]
    if verdict.status in ("verified", "stale", "inferred"):
        return None
    return verdict.reason or verdict.status


def _wrong_manufacturer(query: OfferQuery, page: ExtractedPage, vendor: Vendor) -> str | None:
    """A matching number is not a match when the page belongs to another maker.

    Every manufacturer-tier shop numbers its own products, so Adafruit's 2130 is not Pololu's 2130: the
    page must name the requested manufacturer (JSON-LD brand or visible text) before its SKU counts.
    Marketplace listings carry seller-filled brands and are left to the tier and price-outlier penalties."""
    if not query.manufacturer or vendor.tier == "marketplace":
        return None
    wanted = normalize(query.manufacturer)
    if page.brand:
        return None if wanted in normalize(page.brand) or normalize(page.brand) in wanted else f"page brand is {page.brand}, not {query.manufacturer}"
    if wanted in normalize(vendor.name) or wanted in normalize(page.text):
        return None
    if vendor.tier == "manufacturer":
        return f"{vendor.name} numbers its own products and the page never names {query.manufacturer}"
    return None


def decide(query: OfferQuery, page: ExtractedPage, result: FetchResult, vendor: Vendor) -> Decision:
    """exact_sku / exact_mpn / gtin when the page's structured data states the identifier (and does not
    belong to another manufacturer); fuzzy when only visible text or the product name mentions it, since
    a page without structured data gives no price or stock to show; dropped otherwise."""
    identifiers = [value for value in (query.sku, query.mpn, query.gtin) if value]
    if not identifiers:
        return Decision(False, None, 0.0, None, "not_found", "query has no identifier")

    level: OfferEvidenceLevel = "verified" if vendor.tier != "unknown" else "inferred"

    for kind, value, key in _structured_candidates(query, page):
        quote = jsonld_quote(page.raw_jsonld, key, value) or _token_in_text(page.text, value)
        if quote is None:
            continue
        rejected = _sourcing_verdict_rejects(result, value) if kind == "exact_sku" else None
        if rejected:
            return Decision(False, None, 0.0, None, "not_found", rejected)
        wrong = _wrong_manufacturer(query, page, vendor)
        if wrong:
            return Decision(False, None, 0.0, None, "not_found", wrong)
        return Decision(True, kind, 1.0, quote[:MAX_QUOTE], level, f"JSON-LD {key} {value}")

    page_declares_other_product = bool((page.sku or page.mpn or page.gtin) and page.product is not None)
    unlabelled_mention = False
    for value in identifiers:
        if page_declares_other_product:
            quote = _token_in_text(page.text, value)
        else:
            quote = _labelled_or_branded(page.text, value, query.manufacturer)
            unlabelled_mention = unlabelled_mention or (quote is None and _token_in_text(page.text, value) is not None)
        if quote is None:
            continue
        if page_declares_other_product:
            if _digit_core(value) and _digit_core(value) in (page.name or ""):
                return Decision(True, "fuzzy", FUZZY_CONFIDENCE, None, "inferred",
                                f"page names {page.sku or page.mpn}, text mentions {value}")
            return Decision(False, None, 0.0, None, "not_found",
                            f"page's structured data names {page.sku or page.mpn or page.gtin}, not {value}")
        return Decision(True, "fuzzy", TEXT_ONLY_CONFIDENCE, quote, "inferred",
                        f"visible text states {value} but the page has no structured product data")

    for value in identifiers:
        core = _digit_core(value)
        if core and page.name and core in page.name and (page.sku or page.mpn):
            return Decision(True, "fuzzy", FUZZY_CONFIDENCE, None, "inferred",
                            f"title mentions {core} but SKU is {page.sku or page.mpn}")

    if unlabelled_mention:
        return Decision(False, None, 0.0, None, "not_found",
                        "identifier appears only as unlabelled text without the manufacturer; not a product page")
    return Decision(False, None, 0.0, None, "not_found", "page does not state the identifier")


def quote_for(page: ExtractedPage, value: str) -> str | None:
    return _token_in_text(page.text, value) or find_quote(page.text, value)


__all__ = ["Decision", "FUZZY_CONFIDENCE", "TEXT_ONLY_CONFIDENCE", "decide", "quote_for"]
