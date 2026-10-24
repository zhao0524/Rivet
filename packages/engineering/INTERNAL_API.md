# rivet_engine internal API (frozen for P1–P6)

Internal, Python-only boundaries between engine modules. Wire formats are defined only by
`rivet_engine/models.py` (which mirrors `docs/implementation.md` §3). Types named below live
in `rivet_engine/ports.py`. Changing a signature here needs a PR that updates every
affected task.

## Conventions

- **Units and frames:** millimetres, right-handed Y-up (`x` right, `y` up, `z` forward),
  XYZ Euler degrees, grams, volts/amps, money as decimal strings with an ISO currency.
- **Immutability:** no function mutates its arguments. Pydantic models passed in must
  be copied (`model_copy(deep=True)`) before any change.
- **Determinism:** same inputs → identical outputs and ordering. No network, clock,
  randomness or environment reads inside these functions (`created_at` is set only by
  the public `solve`/`apply_edit`).
- **Unknowns:** missing source data stays `None`, and dependent checks report `UNKNOWN`,
  never `PASS`.
- **Catalog is explicit:** every stage takes a `Catalog` argument; nothing loads the
  packaged catalog implicitly except `catalog.load_catalog()`.
- **Findings:** build them with `ports.finding(...)` so references are sorted and
  de-duplicated. `rule_id` is `<category>.<rule>` (e.g. `electrical.motor_driver_current`).
- **Synthetic data:** IDs starting with `demo.` or `synthetic.` are never real products
  (`CatalogComponent.is_synthetic`).

## Errors

All raise subclasses of `ports.EngineError` (`code`, `message`, `details`, `retryable`,
`http_status`, `to_envelope()` matching the API error envelope):

| Class | `code` | Use |
|---|---|---|
| `InvalidInputError` | `INVALID_INPUT` (400) | Schema-invalid intent, plan, operation or record |
| `UnsupportedRequestError` | `UNSUPPORTED_REQUEST` (422) | Valid but unsupported family, behavior or edit |
| `CatalogError` | `CATALOG_ERROR` (500) | Duplicate/unknown/malformed catalog data |
| `PlacementError` | `PLACEMENT_ERROR` (422) | Missing anchor, illegal mate, offset out of range |
| `EngineNotImplementedError` | `ENGINE_NOT_IMPLEMENTED` (503) | Stage not built yet; never a fake success |

Engineering problems with a design (bad current margin, missing price) are **findings**, not
exceptions. Exceptions are for inputs the stage cannot process at all.

## Stages

### P1 — `rivet_engine/catalog.py`

```python
def load_catalog(path: str | None = None) -> Catalog
def catalog_from_records(records: Iterable[dict], version: str) -> Catalog
CATALOG_VERSION: str
```

- `load_catalog()` with no path reads the packaged `data/components.json`. Offline only.
- Raises `CatalogError` for duplicate IDs, malformed records, or an unreadable file.
- File format: `{"schema_version": "1.0", "catalog_version": str, "components": [CatalogComponent]}`.

### P2 — `rivet_engine/mounts.py`

```python
def place_rover(selection: RoverSelection, catalog: Catalog,
                options: PlacementOptions = PlacementOptions()) -> PlacementResult
def world_aabb(instance: ComponentInstance, component: CatalogComponent) -> AABB | None
def compose(parent: Pose, mount: Mount) -> Pose            # helper, world = parent * mount
```

- Placement rule: `world_child = world_parent × parent_mount × inverse(child_mount)`.
- A mate is legal when the child mount's `kind` is in the parent mount's `allowed_mates`.
- Instance IDs are stable: `chassis-1`, `motor-left-1`, `motor-right-1`, `wheel-left-1`,
  `wheel-right-1`, `caster-1`, `controller-1`, `driver-1`, `sensor-1`, `power-motor-1`,
  `power-control-1`, then `accessory-<n>` for `selection.accessories` in order.
