"""Record vendor pages as offline fixtures.

    python -m rivet_engine.sourcing.record <fixtures_dir> <url> [<url> ...]

Fetches each URL politely (robots.txt, rate limit, identifying UA), trims scripts/styles and
stores the page plus its status, fetch time and content hash in `<fixtures_dir>/index.json`.
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

from rivet_engine.sourcing.fetch import PoliteFetcher, RecordedFetcher


def file_name(url: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", url.split("://", 1)[-1].lower()).strip("_")[:120] + ".html"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    store = RecordedFetcher(argv[0])
    fetcher = PoliteFetcher(Path(tempfile.gettempdir()) / "rivet-sourcing-cache", ttl_days=1)
    failed = 0
    for url in argv[1:]:
        result = fetcher.fetch(url)
        if result.error:
            print(f"FAIL {url}: {result.error}")
            failed += 1
            continue
        store.record(result, file_name(url))
        print(f"{result.status} {url} -> {file_name(url)} ({len(result.body)} bytes before trim)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
