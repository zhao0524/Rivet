"""Write the v2 design contracts in contracts/ from their Pydantic models.

    services/api/.venv/bin/python scripts/export_design_schemas.py [--check]

design-spec.v2 comes from rivet_engine.design_ir; the bundle, event, visual-review and
fabricated-part schemas come from rivet_api.design.models. --check exits 1 when a file
is out of date (used by tests and CI).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "packages" / "engineering"), str(ROOT / "services" / "api")]


def schemas() -> dict[str, dict]:
    from rivet_engine.design_ir.models import json_schema

    out = {"design-spec.v2.schema.json": json_schema()}
    try:
        from rivet_api.design.models import contract_schemas
    except ImportError:
        return out
    out.update(contract_schemas())
    return out


def main(argv: list[str]) -> int:
    check = "--check" in argv
    stale = []
    for name, schema in schemas().items():
        path = ROOT / "contracts" / name
        text = json.dumps(schema, indent=2, sort_keys=True) + "\n"
        if check:
            if not path.exists() or path.read_text() != text:
                stale.append(name)
        else:
            path.write_text(text)
            print(f"wrote contracts/{name}")
    if stale:
        print("out of date: " + ", ".join(stale) + " (run scripts/export_design_schemas.py)")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
