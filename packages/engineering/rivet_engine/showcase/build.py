"""Build the showcase fixtures from the manifest (plan-showcase.md 3.2 and 3.3).

Live runs fetch politely; `record=True` saves every page under `<out>/recorded/` in the
`tests/support/recorded` index format; `replay=True` reads only those pages and reproduces
`products/*.json`, `index.json` and `offers/*.json` byte for byte.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rivet_engine.showcase.ingest import ingest
from rivet_engine.showcase.models import ManifestEntry, Rejection, ShowcaseIndex, ShowcaseProduct
from rivet_engine.showcase.offers import direct_offers
from rivet_engine.sourcing.evidence import parse_utc
from rivet_engine.sourcing.fetch import FetchResult, Fetcher, PoliteFetcher, RecordedFetcher, sha256_text
from rivet_engine.sourcing.record import file_name

_DROP = re.compile(r"<(script(?![^>]*ld\+json)|style|svg|noscript|iframe|picture)\b.*?</\1>", re.S | re.I)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_BLANK = re.compile(r"\n\s*\n+")
_SAFE_NAME = re.compile(r"[^a-z0-9._-]+")
RECORDABLE_STATUSES = (200, 404)


def trim_source_html(html: str) -> str:
    """Drop scripts (except JSON-LD), styles, SVG and comments but keep every tag attribute,
    since the parts-list extractors read classes and data attributes of navigation blocks."""
    return _BLANK.sub("\n", _DROP.sub("", _COMMENT.sub("", html)))


class RecordingFetcher:
    """Fetches through `inner` and records each readable response as a replayable page.

    The result handed back is the recorded (trimmed) page, so hashes computed during the live
    build equal those a replay computes."""

    def __init__(self, inner: Fetcher, directory: Path | str):
        self.inner = inner
        self.store = RecordedFetcher(directory)
        self.recorded: list[str] = []
        self.failed: list[tuple[str, str]] = []

    def fetch(self, url: str) -> FetchResult:
        if url in self.store.index:
            return self.store.fetch(url)
        result = self.inner.fetch(url)
        # Like PoliteFetcher's cache, only 200 and 404 are stable answers; a 429, 403 or 5xx is
        # retried on the next run instead of being replayed as the page forever.
        if result.error or result.blocked or result.status not in RECORDABLE_STATUSES:
            self.failed.append((url, result.error or ("blocked" if result.blocked else f"HTTP {result.status}")))
            return result
        name = file_name(url)
        path = self.store.directory / name
        self.store.directory.mkdir(parents=True, exist_ok=True)
        path.write_text(trim_source_html(result.body), encoding="utf-8")
        body = path.read_text(encoding="utf-8")
        self.store.index[url] = {"file": name, "status": result.status, "fetched_at": result.fetched_at, "content_sha256": sha256_text(body)}
        (self.store.directory / "index.json").write_text(json.dumps(self.store.index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        self.recorded.append(url)
        return FetchResult(url, result.status, body, result.fetched_at, sha256_text(body))


def dump(doc: dict[str, Any]) -> str:
    return json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def offers_file_name(normalized_key: str) -> str:
    return _SAFE_NAME.sub("_", normalized_key.casefold()) + ".json"


def load_manifest(path: Path) -> list[ManifestEntry]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    entries = [ManifestEntry.model_validate(c) for c in doc.get("candidates", [])]
    return sorted(entries, key=lambda e: e.product_id)


@dataclass
class BuildReport:
    accepted: list[ShowcaseProduct] = field(default_factory=list)
    rejected: list[Rejection] = field(default_factory=list)
    offer_files: list[Path] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)


def _load_products(products_dir: Path) -> dict[str, ShowcaseProduct]:
    out: dict[str, ShowcaseProduct] = {}
    for path in sorted(products_dir.glob("*.json")):
        product = ShowcaseProduct.model_validate(json.loads(path.read_text(encoding="utf-8")))
        out[product.product_id] = product
    return out


def _load_rejected(path: Path) -> dict[str, Rejection]:
    if not path.exists():
        return {}
    return {r["product_id"]: Rejection.model_validate(r) for r in json.loads(path.read_text(encoding="utf-8"))}


def make_fetcher(out: Path, *, record: bool, replay: bool) -> Fetcher:
    if replay:
        return RecordedFetcher(out / "recorded")
    live = PoliteFetcher(out / ".cache")
    return RecordingFetcher(live, out / "recorded") if record else live


def build(
    manifest: Path,
    out: Path,
    *,
    fetcher: Fetcher | None = None,
    record: bool = False,
    offers: bool = False,
    replay: bool = False,
    only: set[str] | None = None,
    limit: int | None = None,
) -> BuildReport:
    """Ingest the manifest into `out/` (products, index, rejected and optionally offers).

    Candidates not selected by `only`/`limit` keep their previous result on disk, so the index
    and rejected list always cover everything built so far."""
    out = Path(out)
    fetcher = fetcher or make_fetcher(out, record=record, replay=replay)
    entries = load_manifest(Path(manifest))
    if only:
        entries = [e for e in entries if e.product_id in only]
    if limit is not None:
        entries = entries[:limit]
    products_dir = out / "products"
    products_dir.mkdir(parents=True, exist_ok=True)
    products = _load_products(products_dir)
    rejected = _load_rejected(out / "rejected.json")
    report = BuildReport()

    for entry in entries:
        outcome = ingest(entry, fetcher)
        if isinstance(outcome, Rejection):
            rejected[entry.product_id] = outcome
            products.pop(entry.product_id, None)
            stale_file = products_dir / f"{entry.product_id}.json"
            if stale_file.exists():
                stale_file.unlink()
            report.rejected.append(outcome)
            report.lines.append(f"rejected {entry.product_id}: {outcome.reason}: {outcome.details[:160]}")
            continue
        products[entry.product_id] = outcome
        rejected.pop(entry.product_id, None)
        (products_dir / f"{entry.product_id}.json").write_text(dump(outcome.to_wire()), encoding="utf-8")
        report.accepted.append(outcome)
        report.lines.append(
            f"accepted {entry.product_id}: parts {outcome.totals.parts_verified}/{outcome.totals.parts_total} verified"
            + (f", {len(outcome.unsourced_parts)} unsourced" if outcome.unsourced_parts else "")
        )

    ordered = [products[k] for k in sorted(products)]
    generated_at = max((p.generated_at for p in ordered), default=None) or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = ShowcaseIndex(generated_at=generated_at, products=[p.index_entry() for p in ordered])
    (out / "index.json").write_text(dump(index.to_wire()), encoding="utf-8")
    (out / "rejected.json").write_text(dump([rejected[k].to_wire() for k in sorted(rejected)]), encoding="utf-8")

    if offers:
        offers_dir = out / "offers"
        offers_dir.mkdir(parents=True, exist_ok=True)
        written: set[str] = set()
        for product in (report.accepted if (only or limit is not None) else ordered):
            for part in product.parts:
                offer_set = direct_offers(part, fetcher, parse_utc(product.generated_at))
                name = offers_file_name(offer_set.query.normalized_key)
                if name in written:
                    continue
                written.add(name)
                path = offers_dir / name
                path.write_text(dump(offer_set.to_wire()), encoding="utf-8")
                report.offer_files.append(path)
    return report


__all__ = ["BuildReport", "RecordingFetcher", "build", "dump", "load_manifest", "make_fetcher", "offers_file_name", "trim_source_html"]