- Roles: `chassis`, `motor`, `wheel`, `caster`, `controller`, `motor_driver`,
  `distance_sensor`, `motor_power`, `controller_power`, `accessory`.
- `options.mount_offsets` outside the template range raise `PlacementError`.
- Missing anchors and illegal mates raise `PlacementError`; geometry that is only
  approximated is reported as an advisory finding.
- `world_aabb` returns conservative bounds of the rotated box, or `None` when the
  geometry cannot be bounded. It is injected into validators as `VerificationContext.bounds`.

### P3 — `rivet_engine/wiring.py`

```python
def wire_rover(components: Sequence[ComponentInstance], catalog: Catalog) -> WiringResult
```

- Works from the components' roles and catalog IDs; a data-driven wiring profile under
  `data/wiring_profiles/` must exist for the exact controller and driver catalog IDs.
- Connection IDs and ordering are deterministic. Every endpoint is a real catalog port.
- `pin_map` keys are the firmware signals used by `services/api` firmware:
  `motor_left_pwm`, `motor_left_in1`, `motor_left_in2`, `motor_right_pwm`,
  `motor_right_in1`, `motor_right_in2`, `motor_standby`, `i2c_sda`, `i2c_scl`.
  Values are controller GPIO numbers. A signal appears only if its connection exists.
- No profile, exhausted pins, missing evidence → findings (no invented GPIO).

### P4 — `rivet_engine/validators/`

```python
def verify_candidate(plan: BuildPlan, catalog: Catalog,
                     context: VerificationContext = VerificationContext()) -> VerificationReport
def aggregate(findings: Sequence[Finding]) -> PlanStatus
```

- Ignores `plan.verification` and `plan.status` on input.
- Findings are sorted by `(rule_id, affected_instance_ids, message)`.
- Aggregation: any blocking `FAIL` → `unbuildable`; else any blocking `UNKNOWN` →
  `needs_review`; else any `WARN`/`UNKNOWN`/advisory `FAIL` → `verified_with_warnings`;
  else `verified`.
- `context.bounds is None` makes overlap checks `UNKNOWN`. `context.requirements is None`
  makes budget checks not applicable (no finding).

### P5 — `rivet_engine/bom.py`, `assembly.py`, `serialize.py`

```python
def build_bom(components: Sequence[ComponentInstance], catalog: Catalog, currency: str = "USD") -> Bom
def build_assembly_steps(components: Sequence[ComponentInstance],
                         connections: Sequence[Connection], catalog: Catalog) -> list[AssemblyStep]
def plan_to_dict(plan: BuildPlan) -> dict
def plan_to_json(plan: BuildPlan) -> str           # deterministic, sorted keys, UTF-8, trailing newline
def plan_from_dict(data: dict) -> BuildPlan       # InvalidInputError on schema failure
```

- BOM rows grouped by `catalog_id` in ID order, `quantity == len(instance_ids)`.
- Mixed currencies raise nothing; they make the affected rows' prices excluded from the
  subtotal and `total_status = "incomplete"`.
- Steps: structural order from the parent graph, then wiring, then a check step; power
  connection only after the wiring check. Cycles raise `PlacementError`.

### P6 — `rivet_engine/repair.py`

```python
def repair_candidate(plan: BuildPlan, catalog: Catalog, *, rebuild: RebuildFn, verify: VerifyFn,
                     layout_options: LayoutOptionsFn | None = None, max_rounds: int = 3) -> RepairResult
```

- `RebuildFn(plan, action, catalog) -> BuildPlan` re-derives placement, wiring, BOM and
  steps after one `Substitution` or `OffsetCorrection`. `VerifyFn(plan, catalog) -> VerificationReport`.
- Tries actions in a stable order, re-verifies after each, keeps a change only if it
  removes a blocking failure without adding one. At most `max_rounds` rounds; repeated
  candidates stop the loop.
