#!/usr/bin/env python3
"""Optional firmware compile check for CI (INT-3).

Renders the ESP32 rover PlatformIO project from a BuildPlan with the API's own
firmware generator (`rivet_api.firmware.generate`), writes it to --out, then runs
the API's bounded `compile_firmware` (`pio run`) on it.

Statuses follow the firmware contract: `passed`, `failed`, or `not_checked` when
PlatformIO is not installed. `not_checked` is never reported as a pass.

Usage (from the repo root; the plan usually comes from the engine demo):
  uv run --project packages/engineering python -m rivet_engine.demo --sample --output plan.json
  uv run --project services/api python scripts/ci_firmware_check.py --plan plan.json --out fw

Exit codes: 0 passed or not_checked, 1 compile failed, 2 firmware refused for this plan.
Writes a Markdown summary to $GITHUB_STEP_SUMMARY when it is set.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "services" / "api"))

from rivet_api.errors import ApiError  # noqa: E402
from rivet_api.firmware.compile import CompileResult, compile_firmware  # noqa: E402
from rivet_api.firmware.generate import generate_firmware  # noqa: E402


def write_project(plan: dict, out: Path) -> list[str]:
    bundle = generate_firmware(plan)
    out.mkdir(parents=True, exist_ok=True)
    for name, data in bundle.files.items():
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return sorted(bundle.files)


def summarize(plan: dict, result: CompileResult) -> str:
    lines = [
        "### Firmware compile (optional)",
        "",
        f"- Build: `{plan.get('build_id')}` revision {plan.get('revision')} (plan status `{plan.get('status')}`)",
        f"- Compile status: **`{result.status}`**: {result.summary}",
    ]
    if result.log_tail:
        lines += ["", "<details><summary>pio log tail</summary>", "", "```", result.log_tail, "```", "</details>"]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--plan", type=Path, required=True, help="BuildPlan JSON")
    parser.add_argument("--out", type=Path, required=True, help="directory for the generated PlatformIO project")
    parser.add_argument("--timeout", type=int, default=1200, help="pio run timeout in seconds (first run downloads the toolchain)")
    args = parser.parse_args(argv)

    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    try:
        files = write_project(plan, args.out)
    except ApiError as exc:
        print(f"firmware refused: {exc.code}: {exc.message}", file=sys.stderr)
        return 2
    print(f"generated {len(files)} files in {args.out}: {', '.join(files)}")

    result = compile_firmware(args.out.resolve(), timeout_s=args.timeout)
    print(f"compile_status: {result.status} ({result.summary})")
    if result.log_tail:
        print(result.log_tail)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write(summarize(plan, result))
    return 1 if result.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
