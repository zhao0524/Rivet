"""Standalone engine demo (B7).

    python -m rivet_engine.demo --intent fixtures/intent/rover_obstacle_v1.json --output /tmp/rivet-plan.json
    python -m rivet_engine.demo --sample --output /tmp/rivet-plan.json            # built-in §3.1 intent
    python -m rivet_engine.demo --sample --max-budget 60 --output /tmp/fail.json   # failing budget case

Exit codes: 0 plan written (whatever its status), 2 bad input or unwritable output, 3 unsupported request.
The intent file is never silently replaced: if it is missing, the run fails and says so.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import rivet_engine
from rivet_engine.ports import EngineError, UnsupportedRequestError

# docs/implementation.md section 3.1 example intent, used only with --sample.
SAMPLE_INTENT = {
    "schema_version": "1.0",
    "intent_id": "intent-rover-001",
    "input": {
        "kind": "image_and_text",
        "image_asset_id": "asset-rover-reference-001",
        "user_text": "Build a small rover that avoids obstacles",
        "image_interpretation_is_approximate": True,
    },
    "project_family": "rover",
    "requested_behavior": "obstacle_avoidance",
    "visual_features": ["compact chassis", "two visible drive wheels", "front-facing range sensor"],
    "requirements": {
        "max_budget": None,
        "currency": "USD",
        "max_length_mm": None,
        "max_width_mm": None,
        "preferred_controller_catalog_id": "board.esp32_devkit_v1",
        "required_capabilities": ["differential_drive", "distance_sensing"],
        "preferred_color": "charcoal",
    },
    "assumptions": ["Hidden electronics are not inferable from the image"],
    "unknowns": ["Actual source robot dimensions", "Motor and battery specifications"],
    "confidence": "medium",
    "support_status": "supported",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m rivet_engine.demo", description=__doc__.split("\n")[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--intent", type=Path, help="IntentSpec JSON file")
    source.add_argument("--sample", action="store_true", help="use the built-in section 3.1 sample intent")
    parser.add_argument("--output", type=Path, required=True, help="where to write the BuildPlan JSON")
    parser.add_argument("--max-budget", help="override requirements.max_budget (decimal string)")
    args = parser.parse_args(argv)

    if args.sample:
        intent, label = json.loads(json.dumps(SAMPLE_INTENT)), "built-in sample intent (docs/implementation.md 3.1)"
    else:
        if not args.intent.exists():
            print(f"error: intent file {args.intent} not found (use --sample for the built-in example)", file=sys.stderr)
            return 2
        try:
            intent, label = json.loads(args.intent.read_text()), str(args.intent)
        except OSError as exc:
            print(f"error: cannot read {args.intent}: {exc.strerror or exc}", file=sys.stderr)
            return 2
        except ValueError as exc:
            print(f"error: {args.intent} is not JSON: {exc}", file=sys.stderr)
            return 2
    if args.max_budget is not None and isinstance(intent, dict) and isinstance(intent.get("requirements"), dict):
        intent["requirements"]["max_budget"] = args.max_budget

    try:
        plan = rivet_engine.solve(intent)
    except UnsupportedRequestError as err:
        print(json.dumps(err.to_envelope(), indent=2), file=sys.stderr)
        return 3
    except EngineError as err:
        print(json.dumps(err.to_envelope(), indent=2), file=sys.stderr)
        return 2

    try:
        args.output.write_text(json.dumps(plan, sort_keys=True, indent=2) + "\n")
    except OSError as exc:
        print(f"error: cannot write {args.output}: {exc.strerror or exc}", file=sys.stderr)
        return 2
    findings = plan["verification"]["findings"]
    counts = {r: sum(1 for f in findings if f["result"] == r) for r in ("PASS", "WARN", "FAIL", "UNKNOWN")}
    print(f"intent: {label}", file=sys.stderr)
    print(f"status: {plan['status']}  ({', '.join(f'{v} {k}' for k, v in counts.items())})", file=sys.stderr)
    print(
        f"parts: {len(plan['components'])}  wires: {len(plan['connections'])}  steps: {len(plan['assembly_steps'])}  "
        f"BOM: {plan['bom']['known_subtotal_amount']} {plan['bom']['currency']} ({plan['bom']['total_status']})",
        file=sys.stderr,
    )
    for f in findings:
        if f["result"] != "PASS":
            print(f"  {f['result']:<7} {f['severity']:<8} {f['rule_id']}: {f['message']}", file=sys.stderr)
    print(f"wrote {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
