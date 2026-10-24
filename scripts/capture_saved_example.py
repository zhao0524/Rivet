#!/usr/bin/env python3
"""Capture the studio's saved demo build from the current engine (GATE-H30, issue #41).

The web studio opens the engine-sourced rover offline from two checked-in snapshots:

  apps/web/src/lib/rivet/fixtures/sourced-rover-obstacle-v1.json   BuildPlan
  apps/web/src/lib/rivet/fixtures/sourced-seed-components.json     catalog it resolves against

They go stale whenever the engine changes, so they are captured with this script, never
edited by hand. The plan is what `python -m rivet_engine.demo --sample` writes:
`rivet_engine.solve()` on the engine's built-in docs/implementation.md 3.1 sample intent.
Two changes keep it honest once it is served from a file: `provenance.generation_mode`
becomes "fixture" (a saved build, not a live run) and a first provenance note records the
capture. `created_at` keeps the engine's runtime UTC timestamp; the studio shows it as the
capture time. Status, findings, BOM, prices and links are the engine's, untouched. The
catalog is `rivet_engine.get_catalog()` as is.

Usage, from the repo root (standard library plus the engine in packages/engineering of this
checkout, imported from source; nothing is installed):

  python3 scripts/capture_saved_example.py            # rewrite both snapshots
  python3 scripts/capture_saved_example.py --check    # exit 1 if the committed copies are stale

`--check` captures in memory and compares, ignoring `created_at` and the capture note.
Exit codes: 0 written or up to date, 1 stale (--check), 2 the engine output is not what the
studio expects (build id, revision or catalog references).
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURES_DIR = REPO_ROOT / "apps" / "web" / "src" / "lib" / "rivet" / "fixtures"
PLAN_PATH = FIXTURES_DIR / "sourced-rover-obstacle-v1.json"
CATALOG_PATH = FIXTURES_DIR / "sourced-seed-components.json"
# apps/web/src/lib/fixtures.ts opens the snapshot by this id (SOURCED_ROVER_BUILD_ID).
EXPECTED_BUILD_ID = "rivet-intent-rover-001"
EXPECTED_REVISION = 1
CAPTURE_NOTE_PREFIX = "Saved demo build captured "

# Always this checkout's engine, even if another copy is installed or on PYTHONPATH.
sys.path.insert(0, str(REPO_ROOT / "packages" / "engineering"))

import rivet_engine  # noqa: E402
from rivet_engine.demo import SAMPLE_INTENT  # noqa: E402


def capture_note(plan: dict[str, Any]) -> str:
    return (
        f"{CAPTURE_NOTE_PREFIX}{plan['created_at']} by scripts/capture_saved_example.py from "
        "rivet_engine solve() on the built-in sample intent (python -m rivet_engine.demo --sample); "
        "a checked-in snapshot of real catalog parts, not a live generation"
    )


def expectation_errors(plan: dict[str, Any], catalog: list[dict[str, Any]]) -> list[str]:
    errors = []
    if plan.get("build_id") != EXPECTED_BUILD_ID:
        errors.append(f"build_id is {plan.get('build_id')!r}; the studio opens {EXPECTED_BUILD_ID!r}")
    if plan.get("revision") != EXPECTED_REVISION:
        errors.append(f"revision is {plan.get('revision')!r}; expected {EXPECTED_REVISION}")
    known = {c.get("catalog_id") for c in catalog}
    missing = sorted({c["catalog_id"] for c in plan.get("components", [])} - known)
    if missing:
        errors.append(f"plan uses catalog ids missing from get_catalog(): {missing}")
    return errors


def capture() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Engine plan and catalog, with the saved-build relabel applied to the plan."""
    plan = rivet_engine.solve(copy.deepcopy(SAMPLE_INTENT))
    catalog = rivet_engine.get_catalog()
    provenance = plan["provenance"]
    provenance["generation_mode"] = "fixture"
    provenance["notes"] = [capture_note(plan), *provenance["notes"]]
    return plan, catalog


def comparable(plan: dict[str, Any]) -> dict[str, Any]:
    """The plan minus what legitimately changes on every capture."""
    out = copy.deepcopy(plan)
    out.pop("created_at", None)
    provenance = out.get("provenance")
    if isinstance(provenance, dict):
        notes = provenance.get("notes", [])
        provenance["notes"] = [n for n in notes if not (isinstance(n, str) and n.startswith(CAPTURE_NOTE_PREFIX))]
    return out


def serialize(doc: Any) -> str:
    return json.dumps(doc, indent=2) + "\n"


def rel(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


def summary(plan: dict[str, Any], catalog: list[dict[str, Any]]) -> str:
    findings = plan["verification"]["findings"]
    counts = ", ".join(f"{sum(f['result'] == r for f in findings)} {r}" for r in ("PASS", "WARN", "FAIL", "UNKNOWN"))
    bom = plan["bom"]
    return (
        f"engine: {Path(rivet_engine.__file__).parent.relative_to(REPO_ROOT)} "
        f"(catalog {plan['provenance']['catalog_version']}, {len(catalog)} parts)\n"
        f"plan: {plan['build_id']} r{plan['revision']} created_at {plan['created_at']} status {plan['status']} ({counts})\n"
        f"parts {len(plan['components'])}, wires {len(plan['connections'])}, steps {len(plan['assembly_steps'])}, "
        f"BOM {bom['known_subtotal_amount']} {bom['currency']} ({bom['total_status']})"
    )


def check(plan: dict[str, Any], catalog: list[dict[str, Any]]) -> int:
    stale = []
    try:
        committed_plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
        committed_catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"stale: cannot read the committed snapshots ({exc})", file=sys.stderr)
        return 1
    new, old = comparable(plan), comparable(committed_plan)
    if new != old:
        keys = sorted(k for k in set(new) | set(old) if new.get(k) != old.get(k))
        stale.append(f"{rel(PLAN_PATH)} differs in {', '.join(keys)}")
    if catalog != committed_catalog:
        stale.append(f"{rel(CATALOG_PATH)} differs from rivet_engine.get_catalog()")
    if stale:
        for line in stale:
            print(f"stale: {line}", file=sys.stderr)
        print("re-capture with: python3 scripts/capture_saved_example.py", file=sys.stderr)
        return 1
    print(f"up to date (committed capture: {committed_plan.get('created_at')})")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="compare with the committed snapshots; write nothing")
    args = parser.parse_args(argv)

    plan, catalog = capture()
    errors = expectation_errors(plan, catalog)
    if errors:
        for err in errors:
            print(f"error: {err}", file=sys.stderr)
        return 2
    print(summary(plan, catalog))
    if args.check:
        return check(plan, catalog)
    PLAN_PATH.write_text(serialize(plan), encoding="utf-8")
    CATALOG_PATH.write_text(serialize(catalog), encoding="utf-8")
    print(f"wrote {rel(PLAN_PATH)} and {rel(CATALOG_PATH)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
