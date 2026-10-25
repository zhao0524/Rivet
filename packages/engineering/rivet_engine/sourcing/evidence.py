"""Evidence records and the deterministic verifier (docs/plan-verified-parts.md 5.1, 5.2, 6).

Models may propose values; only this code decides what counts as `verified`. The rules are
pure functions of the evidence records and the clock, so the same inputs give the same verdict.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, StrictInt

from rivet_engine.models import UtcTimestamp, WireModel

Claim = Literal[
    "sku",
    "mpn",
    "gtin",
    "brand",
    "name",
    "price",
    "availability",
    "purchase_url",
    "datasheet_url",
    "material",
    "part",
    "quantity",
]
HostTier = Literal["manufacturer", "distributor", "teardown", "community"]
Extractor = Literal["jsonld", "datasheet", "page-text", "llm-extract"]
ClaimStatus = Literal["verified", "inferred", "not_found", "stale", "conflict"]

VERIFYING_TIERS: frozenset[str] = frozenset({"manufacturer", "distributor"})
INFERRING_TIERS: frozenset[str] = frozenset({"teardown"})

# Host allowlist. Changed by PR, never by a model. Longest suffix wins.
HOST_TIERS: dict[str, HostTier] = {
    # manufacturers
    "dji.com": "manufacturer",
    "espressif.com": "manufacturer",
    "raspberrypi.com": "manufacturer",
    "arduino.cc": "manufacturer",
    "st.com": "manufacturer",
    "ti.com": "manufacturer",
    "toshiba.semicon-storage.com": "manufacturer",
    "pololu.com": "manufacturer",
    "seeedstudio.com": "manufacturer",
    # distributors (also sell their own designs; a page on their domain is first-party for those)
    "adafruit.com": "distributor",
    "sparkfun.com": "distributor",
    "digikey.com": "distributor",
    "mouser.com": "distributor",
    "api.mouser.com": "distributor",
    "api.digikey.com": "distributor",
    # teardowns and open-source BOMs: inferred only
    "ifixit.com": "teardown",
    "github.com": "teardown",
    "raw.githubusercontent.com": "teardown",
    # community: candidates only
    "reddit.com": "community",
    "forum.arduino.cc": "community",
    "hackaday.io": "community",
}


class Evidence(WireModel):
    """One sourced observation of one claim. `matched_text` is the quote from the fetched page."""

    claim: Claim
    value: str = Field(min_length=1)
    source_url: str = Field(min_length=1)
    source_host_tier: HostTier
    fetched_at: UtcTimestamp
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    extractor: Extractor
    matched_text: str | None
    ttl_days: StrictInt = Field(ge=1, le=365)


class Verdict(WireModel):
    """Result of verifying one claim against a set of evidence records."""

    claim: Claim
    status: ClaimStatus
    value: str | None
    evidence: list[Evidence]
    reason: str


def host_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def tier_for_url(url: str) -> HostTier | None:
    """Tier from the allowlist for this URL's host (suffix match), or None when not allowlisted."""
    host = host_of(url)
    if not host or urlparse(url).scheme != "https":
        return None
    best: tuple[int, HostTier] | None = None
    for allowed, tier in HOST_TIERS.items():
        if host == allowed or host.endswith("." + allowed):
            if best is None or len(allowed) > best[0]:
                best = (len(allowed), tier)
    return best[1] if best else None


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def text_supports(matched_text: str | None, value: str) -> bool:
    """The quoted page text must contain the claimed value as a whole token (whitespace/case-insensitive):
    `AB-12` is not found inside `AB-123`. Same rule as the API's `resolution/evidence.py:_contains`."""
    if not matched_text:
        return False
    needle = normalize(value)
    return bool(needle) and re.search(rf"(?<![0-9a-z]){re.escape(needle)}(?![0-9a-z])", normalize(matched_text)) is not None


def parse_utc(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)


def is_fresh(ev: Evidence, now: datetime) -> bool:
    # Stale only once strictly older than the TTL, as in the API (`now - fetched > ttl`).
    return now - parse_utc(ev.fetched_at) <= timedelta(days=ev.ttl_days)