- Never edits catalog records, never promotes an unverified substitute, never drops
  findings. Returns the best truthful plan with its report and the attempt log.

### Verification context additions

`VerificationContext.fit_evidence` enables the `mechanical.fit_evidence` rule: documented pairs
PASS with their source, assumed pairs are UNKNOWN at the recorded severity, unlisted pairs are
advisory UNKNOWN. Public `verify()` always supplies it via `catalog.fit_evidence_for(catalog)`:
evidence transfers only to records identical to the packaged ones; a differing record makes
that pair a blocking UNKNOWN. `None` (internal builders on synthetic data) skips the rule.
`load_fit_evidence()` validates every field the rule reads (`status`, `note`, `source`, `severity`).

`VerificationContext.expected_position` (`mounts.expected_position`) enables
`mechanical.pose_consistency`: a mounted part more than 30 mm from where its parent mount puts it
FAILs. Without it the rule reports advisory UNKNOWN (not checked).

Other rules added in the defect fixes: BOM prices and purchase links must match the catalog
(`integrity.bom`), and budgets are computed from catalog prices only; supply over the rated
maximum is a blocking FAIL, under the minimum an advisory brown-out WARN; supply capacity must
cover documented loads (motor stall currents, documented input draws); each motor needs its own
pair of driver outputs (`electrical.motor_channels`); driver direction/standby inputs are required;
controller I2C pins get logic checks; mounted parts need mount references; size limits are
UNKNOWN when any part lacks bounds; behavior parameters are checked against
`validators.firmware.BEHAVIOR_BOUNDS` and the sensor range (`firmware.behavior_parameters`);
assembly steps must exist and cover every part.

Models reject NaN/inf numbers, non-positive dimensions, negative ratings and `created_at` values
that are not real ISO-8601 UTC timestamps. `load_catalog()` returns new objects on every call.

`budget.price_currency` reports every BOM row whose catalog price is in another currency
(excluded from the subtotal, never converted).

Placement marks loose kit items (`role == "accessory"`) with `render_overrides["visible"] = False`.

### P7 — `rivet_engine/__init__.py` (public)

```python
def solve(intent: dict) -> dict                                 # BuildPlan wire dict
def apply_edit(plan: dict, operation: dict) -> dict             # {"accepted", "plan"} | {"accepted": False, "finding"}
# apply_edit accepts only if the rebuilt, repaired plan adds no blocking FAIL (keyed by rule_id and
# affected instances) and still contains the part the edit asked for. A malformed engine_state note
# raises InvalidInputError. Budgets must be in the catalog price currency (USD).
def verify(plan: dict, catalog: dict | list | None = None) -> dict   # {"overall", "findings"}
def get_catalog() -> list[dict]
```

`verify`'s `catalog` is optional because `services/api` calls `verify(plan)`; `None`
uses the packaged catalog. `apply_edit` accepts the operations in
`services/api/rivet_api/agents/editor.py`.

Implemented in `configurator.py` (P7). `verify` also accepts a list of catalog dicts
or `{"catalog_version", "components"}`, and adds the wiring stage's findings. Edit state
that the BuildPlan contract has no field for (requested budget, template offsets) is
carried in a single `provenance.notes` entry starting `engine_state: ` followed by JSON.

## Test inputs (`tests/support`)

- `appendix_*()` — exact Appendix A catalog/plan and §3.1 intent.
- `synthetic_*()` — complete SYNTHETIC TEST-ONLY rover catalog and plan with full
  netlist; adversarial catalog IDs: `synthetic.driver_5v_logic`,
  `synthetic.driver_high_current`, `synthetic.motor_high_stall`, `synthetic.motor_unrated`,
  `synthetic.motor_eur`, `synthetic.controller_few_pins`, `synthetic.battery_18v`.
- `substitute(plan_dict, instance_ids, catalog_id)` — copy with swapped parts and BOM.
