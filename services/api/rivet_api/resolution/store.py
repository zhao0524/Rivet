"""File-backed storage for resolutions and their evidence ledger.

One JSON file per resolution, written atomically and never modified afterwards, so a stored
answer can be audited later: the sources fetched, when, and their content hashes are in it.
"""

import json
import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any

from rivet_api.errors import ApiError

_ID_RE = re.compile(r"^res-[0-9a-f]{12}$")


class ResolutionStore:
    def __init__(self, root: Path):
        self.root = Path(root)

    @staticmethod
    def new_id() -> str:
        return f"res-{uuid.uuid4().hex[:12]}"

    def save(self, record: dict[str, Any]) -> None:
        resolution_id = record["resolution_id"]
        if not _ID_RE.match(resolution_id):
            raise ValueError("bad resolution id")
        self.root.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.root, prefix=".tmp-", suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump(record, f, indent=2)
        os.replace(tmp, self.root / f"{resolution_id}.json")

    def get(self, resolution_id: str) -> dict[str, Any]:
        if not isinstance(resolution_id, str) or not _ID_RE.match(resolution_id):
            raise ApiError("RESOLUTION_NOT_FOUND", "No such resolution", 404)
        try:
            return json.loads((self.root / f"{resolution_id}.json").read_text())
        except (OSError, ValueError):
            raise ApiError("RESOLUTION_NOT_FOUND", "No such resolution", 404) from None