def _usable(ev: Evidence, now: datetime) -> tuple[bool, str]:
    """A record may support a claim only if its host is allowlisted at the tier it declares and it quotes the value."""
    tier = tier_for_url(ev.source_url)
    if tier is None:
        return False, f"host not allowlisted: {host_of(ev.source_url) or ev.source_url}"
    if tier != ev.source_host_tier:
        return False, f"declared tier {ev.source_host_tier} but {host_of(ev.source_url)} is {tier}"
    if not text_supports(ev.matched_text, ev.value):
        return False, "page text does not contain the value"
    if not is_fresh(ev, now):
        return False, "expired"
    return True, ""


def verify(
    claim: Claim,
    records: Iterable[Evidence],
    *,
    now: datetime | None = None,
    expected_value: str | None = None,
) -> Verdict:
    """Decide one claim from its evidence.

    verified: a fresh manufacturer/distributor record whose quoted text contains the value and
              whose extractor is not llm-extract.
    inferred: otherwise a fresh teardown record, or an llm-extract whose quote contains the value.
    conflict: fresh supporting records (verified or inferred tier) disagree on the value.
    stale:    the only supporting records are past their TTL.
    not_found: nothing supports the claim (or it supports a different value than expected).
    """
    now = now or datetime.now(timezone.utc)
    candidates = [r for r in records if r.claim == claim]
    if not candidates:
        return Verdict(claim=claim, status="not_found", value=None, evidence=[], reason="no evidence")

    verifying: list[Evidence] = []
    inferring: list[Evidence] = []
    stale: list[Evidence] = []
    rejected: list[str] = []
    for ev in candidates:
        ok, why = _usable(ev, now)
        if not ok:
            if why == "expired" and text_supports(ev.matched_text, ev.value):
                stale.append(ev)
            else:
                rejected.append(why)
            continue
        if ev.source_host_tier in VERIFYING_TIERS and ev.extractor != "llm-extract":
            verifying.append(ev)
        elif ev.source_host_tier in INFERRING_TIERS or ev.extractor == "llm-extract":
            if ev.source_host_tier != "community":
                inferring.append(ev)
        # community tier can only find candidates; it never supports a claim

    supporting = verifying + inferring
    values = {normalize(ev.value) for ev in supporting}
    if len(values) > 1:
        return Verdict(
            claim=claim,
            status="conflict",
            value=None,
            evidence=supporting,
            reason="sources disagree: " + ", ".join(sorted({ev.value for ev in supporting})),
        )
    if expected_value is not None and values and normalize(expected_value) not in values:
        return Verdict(
            claim=claim,
            status="not_found",
            value=None,
            evidence=supporting,
            reason=f"sources state {supporting[0].value!r}, not {expected_value!r}",
        )
    if verifying:
        return Verdict(claim=claim, status="verified", value=verifying[0].value, evidence=verifying, reason="")
    if inferring:
        return Verdict(
            claim=claim,
            status="inferred",
            value=inferring[0].value,
            evidence=inferring,
            reason="only teardown/community or model-extracted evidence",
        )
    if stale:
        return Verdict(claim=claim, status="stale", value=stale[0].value, evidence=stale, reason="evidence past its TTL")
    return Verdict(claim=claim, status="not_found", value=None, evidence=[], reason="; ".join(sorted(set(rejected))))


def verify_product(
    records: Sequence[Evidence],
    *,
    sku: str,
    brand: str | None = None,
    now: datetime | None = None,
) -> dict[str, Verdict]:
    """Product identity: the SKU must verify, and when a brand is expected the page must agree on it."""
    out = {"sku": verify("sku", records, now=now, expected_value=sku)}
    if brand is not None:
        out["brand"] = verify("brand", records, now=now, expected_value=brand)
        if out["sku"].status == "verified" and out["brand"].status == "not_found" and out["brand"].evidence:
            out["sku"] = Verdict(
                claim="sku",
                status="not_found",
                value=None,
                evidence=out["sku"].evidence,
                reason=f"SKU page names a different brand ({out['brand'].reason})",
            )
    return out


__all__ = [
    "Claim",
    "ClaimStatus",
    "Evidence",
    "Extractor",
    "HOST_TIERS",
    "HostTier",
    "Verdict",
    "host_of",
    "is_fresh",
    "text_supports",
    "tier_for_url",
    "verify",
    "verify_product",
]
