#!/usr/bin/env python3
"""Golden set and adversarial cases for verified parts (plan section 6, issue #87).

    python scripts/golden_verified_parts.py          # offline, recorded pages only

Exit 1 if any product gets the wrong outcome, any part count is below its floor, or any
fabricated SKU (adversarial case) ends up `verified`. Needs rivet_engine importable.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "engineering"))

from rivet_engine.sourcing import ManufacturerPageAdapter, RecordedFetcher, decompose, verify_product  # noqa: E402

RECORDED = ROOT / "packages" / "engineering" / "tests" / "support" / "recorded"
GOLDEN = ROOT / "fixtures" / "golden" / "verified_parts.json"


def main() -> int:
    data = json.loads(GOLDEN.read_text())
    fetcher = RecordedFetcher(RECORDED)
    now = datetime(2026, 10, 25, tzinfo=timezone.utc)
    failures: list[str] = []
    for case in data["products"]:
        dec = decompose(case["url"], fetcher, now=now)
        counts = dec.counts
        ok = dec.outcome == case["outcome"] and counts["verified"] >= case.get("min_verified", 0) and counts["not_found"] >= case.get("min_not_found", 0)
        if dec.outcome != "no_match_with_alternatives":
            sku = next((p.sku.value for p in dec.parts if p.sku and p.sku.status == "verified"), None)
            ok = ok and (dec.outcome == "partial_match" or sku == case["expected_sku"])
        print(f"{'ok  ' if ok else 'FAIL'} {case['id']}: {dec.outcome} {counts}")
        if not ok:
            failures.append(case["id"])
    for case in data["adversarial"]:
        lookup = ManufacturerPageAdapter(case["url"]).lookup(case["claimed_sku"], fetcher)
        verdicts = verify_product(lookup.evidence, sku=case["claimed_sku"], brand=case.get("claimed_brand"), now=now)
        status = verdicts["sku"].status
        ok = status == case["expect"] and status != "verified"
        print(f"{'ok  ' if ok else 'FAIL'} adversarial {case['id']}: sku={status} ({verdicts['sku'].reason or lookup.reason})")
        if not ok:
            failures.append(case["id"])
    print(f"\n{len(failures)} failure(s)" if failures else "\ngolden set passed: no fabricated SKU is verified")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
