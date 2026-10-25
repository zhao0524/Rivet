"""Page fetching for sourcing (docs/plan-verified-parts.md principle 6).

`PoliteFetcher` is the only thing in the engine that touches the network: it honours
robots.txt, rate-limits per host, identifies itself, and caches responses on disk with a TTL.
`RecordedFetcher` replays pages saved under a fixtures directory so every test runs offline.
Both return a `FetchResult`; failures and blocks are reported in the result, never hidden.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol
from urllib import robotparser
from urllib.parse import urlparse

USER_AGENT = "RivetBot/0.1 (+https://github.com/RohanGottipati/Rivet; sourcing verification)"
DEFAULT_CACHE_TTL_DAYS = 14


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class FetchResult:
    url: str
    status: int  # HTTP status; 0 when no response was obtained
    body: str
    fetched_at: str
    content_sha256: str
    blocked: bool = False  # robots.txt or policy refused the fetch
    error: str | None = None  # transport error, not recorded, etc.
    from_cache: bool = False

    @property
    def ok(self) -> bool:
        return self.status == 200 and not self.blocked and self.error is None

    @classmethod
    def failure(cls, url: str, error: str, *, blocked: bool = False, status: int = 0) -> "FetchResult":
        return cls(url, status, "", utc_now_iso(), sha256_text(""), blocked=blocked, error=error)


class Fetcher(Protocol):
    def fetch(self, url: str) -> FetchResult: ...


def resolves_to_public_address(host: str | None) -> bool:
    """True only if every address `host` resolves to is globally routable (no private,
    loopback, link-local or metadata addresses), so a fetched URL cannot reach internal services."""
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except (OSError, UnicodeError):
        return False
    try:
        return bool(infos) and all(ipaddress.ip_address(info[4][0].split("%")[0]).is_global for info in infos)
    except ValueError:
        return False


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only to another https URL on a public address."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        target = urlparse(newurl)
        if target.scheme != "https" or not resolves_to_public_address(target.hostname):
            raise urllib.error.URLError(f"refused redirect to a non-https or non-public address: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PoliteFetcher:
    """Network fetcher with robots.txt, per-host rate limit, identifying UA and an on-disk cache.

    It only connects to hosts that resolve to public addresses and only follows redirects to
    https URLs on public addresses (search results are untrusted input)."""

    def __init__(
        self,
        cache_dir: Path | str,
        *,
        ttl_days: int = DEFAULT_CACHE_TTL_DAYS,
        min_interval_s: float = 2.0,
        timeout_s: float = 20.0,
        user_agent: str = USER_AGENT,
        max_bytes: int = 4_000_000,
    ):
        self.cache_dir = Path(cache_dir)
        self.ttl = timedelta(days=ttl_days)
        self.min_interval_s = min_interval_s
        self.timeout_s = timeout_s
        self.user_agent = user_agent
        self.max_bytes = max_bytes
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, robotparser.RobotFileParser | None] = {}
        self._non_public: set[str] = set()
        # Hosts whose robots.txt just answered 429/5xx, with that status; read once by `fetch`.
        self._robots_unavailable: dict[str, int] = {}
        self._opener = urllib.request.build_opener(_SafeRedirectHandler())

    def _cache_path(self, url: str) -> Path:
        return self.cache_dir / (hashlib.sha256(url.encode()).hexdigest() + ".json")

    def _read_cache(self, url: str) -> FetchResult | None:
        path = self._cache_path(url)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        fetched = datetime.fromisoformat(data["fetched_at"].replace("Z", "+00:00"))
        if fetched + self.ttl <= datetime.now(timezone.utc):
            return None
        return FetchResult(url, data["status"], data["body"], data["fetched_at"], data["content_sha256"], from_cache=True)

    def _write_cache(self, result: FetchResult) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._cache_path(result.url).write_text(
            json.dumps(
                {"url": result.url, "status": result.status, "body": result.body,
                 "fetched_at": result.fetched_at, "content_sha256": result.content_sha256}
            ),
            encoding="utf-8",
        )

    def _allowed_by_robots(self, url: str) -> bool:
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        if base not in self._robots:
            rp = robotparser.RobotFileParser()
            if not resolves_to_public_address(parsed.hostname):
                self._non_public.add(base)
                rp.parse(["User-agent: *", "Disallow: /"])
                self._robots[base] = rp
                return False
            try:
                self._throttle(parsed.netloc)
                req = urllib.request.Request(base + "/robots.txt", headers={"User-Agent": self.user_agent})
                with self._opener.open(req, timeout=self.timeout_s) as resp:
                    rp.parse(resp.read().decode("utf-8", "replace").splitlines())
            except urllib.error.HTTPError as exc:
                if exc.code == 429 or exc.code >= 500:
                    # Rate limited or down right now: refuse this fetch, but ask again next time
                    # instead of treating the whole host as disallowed for the process lifetime.
                    self._robots_unavailable[base] = exc.code
                    return False
                # No robots file means everything is allowed; other HTTP errors mean "do not assume".
                rp.parse([] if exc.code == 404 else ["User-agent: *", "Disallow: /"])
            except (urllib.error.URLError, TimeoutError, OSError):
                rp.parse(["User-agent: *", "Disallow: /"])
            self._robots[base] = rp
        rp = self._robots[base]
        return rp is None or rp.can_fetch(self.user_agent, url) or rp.can_fetch("*", url)

    def _throttle(self, host: str) -> None:
        last = self._last_hit.get(host)
        if last is not None:
            wait = self.min_interval_s - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
        self._last_hit[host] = time.monotonic()

    def fetch(self, url: str) -> FetchResult:
        if urlparse(url).scheme != "https":
            return FetchResult.failure(url, "only https URLs are fetched", blocked=True)
        cached = self._read_cache(url)
        if cached is not None:
            return cached
        parsed = urlparse(url)
        if not self._allowed_by_robots(url):
            base = f"{parsed.scheme}://{parsed.netloc}"
            status = self._robots_unavailable.pop(base, None)
            if status is not None:
                # Not a robots refusal: report the status so callers that retry 429s do so.
                return FetchResult.failure(url, f"robots.txt answered HTTP {status}; not fetched this time", status=status)
            if base in self._non_public:
                return FetchResult.failure(url, "host does not resolve to a public address", blocked=True)
            return FetchResult.failure(url, "disallowed by robots.txt", blocked=True)
        # Checked again here: DNS may have changed since robots.txt was read.
        if not resolves_to_public_address(parsed.hostname):
            return FetchResult.failure(url, "host does not resolve to a public address", blocked=True)
        self._throttle(parsed.netloc)
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": "text/html,application/json"})
        try:
            with self._opener.open(req, timeout=self.timeout_s) as resp:
                raw = resp.read(self.max_bytes + 1)
                if len(raw) > self.max_bytes:
                    return FetchResult.failure(url, f"response larger than {self.max_bytes} bytes", status=resp.status)
                body = raw.decode(resp.headers.get_content_charset() or "utf-8", "replace")
                result = FetchResult(url, resp.status, body, utc_now_iso(), sha256_text(body))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace") if exc.fp else ""
            result = FetchResult(url, exc.code, body, utc_now_iso(), sha256_text(body))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return FetchResult.failure(url, f"fetch failed: {exc}")
        if result.status in (200, 404):
            self._write_cache(result)
        return result


class RecordedFetcher:
    """Replays pages from `<dir>/index.json`: {url: {"file", "status", "fetched_at", "content_sha256"}}."""

    def __init__(self, directory: Path | str):
        self.directory = Path(directory)
        index_path = self.directory / "index.json"
        self.index: dict[str, dict] = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}

    def fetch(self, url: str) -> FetchResult:
        entry = self.index.get(url)
        if entry is None:
            return FetchResult.failure(url, "not recorded (offline)")
        body = (self.directory / entry["file"]).read_text(encoding="utf-8")
        return FetchResult(url, entry["status"], body, entry["fetched_at"], entry["content_sha256"], from_cache=True)

    def record(self, result: FetchResult, name: str) -> None:
        """Save a fetched page (trimmed) so tests can replay it. Returns nothing; updates index.json."""
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / name
        path.write_text(trim_html(result.body), encoding="utf-8")
        # Hash what replays will read (text-mode newline handling applies on both sides).
        self.index[result.url] = {
            "file": name,
            "status": result.status,
            "fetched_at": result.fetched_at,
            "content_sha256": sha256_text(path.read_text(encoding="utf-8")),
        }
        (self.directory / "index.json").write_text(json.dumps(self.index, indent=2, sort_keys=True) + "\n", encoding="utf-8")


_DROP = re.compile(r"<(script(?![^>]*ld\+json)|style|svg|noscript|iframe|nav|footer|header|form|select|picture)\b.*?</\1>", re.S | re.I)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_ATTRS = re.compile(r'\s(?:class|style|id|data-[\w-]+|aria-[\w-]+|role|tabindex|srcset|sizes|loading|onclick|target|rel|width|height)="[^"]*"', re.I)
_BLANK = re.compile(r"\n\s*\n+")
_SPACES = re.compile(r"[ \t]{2,}")


def trim_html(html: str) -> str:
    """Keep the text, links and JSON-LD of a page; drop scripts, styles, SVG, chrome and attributes.

    Recorded fixtures stay small while every extractor still sees what it would see live:
    visible text, `href` links and the JSON-LD blocks are untouched.
    """
    out = _COMMENT.sub("", html)
    out = _DROP.sub("", out)
    out = _ATTRS.sub("", out)
    return _BLANK.sub("\n", _SPACES.sub(" ", out))


__all__ = [
    "DEFAULT_CACHE_TTL_DAYS",
    "FetchResult",
    "Fetcher",
    "PoliteFetcher",
    "RecordedFetcher",
    "USER_AGENT",
    "sha256_text",
    "trim_html",
    "utc_now_iso",
]
