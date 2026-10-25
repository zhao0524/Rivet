"""Build the showcase catalogue fixtures.

    python -m rivet_engine.showcase build --manifest fixtures/showcase/manifest.json --out fixtures/showcase \\
        [--record] [--offers] [--replay] [--only id,id] [--limit n]

Live mode fetches through `PoliteFetcher(<out>/.cache)`. `--record` saves every page under
`<out>/recorded/`; `--replay` rebuilds offline from those pages. Exit 0 even when candidates
are rejected (they are listed in `<out>/rejected.json`); exit 1 only on a crash.
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

from rivet_engine.showcase.build import build


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m rivet_engine.showcase", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("build", help="ingest the manifest into products, index, rejected and offers")
    cmd.add_argument("--manifest", type=Path, required=True)
    cmd.add_argument("--out", type=Path, required=True)
    cmd.add_argument("--record", action="store_true", help="save every fetched page under <out>/recorded")
    cmd.add_argument("--offers", action="store_true", help="also write direct-vendor offer sets under <out>/offers")
    cmd.add_argument("--replay", action="store_true", help="offline: read pages from <out>/recorded only")
    cmd.add_argument("--only", type=str, default=None, help="comma-separated product ids to build")
    cmd.add_argument("--limit", type=int, default=None, help="build at most this many candidates")
    args = parser.parse_args(argv)
    if args.record and args.replay:
        parser.error("--record and --replay are exclusive")
    try:
        report = build(
            args.manifest,
            args.out,
            record=args.record,
            offers=args.offers,
            replay=args.replay,
            only={s.strip() for s in args.only.split(",") if s.strip()} if args.only else None,
            limit=args.limit,
        )
    except Exception:  # noqa: BLE001 - the CLI reports any crash and exits 1
        traceback.print_exc()
        return 1
    for line in report.lines:
        print(line)
    print(f"{len(report.accepted)} accepted, {len(report.rejected)} rejected" + (f", {len(report.offer_files)} offer sets" if args.offers else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
