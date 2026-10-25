"""Identifier normalisation, GTIN validation and canonical URLs (plan 3.2 step 1).

The normalised tuple is the cache key for a query, so two spellings of the same SKU
(case, unicode width, stray whitespace) never trigger two searches.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from rivet_engine.ecommerce.models import OfferQuery

MAX_IDENTIFIER_LENGTH = 64
MAX_MANUFACTURER_LENGTH = 120
GTIN_LENGTHS = frozenset({8, 12, 13, 14})
SYNTHETIC_PREFIXES = ("demo.", "synthetic.")

_WS = re.compile(r"\s+")
_GTIN_SEPARATORS = re.compile(r"[\s-]")
_TRACKING_PARAM = re.compile(
    r"^(utm_.*|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|srsltid|spm|_ga|_gl|"
    r"ref|ref_|refid|referrer|tag|aff|aff_id|affid|affiliate|affiliate_id|afftrack|partner|campaign|cmpid|"
    r"icid|ncid|sc_cid|pk_campaign|pk_kwd|trk|trkid|clickid|irclickid|irgwc|zanpid|awc)$",
    re.I,
)


class InvalidIdentifier(ValueError):
    """An identifier that cannot be searched for: empty, too long, or a GTIN with a bad check digit."""

    code = "INVALID_IDENTIFIER"

    def __init__(self, field: str, message: str):
        super().__init__(f"{field}: {message}")
        self.field = field
        self.message = message


def clean_text(value: str | None, *, field: str, max_length: int) -> str | None:
    if value is None:
        return None
    text = _WS.sub(" ", unicodedata.normalize("NFKC", str(value))).strip()
    if not text:
        return None
    if len(text) > max_length:
        raise InvalidIdentifier(field, f"longer than {max_length} characters")
    if "|" in text:
        raise InvalidIdentifier(field, "must not contain '|'")
    return text


def gtin_check_digit(digits: str) -> int:
    total = 0
    for position, char in enumerate(reversed(digits)):
        weight = 3 if position % 2 == 0 else 1
        total += int(char) * weight
    return (10 - total % 10) % 10


def validate_gtin(value: str | None) -> str | None:
    """Digits of a GTIN-8/12/13/14 whose check digit is right; None stays None."""
    if value is None:
        return None
    digits = _GTIN_SEPARATORS.sub("", unicodedata.normalize("NFKC", str(value)))
    if not digits:
        return None
    if not digits.isdigit() or len(digits) not in GTIN_LENGTHS:
        raise InvalidIdentifier("gtin", "must be 8, 12, 13 or 14 digits")
    if gtin_check_digit(digits[:-1]) != int(digits[-1]):
        raise InvalidIdentifier("gtin", "check digit does not match")
    return digits


def is_synthetic_catalog_id(catalog_id: str | None) -> bool:
    return bool(catalog_id) and str(catalog_id).startswith(SYNTHETIC_PREFIXES)


def normalized_key(sku: str | None, mpn: str | None, gtin: str | None, manufacturer: str | None) -> str:
    return "|".join((part or "").casefold() for part in (sku, mpn, gtin, manufacturer))


def normalize_query(
    sku: str | None = None,
    mpn: str | None = None,
    gtin: str | None = None,
    manufacturer: str | None = None,
    catalog_id: str | None = None,
) -> OfferQuery:
    """Trimmed, NFKC-folded identifiers with a case-insensitive cache key.

    Raises `InvalidIdentifier` when nothing searchable is left and the query names no catalog
    part (a synthetic `demo.*` id with no SKU is allowed so the pipeline can refuse it).
    """
    sku = clean_text(sku, field="sku", max_length=MAX_IDENTIFIER_LENGTH)
    mpn = clean_text(mpn, field="mpn", max_length=MAX_IDENTIFIER_LENGTH)
    gtin = validate_gtin(gtin)
    manufacturer = clean_text(manufacturer, field="manufacturer", max_length=MAX_MANUFACTURER_LENGTH)
    catalog_id = clean_text(catalog_id, field="catalog_id", max_length=200)
    if sku is None and mpn is None and gtin is None and catalog_id is None:
        raise InvalidIdentifier("sku", "at least one of sku, mpn or gtin is required")
    return OfferQuery(
        sku=sku,
        mpn=mpn,
        gtin=gtin,
        manufacturer=manufacturer,
        catalog_id=catalog_id,
        normalized_key=normalized_key(sku, mpn, gtin, manufacturer),
    )


class InvalidUrl(ValueError):
    """A URL that is not a plain https page (javascript:, http:, data:, no host)."""


def canonical_url(url: str) -> str:
    """https only; lowercase host, default port and fragment dropped, tracking params removed,
    remaining query sorted, trailing slash stripped. `www.` is kept so hashes match the published
    fixtures; `dedupe_key` folds it for duplicate detection."""
    parts = urlsplit(url.strip())
    if parts.scheme.lower() != "https" or not parts.hostname:
        raise InvalidUrl(f"not an https URL: {url[:80]!r}")
    host = parts.hostname.lower()
    if parts.port and parts.port != 443:
        host = f"{host}:{parts.port}"
    query = sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _TRACKING_PARAM.match(k))
    path = re.sub(r"/{2,}", "/", parts.path or "/").rstrip("/")
    return urlunsplit(("https", host, path, urlencode(query, doseq=True), ""))


def dedupe_key(url: str) -> str:
    canonical = canonical_url(url)
    return canonical.replace("https://www.", "https://", 1)


def offer_id(vendor_id: str, url: str) -> str:
    return f"{vendor_id}:{hashlib.sha256(canonical_url(url).encode('utf-8')).hexdigest()[:16]}"


__all__ = [
    "InvalidIdentifier",
    "InvalidUrl",
    "canonical_url",
    "clean_text",
    "dedupe_key",
    "gtin_check_digit",
    "is_synthetic_catalog_id",
    "normalize_query",
    "normalized_key",
    "offer_id",
    "validate_gtin",
]
