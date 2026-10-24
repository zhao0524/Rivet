"""Evidence record (plan section 5.1) and the deterministic check that decides what it proves.

A resolver may return anything; only `assess` decides whether a record can back a claim.
The rules are fail closed: a record that does not clearly pass is `rejected`, never rounded up.
"""

import ipaddress
import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field

HostTier = Literal["manufacturer", "distributor", "teardown", "community"]
Extractor = Literal["jsonld", "datasheet", "page-text", "llm-extract"]
Support = Literal["verified", "inferred", "stale", "rejected"]

TRUSTED_TIERS: frozenset[str] = frozenset({"manufacturer", "distributor"})
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim: str = Field(min_length=1, max_length=40)
    value: str = Field(min_length=1, max_length=400)
    source_url: str = Field(min_length=1, max_length=2000)
    source_host_tier: HostTier
    fetched_at: str
    content_sha256: str
    extractor: Extractor
    matched_text: str = Field(max_length=4000)
    ttl_days: int = Field(gt=0, le=3650)


def parse_time(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _norm(text: str) -> str:
    return " ".join(text.split()).casefold()


def _contains(text: str, value: str) -> bool:
    """The value must appear as a whole token: `AB-12` is not found inside `AB-123`."""
    pattern = rf"(?<![0-9a-z]){re.escape(_norm(value))}(?![0-9a-z])"
    return re.search(pattern, _norm(text)) is not None


_RESERVED_HOSTS = ("localhost", "example.com", "example.net", "example.org")
_RESERVED_SUFFIXES = (".invalid", ".test", ".example", ".localhost", ".local") + tuple(f".{h}" for h in _RESERVED_HOSTS)
_SYNTHETIC_VALUE_PREFIXES = ("stub-", "synthetic", "demo.")


def synthetic_reason(ev: Evidence) -> str | None:
    """Why this record is sample data rather than a real fetch, or None. Reserved and
    documentation hosts (RFC 2606 / 6761), IP literals, and stub or synthetic values are
    never a real source, so a live resolution that carries one is refused (plan section 6)."""
    host = (urlparse(ev.source_url).hostname or "").rstrip(".").casefold()
    if not host or host in _RESERVED_HOSTS or host.endswith(_RESERVED_SUFFIXES):
        return f"reserved or sample host {host or '(none)'}"
    try:
        ipaddress.ip_address(host)
        return f"IP address host {host}"
    except ValueError:
        pass
    if ev.value.casefold().startswith(_SYNTHETIC_VALUE_PREFIXES):
        return f"synthetic value {ev.value}"
    return None


def assess(ev: Evidence, now: datetime) -> tuple[Support, str]:
    """What this one record can support, and the reason in plain words.

    verified  manufacturer or distributor host, https, fresh, a content hash, a deterministic
              extractor, and matched_text that contains the value
    inferred  the text contains the value but the source cannot verify (teardown tier, or a
              model extraction); always shown labelled, never as the user's confirmed product
    stale     older than its TTL (or from the future); needs refetching
    rejected  anything else: community source, value not in the fetched text, bad url or hash
    """
    parsed = urlparse(ev.source_url)
    if parsed.scheme != "https" or not parsed.netloc:
        return "rejected", "source is not an https URL"
    if not _SHA256_RE.match(ev.content_sha256):
        return "rejected", "content hash is missing or malformed"
    fetched = parse_time(ev.fetched_at)
    if fetched is None:
        return "rejected", "fetch time is not a valid timestamp"
    if not _contains(ev.matched_text, ev.value):
        return "rejected", "the fetched text does not contain the claimed value"
    if fetched > now + timedelta(minutes=5):
        return "stale", "fetch time is in the future"
    if now - fetched > timedelta(days=ev.ttl_days):
        return "stale", f"evidence is older than its {ev.ttl_days}-day limit"
    if ev.source_host_tier == "community":
        return "rejected", "community sources can only suggest candidates"
    if ev.source_host_tier == "teardown":
        return "inferred", "teardown source"
    if ev.extractor == "llm-extract":
        return "inferred", "a model extraction alone cannot verify a claim"
    return "verified", "trusted source contains the value"
