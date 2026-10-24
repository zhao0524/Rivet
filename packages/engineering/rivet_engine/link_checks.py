"""Purchase-link check report: model, loader and the rules the BOM and validators share (issue #68).

`rivet_engine.verify_links` writes the report (`data/link_checks.json`). This module only reads
it and never touches the network, so `solve()`, `verify()` and the BOM stay offline.

The report is evidence, never a source of prices, stock or ratings: per catalog entry with a
purchase link it holds the latest automated check (HTTP status, final URL, UTC date, whether the
page named the SKU, price and stock signals). A check of a different URL or SKU than the catalog's
current record does not apply to it.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationError, field_validator, model_validator

from rivet_engine.models import CatalogComponent

LINK_CHECKS_PATH = Path(__file__).resolve().parent / "data" / "link_checks.json"
REPORT_SCHEMA_VERSION = "1.0"

# pass: final HTTP 200 and the page names the SKU. broken: 404/410, or a 200 page that no longer
# names the SKU. blocked: the vendor refused the checker. error: no verdict (network, 5xx, ...).
LinkCheckStatus = Literal["pass", "broken", "blocked", "error"]
StockText = Literal["in_stock", "out_of_stock", "backorder", "discontinued", "mixed", "none"]
GONE_STATUSES = frozenset({404, 410})

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_date(value: str | None) -> date | None:
    """Date part of an ISO date or UTC timestamp that the models already validated."""
    return None if value is None else date.fromisoformat(value[:10])


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class LinkCheck(_Strict):
    catalog_id: Annotated[str, Field(min_length=1)]
    sku: str | None
    purchase_url: Annotated[str, Field(min_length=1)]
    status: LinkCheckStatus
    http_status: Annotated[int, Field(ge=100, le=599)] | None
    final_url: str | None
    checked_at: str  # UTC date of the check, YYYY-MM-DD
    sku_found: StrictBool | None
    catalog_price_found: StrictBool | None
    stock_text: StockText | None
    flags: list[str]
    detail: str

    @field_validator("checked_at")
    @classmethod
    def _real_date(cls, value: str) -> str:
        if not _DATE.fullmatch(value):
            raise ValueError(f"checked_at must be YYYY-MM-DD: {value!r}")
        date.fromisoformat(value)
        return value

    @model_validator(mode="after")
    def _status_matches_evidence(self) -> LinkCheck:
        # A hand-edited or corrupted entry must not claim more than its evidence shows.
        if self.status == "pass" and (self.http_status != 200 or self.sku_found is not True):
            raise ValueError("a pass needs HTTP 200 and the SKU found on the page")
        if self.status == "broken" and not (
            self.http_status in GONE_STATUSES or (self.http_status == 200 and self.sku_found is False)
        ):
            raise ValueError("broken means HTTP 404/410, or HTTP 200 without the SKU on the page")
        return self


class LinkReport(_Strict):
    schema_version: Literal["1.0"]
    catalog_version: Annotated[str, Field(min_length=1)]
    results: list[LinkCheck]

    @model_validator(mode="after")
    def _one_entry_per_part(self) -> LinkReport:
        ids = [r.catalog_id for r in self.results]
        if len(ids) != len(set(ids)):
            raise ValueError("results list a catalog_id more than once")
        return self


def dump_report(report: LinkReport) -> str:
    """Deterministic JSON: results in catalog_id order, sorted keys, trailing newline."""
    data = report.model_dump(mode="json")
    data["results"] = sorted(data["results"], key=lambda r: r["catalog_id"])
    return json.dumps(data, indent=2, sort_keys=True) + "\n"


@dataclass(frozen=True)
class LinkChecks:
    """The latest report as the engine uses it. `problem` is set (and there are no entries)
    when a report file exists but could not be used."""

    entries: Mapping[str, LinkCheck] = field(default_factory=dict)
    problem: str | None = None

    @classmethod
    def from_report(cls, report: LinkReport) -> LinkChecks:
        return cls({r.catalog_id: r for r in report.results})

    def entry_for(self, component: CatalogComponent) -> LinkCheck | None:
        """The latest check of this component's current purchase link and SKU, if any."""
        entry = self.entries.get(component.catalog_id)
        if entry is None or component.sourcing.purchase_url is None:
            return None
        if entry.purchase_url != component.sourcing.purchase_url or entry.sku != component.identity.sku:
            return None
        return entry

    def broken_entry(self, component: CatalogComponent) -> LinkCheck | None:
        """The check that found this link broken, unless the catalog re-verified the link after it."""
        entry = self.entry_for(component)
        if entry is None or entry.status != "broken":
            return None
        verified = parse_date(component.sourcing.purchase_url_verified_at)
        if verified is not None and verified > parse_date(entry.checked_at):
            return None
        return entry


def load_link_checks(path: str | Path | None = None) -> LinkChecks | None:
    """Read the link-check report (the packaged one by default).

    Returns None when there is no report file: then only catalog verification dates count.
    Fails safe on a file that cannot be read or does not validate: a LinkChecks with no
    entries (nothing is refreshed, confirmed or marked broken by it) and `problem` saying why.
    Never raises for file content.
    """
    target = Path(path) if path is not None else LINK_CHECKS_PATH
    try:
        text = target.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError) as exc:
        return LinkChecks(problem=f"cannot read {target.name}: {getattr(exc, 'strerror', None) or exc}")
    try:
        report = LinkReport.model_validate_json(text)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"]) or "file"
        return LinkChecks(problem=f"{target.name} is malformed ({where}: {first['msg']})")
    return LinkChecks.from_report(report)


__all__ = [
    "GONE_STATUSES",
    "LINK_CHECKS_PATH",
    "LinkCheck",
    "LinkChecks",
    "LinkReport",
    "dump_report",
    "load_link_checks",
    "parse_date",
]
