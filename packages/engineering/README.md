# rivet_engine

Developer B's engineering engine: a pure, offline Python package that turns an
`IntentSpec` into a complete, catalog-backed rover `BuildPlan`, verifies it with
deterministic rules, repairs what it can, and applies edits as new revisions. It never
calls a model, the network or the renderer.

## Setup and checks

```bash
cd packages/engineering
uv sync                      # Python 3.11+, installs pydantic + pytest
uv run pytest -q             # full offline suite
```

Without uv: `python3.11 -m venv .venv && .venv/bin/pip install -e '.[dev]' && .venv/bin/pytest -q`.

## Demo

```bash
uv run python -m rivet_engine.demo --sample --output /tmp/rivet-plan.json
uv run python -m rivet_engine.demo --intent ../../fixtures/intent/rover_obstacle_v1.json --output /tmp/rivet-plan.json
uv run python -m rivet_engine.demo --sample --max-budget 60 --output /tmp/rivet-fail.json   # failing case
```

`--sample` uses the §3.1 example intent built into `demo.py`. A missing `--intent` file
is an error (exit 2), never silently replaced. Unsupported requests exit 3 with the
error envelope on stderr.

## Public API (what services/api calls)

```python
from rivet_engine import solve, apply_edit, verify, get_catalog

plan = solve(intent_dict)                        # BuildPlan dict
result = apply_edit(plan, {"op": "set_mount_offset_within_template",
                           "instance_id": "sensor-1", "offset_mm": [0, 15, 0]})
# -> {"accepted": True, "plan": {... revision + 1 ...}}  or  {"accepted": False, "finding": {...}}
report = verify(plan)                            # {"overall", "findings"}; catalog optional
catalog = get_catalog()                          # list of CatalogComponent dicts
```

Edit operations: `set_budget`, `set_behavior_parameter`, `replace_optional_sensor`,
`set_mount_offset_within_template` (sensor height −10…+25 mm), `change_appearance_color`.
Errors raise `rivet_engine.EngineError` subclasses with `.to_envelope()` in the API
error format (`INVALID_INPUT` 400, `UNSUPPORTED_REQUEST` 422, ...).

## What the default rover is

16-part sourced catalog (`rivet_engine/data/components.json`, sources in
`data/catalog_sources.md`): Espressif ESP32-DevKitC V4, Adafruit TB6612 driver, two
Adafruit TT motors and wheels, SparkFun Shadow Chassis (nub caster and 4xAA holder
included), Adafruit VL53L0X ToF sensor, Adafruit USB power bank, breadboard, wires,
cables, a DC jack adapter and alkaline AA cells. Priced BOM: **105.45 USD** (list prices on 2026-10-24).

Result today: **`unbuildable`**. The engine returns a complete, inspectable design with blocking findings, not a build-ready rover:

- TT motor stall current (1.5 A at 6 V) exceeds the TB6612's 1.2 A continuous rating (3 A peak for ~20 ms).
- The ESP32 board was out of stock at Adafruit when checked.
- No source documents the TT motor fitting the Shadow Chassis motor mounts (SparkFun's guide uses the
  Hobby Gearmotor ROB-13302): blocking UNKNOWN from `mechanical.fit_evidence`.
- Battery voltage (3.2–6.4 V) comes from the listed alkaline cells (1.6 V fresh to 0.8 V dead). Fresh cells
  exceed the motors' 6 V rated maximum (blocking FAIL); near empty they drop below the driver's 4.5 V VM
  minimum (advisory brown-out WARN). Holder current capacity is unknown.
- Mount coordinates and the chassis box are approximated, not measured CAD.

Physical fit is tracked separately from mount geometry in `data/fit_evidence.json`: matching mount
kinds only model geometry, and a fit counts as documented only with a cited source.

## Layout

| Module | Role |
|---|---|
| `models.py` | Canonical wire models (extra keys forbidden) |
| `ports.py` | Internal types, stage protocols, `EngineError` classes |
| `catalog.py` | Offline catalog loader |
| `mounts.py` + `data/templates/rover_2wd.json` | Placement transforms, rotated bounds |
| `wiring.py` + `data/wiring_profiles/` | Netlist and GPIO allocation per exact board/driver |
| `validators/` | Integrity, requirements, mechanical, electrical, budget, firmware rules |
| `bom.py`, `assembly.py`, `serialize.py` | BOM, ordered steps, deterministic JSON |
| `repair.py` | Bounded (≤3 rounds) substitution/layout repair via injected callbacks |
| `configurator.py` | Composition, simulation fields, edits |
| `demo.py` | CLI |

Internal signatures: `INTERNAL_API.md`. Test inputs: `tests/support/` (Appendix A
copies and clearly labeled SYNTHETIC test data).

## Limits

- One template (`rover_2wd.v1`) and one firmware profile (`rover.obstacle_avoidance.v1`).
- Geometry checks use boxes; overlaps are advisory heuristics.
- Stall current above the documented continuous driver rating blocks the build; peak ratings alone do not establish a supported stall duration.
- Simulation speed (0.25 m/s) and sensor model are labeled nominal values.
- `firmware.compile_status` is never `passed` here; compiling is services/api's job.
- Edits are accepted only if they add no new blocking FAIL and keep the part the edit asked for;
  otherwise `apply_edit` returns `{"accepted": false, "finding": ...}`. BOM prices stay in USD; a
  budget in another currency is rejected for edits and reported UNKNOWN at solve time.
- Loose kit items (wires, cells, breadboard, adapter) carry `render_overrides.visible = false`;
  they have no modeled 3D position.
- Edit state (budget, sensor offset) rides in one `engine_state:` line in `provenance.notes`,
  because the BuildPlan contract has no field for it.
