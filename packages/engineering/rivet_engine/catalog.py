"""Packaged, source-backed component catalog (B1).

Loading is offline and deterministic: it reads one JSON file, validates every record
against the canonical CatalogComponent model, and rejects duplicates. Presence in the
catalog says nothing about cross-part compatibility; validators decide that.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from functools import cache
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from rivet_engine.models import CatalogComponent
from rivet_engine.ports import Catalog, CatalogError

DATA_PATH = Path(__file__).resolve().parent / "data" / "components.json"
CATALOG_VERSION = "catalog-v1-2026-10-24"


def catalog_from_records(records: Iterable[dict[str, Any]], version: str) -> Catalog:
    components = []
    errors: list[str] = []
    for index, record in enumerate(records):
        try:
            components.append(CatalogComponent.model_validate(record))
        except ValidationError as exc:
            cid = record.get("catalog_id", f"#{index}") if isinstance(record, dict) else f"#{index}"
            errors += [f"{cid}: {'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
    if errors:
        raise CatalogError("Malformed catalog record(s)", {"errors": errors})
    return Catalog(version, tuple(components))


@cache
def _load(path: str) -> Catalog:
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, ValueError) as exc:
        raise CatalogError(f"Cannot read catalog file {path}", {"reason": str(exc)}) from exc
    if not isinstance(data, dict) or data.get("schema_version") != "1.0" or not isinstance(data.get("components"), list):
        raise CatalogError("Catalog file must be {schema_version: '1.0', catalog_version, components: [...]}")
    version = data.get("catalog_version")
    if not isinstance(version, str) or not version:
        raise CatalogError("Catalog file has no catalog_version")
    return catalog_from_records(data["components"], version)


def load_catalog(path: str | None = None) -> Catalog:
    """Load the packaged catalog (or another file in the same format)."""
    return _load(str(Path(path).resolve()) if path else str(DATA_PATH))
