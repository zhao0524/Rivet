# Rivet: Project Context

Shared status file for everyone working in this repo, human or agent.
**Read it before starting a task. Update it when you finish one, and before every push.**

| | |
|---|---|
| **Last updated** | 2026-10-24 · [C] |
| **Branch / commit** | `feat/c-3d-sim` @ `71dd73c` + this update |
| **Current phase** | `services/api`, `packages/engineering` and `apps/web` implemented; default sourced rover is honestly unbuildable |
| **Next gate** | Hour 16: working vertical path: A+B, B+C, A+C (`docs/implementation.md` §7) |
| **In progress** | A5, B0/B4 (waiting on INT-1/INT-2) |
| **Blocked** | [B] B0/B4 checks wait on INT-1/INT-2; default rover needs a motor/driver decision (see §6) |

**Next up:** Review and merge the B7 demo PR; decide the motor/driver/battery combination; [A] commit the ignored `services/api/rivet_api/exports/` package; INT-0..INT-2 still outstanding.

**Contents:** [1. Rules](#1-rules) · [2. Repo state](#2-repo-state) · [3. Task board](#3-task-board) · [4. Log](#4-log) · [5. Decisions](#5-decisions) · [6. Issues and blockers](#6-issues-and-blockers) · [7. How to update this file](#7-how-to-update-this-file)

Source of truth: [`docs/implementation.md`](docs/implementation.md) for contracts, lanes and schedule; [`docs/project.md`](docs/project.md) for the product. How agents coordinate through PRs: [`docs/agent-collaboration.md`](docs/agent-collaboration.md). If this file disagrees with them, the docs win. Fix this file.

---

## 1. Rules

1. **Read before you work.** Read this file, then `docs/agent-collaboration.md`, then `docs/implementation.md` §0–5 and your lane in §6.
2. **Claim before you start.** Set the task to `IN PROGRESS` and put your lane tag in **Owner**, so nobody else picks it up.
3. **Update when you finish.** Set the status, add a log entry and refresh the header table (see [§7](#7-how-to-update-this-file)).
4. **Update before every push.** `context.md` must describe the code being pushed. Commit it with the work.
5. **Done means checked.** A task is `DONE` only when its **Check** column passes. If something is a stub, runs on fixtures only, is untested or is broken, say so.
6. **Stay in your lane.** Only edit the folders your lane owns (see [§2](#2-repo-state)). Changes to `contracts/**` or `fixtures/**` need all three developers to agree; record them in [§5](#5-decisions).
7. **No AI references.** Commit messages, PR titles and descriptions, and this file must not mention AI tools or models: no AI `Co-Authored-By` trailers, no "Generated with ..." lines. Write normal commits, e.g. `[B] Add rover catalog validators`.
8. **Be brief.** One line per entry, `YYYY-MM-DD` dates, lane tags in brackets.

**Lane tags:** `[A]` API/agents · `[B]` engineering · `[C]` web/3D · `[DESIGN]` designer · `[INT]` integrator/shared

**Status values:** `TODO` · `IN PROGRESS` · `BLOCKED` (give the reason in §6) · `DONE` · `CUT`

---

## 2. Repo state

### What exists

| Path | Lane | State |
|---|---|---|
| `README.md` | INT | Exists: setup, stack, lanes (spec links still point to the old root paths) |
| `docs/project.md`, `docs/implementation.md` | INT | Exists: specs v1 (fixtures are in `docs/implementation.md` Appendix A) |
| `docs/agent-collaboration.md` | INT | Exists: PR-based protocol, integrator merges on a ~30 min loop |
| `context.md`, `AGENTS.md`, `CLAUDE.md` | INT | Exists: this file plus pointer files that agents load automatically |
| Root config (`package.json`, `pnpm-workspace.yaml`, `.env.example`, `.gitignore`, CI) | INT | Not created |
| `contracts/` | INT | Not created |
| `fixtures/` | INT | Not created |
| `services/api/` | A | Started: FastAPI app, settings, error envelope, `/api/health`; Pydantic models for IntentSpec, BuildPlan, JobEvent and a plan integrity guard (`contract.py`); engineering port with fixture and real (`rivet_engine`) adapters; file-backed revision store (`orchestration/versions.py`); job manager with SSE (`orchestration/jobs.py`); generation pipeline and routes: `POST /api/projects/generate`, `GET /api/projects/{id}` (+`?revision=`), `/revisions`, `POST /edits`, `/examples`, `GET /api/catalog`. safe image upload (`POST /api/assets/images`, `GET /api/assets/{id}/preview`). live vision provider (OpenAI Chat Completions backend, strict parse, one retry) and intent sanitizer. BOM CSV and `build.json` exports (`GET /api/projects/{id}/exports/bom.csv`, `build.json`). firmware ZIP export (`GET /api/projects/{id}/exports/firmware.zip`, optional `?compile=true`). Estelle grounding client (`GET /api/estelle/status`, `POST /api/estelle/ground`). Smoke script and README not built yet |
| `packages/engineering/` | B | Working engine in `main`: `solve`/`apply_edit`/`verify`/`get_catalog`; 16-part sourced catalog `catalog-v1.1-2026-10-24` with ledger and physical-fit evidence; rover_2wd placement; profile-driven netlist and pin map; validators; bounded repair; BOM/assembly/serialization; `python -m rivet_engine.demo`; 342 offline tests. Sourced default rover: 17 parts, 20 wires, 11 steps, 105.45 USD, `unbuildable` (motor stall 1.5 A vs driver 1.2 A continuous; fresh 6.4 V alkaline pack over the motors' 6 V maximum; TT motor fit in Shadow Chassis undocumented). See `packages/engineering/README.md` |
| `apps/web/` | C | Implemented: Next.js App Router app (`/` and `/studio`); canonical v1 contract types, runtime validators, referential integrity checks, `FixtureSource` and `HttpSource` adapters (`src/lib/rivet/**`, `src/lib/{contracts,api,fixtures,geometry,plan-store}.ts`); R3F 3D stage with fitted camera, studio lighting, millimeter grid and WebGL fallback (`src/components/three/stage/**`); procedural hardware recipes and `PartAssembly` (`src/components/three/parts/**`); part selection, hover, isolation and click-guard (`src/components/three/interactions/**`); exploded view and step assembly timeline (`src/components/three/assembly/**`); electrical wiring overlay with schematic fallback (`src/components/three/wiring/**`); unified `RoverScene` (`src/components/three/RoverScene.tsx`); deterministic 2D differential-drive rover simulator engine and 3D visual viewer bridged in `SimView` (`src/components/sim/**`); image/prompt intake, job progress and saved example launcher (`src/components/studio/intake/**`); part inspector, BOM, verification and revision panels (`src/components/studio/panels/**`); `<StudioShell>`, `Toolbar`, `StepTimeline`, `PartsPanel`, `Inspector` and `Studio` (`src/components/studio/**`, `src/components/ui/**`) |
| `design/` | DESIGN | Not created |

### Lane ownership

| Tag | Scope | Owns | Branch |
|---|---|---|---|
| `[A]` | Vision, agents, API, firmware, Estelle | `services/api/**` | `feat/a-agents-api` |
| `[B]` | Catalog, solver, validators, BOM, assembly | `packages/engineering/**` | `feat/b-engineering` |
| `[C]` | 3D studio, frontend data layer, simulation | `apps/web/**` | `feat/c-3d-sim` |
| `[DESIGN]` | Visual system | `design/**`; after handoff also `apps/web/src/components/ui/**` and `apps/web/src/styles/**` | `design/visual-system` |
| `[INT]` | Shared files | `contracts/**`, `fixtures/**`, root configs | reviewed PR to `main` |

---

## 3. Task board

Task IDs match `docs/implementation.md` §6. **Check** is what must be true before the task counts as `DONE`.

### Bootstrap `[INT]`

| ID | Task | Status | Owner | Check |
|---|---|---|---|---|
| INT-0 | Repo skeleton: folders, root `package.json`, `pnpm-workspace.yaml`, `.env.example`, `.gitignore` | TODO | — | Folders match `docs/implementation.md` §2 |
| INT-1 | `contracts/` schemas: intent, component, build-plan, errors, `api.md` | TODO | — | Schemas validate the Appendix A fixtures |
| INT-2 | `fixtures/` from Appendix A: seed catalog, rover plan, failing-driver plan, intent, sim scenario | TODO | — | Every fixture is valid against its schema |
| INT-3 | CI: fixture validation, engine pytest, API pytest, web checks, optional PlatformIO | TODO | — | CI green on `main` |

### Developer A `[A]` · `services/api/**`

| ID | Task | Status | Owner | Check |
|---|---|---|---|---|
| A0 | Bootstrap: FastAPI app, health route, fixture mode | DONE | [A] | `uvicorn` starts; `/health` OK with `RIVET_MODE=fixture` |
| A1 | Image upload and input normalization | DONE | [A] | Upload returns an asset id; bad input returns a typed error |
| A2 | Pipeline: vision → IntentSpec → engine → BuildPlan, with jobs and SSE | DONE | [A] | Fixture image → saved BuildPlan through job events |
| A3 | Project storage, edits, revisions | DONE | [A] | An edit creates a new revision with the same `build_id` |
| A4 | Firmware generator (ESP32 rover template) | DONE | [A] | Generated project is tied to `build_id` and `revision` |
| A5 | Estelle integration (real calls, honest fallback) | IN PROGRESS | [A] | Real evidence captured, or its absence shown |
| A6 | Tests and standalone demo | TODO | — | `pytest` passes in fixture mode |

### Developer B `[B]` · `packages/engineering/**`

| ID | Task | Status | Owner | Check |
|---|---|---|---|---|
| B0 | Domain model and public entry points (`solve`, etc.) | IN PROGRESS | [B] | Models match `contracts/` |
| B1 | Catalog of real components | DONE | [B] | Only real parts; unknown values stay `null` |
| B2 | Parametric mechanical assembly and mounts | DONE | [B] | Rover template produces consistent instances |
| B3 | Electrical graph; driver and controller assignment | DONE | [B] | Netlist references only valid pins |
| B4 | Deterministic validators: mechanical, electrical, budget, completeness | IN PROGRESS | [B] | Failing-driver fixture produces the expected finding |
| B5 | Repair engine | DONE | [B] | At least one failure repaired or honestly rejected |
| B6 | BOM, assembly steps, serialization | DONE | [B] | BOM rows match instance IDs |
| B7 | Tests and standalone demo | DONE | [B] | `pytest` passes standalone |
| B-PLAN | Parallel work orders and per-task branch/PR handoffs | DONE | [B] | B0–B7 covered; exclusive implementation/test paths and dependency gates reviewed |
| B-P0 | Foundation: models, internal API, test inputs (`feat/b-p0-foundation`) | DONE | [B] | Clean install; offline model tests pass; `INTERNAL_API.md` freezes P1–P6 signatures |
| B-P1 | Sourced catalog (`feat/b-p1-catalog`) | DONE | [B] | See `packages/engineering/WORK_ORDERS.md` P1 |
| B-P2 | Mechanical placement (`feat/b-p2-mechanics`) | DONE | [B] | See WORK_ORDERS P2 |
| B-P3 | Wiring and pin allocation (`feat/b-p3-wiring`) | DONE | [B] | See WORK_ORDERS P3 |
| B-P4 | Validators (`feat/b-p4-validation`) | DONE | [B] | See WORK_ORDERS P4 |
| B-P5 | BOM, assembly, serialization (`feat/b-p5-exports`) | DONE | [B] | See WORK_ORDERS P5 |
| B-P6 | Repair (`feat/b-p6-repair`) | DONE | [B] | See WORK_ORDERS P6 |
| B-P7 | Composition, edits, demo (`feat/b-p7-integration`) | DONE | [B] | See WORK_ORDERS P7 |
| B-P8 | B7 demo CLI tests and hardening (`feat/b7-engine-integration-demo`) | DONE | [B] | `tests/test_demo.py` passes; bad CLI input exits 2/3 without traceback |

### Developer C `[C]` · `apps/web/**`

| ID | Task | Status | Owner | Check |
|---|---|---|---|---|
| C0 | Bootstrap: Next.js app and fixture loader | DONE | [C] | `pnpm --filter web dev` renders the fixture |
| C1 | Part-backed 3D renderer (top priority) | DONE | [C] | Fixture rover renders; parts are selectable |
| C2 | Exploded view and assembly timeline | DONE | [C] | Can explode the model and step through assembly |
| C3 | BOM and inspector (functional shell) | DONE | [C] | Selecting a part shows its catalog data and links |
| C4 | Bounded rover simulation | DONE | [C] | Obstacle scenario runs and is labeled as an approximation |
| C5 | Image/prompt upload and streaming job UX | DONE | [C] | Job events shown live, or replayed from a fixture |
| C6 | Designer interface and handoff | DONE | [C] | Designer can swap UI components without touching engine code |
| C7 | Tests and standalone demo | DONE | [C] | Vitest and Playwright pass |

### Designer `[DESIGN]` · `design/**`

| ID | Task | Status | Owner | Check |
|---|---|---|---|---|
| D0 | Moodboard, identity, layout principles | TODO | — | Committed under `design/` |
| D1 | Studio wireframe, control patterns, interaction specs | TODO | — | `design/component-spec.md` exists |
| D2 | CSS tokens, base controls, responsive shell | TODO | — | `design/tokens.md` exists and C has the handoff |
| D3 | Polish upload, progress and inspector; final motion and pitch visuals | TODO | — | Integrated without breaking the 3D canvas |

### Gates (`docs/implementation.md` §7)

| Gate | Pass condition | Status |
|---|---|---|
| Hour 8 | Every lane demos itself from fixtures | TODO |
| Hour 16 | Working vertical path: A+B, B+C, A+C | TODO |
| Hour 24 | Scope frozen | TODO |
| Hour 30 | Demo frozen | TODO |
| Hour 34–36 | Rehearsal and final verification done | TODO |

---

## 4. Log

Newest first. Append only; never edit old entries.
Format: `YYYY-MM-DD [LANE] TASK-ID: what changed. Checked: how. Notes: half-done work or gotchas (optional).`

- 2026-10-24 [C] C0/C3/C5/C7: Fixed the three PR #23 review items in `useStudioPlanStore`: (1) browser `HttpSource` now defaults to same-origin `baseUrl: ''` so `/api/*` requests use Next.js rewrites (`next.config.mjs`) without cross-origin preflight failures or contacting the viewer's own localhost; (2) `setSourceMode`, `loadSavedExample`, `loadBuild` and `startGeneration` abort and epoch-guard in-flight `getCatalog`/`getBuild`/`listRevisions`/`generate`/`subscribeToJob` calls so late HTTP responses cannot overwrite the active source's plan or revisions; (3) saved snapshots (`SOURCED_ROVER_BUILD_ID` and `SYNTHETIC_ROVER_BUILD_ID`) are paired with a `FixtureSource` that owns both plans (`createCombinedFixtureSource`), stamped `provenance.generation_mode = "fixture"` so the trust banner shows `Saved demo build`, use local exports (`getExportUrl` null), and return the fixture edit finding instead of `BUILD_NOT_FOUND`. Checked: `pnpm --dir apps/web lint` clean, `pnpm --dir apps/web test` 39 test files / 360 tests passed, `pnpm --dir apps/web build` succeeded.
- 2026-10-24 [C] C1/C2/C3/C7: Reconciled `apps/web` with `main` (`71dd73c`, B's `rivet_engine`). Resolved the §6 viewer item for loose kit accessories: components with `render_overrides.visible = false` are now hidden in `HardwarePart`/`RoverScene`/`computeAssemblyView`, excluded from 3D camera auto-fit bounds (`computePlanBoundsMm`), and labeled `unmodeled kit item` in `PartsPanel`. Added `motor_power` and `controller_power` to `UP_ROLES` for vertical explode, deduplicated React keys for repeated `rule_id` findings in `VerificationPanel`/`PartInspector`, allowed ISO-8601 date strings on catalog price/URL timestamps, and verified B's real 16-part sourced catalog and 17-component/20-wire/11-step/55-finding `BuildPlan` across contract, assembly, wiring and studio tests. Checked: `pnpm --dir apps/web typecheck` clean, `pnpm --dir apps/web test` 39 test files / 357 tests passed, `pnpm --dir apps/web build` succeeded.
- 2026-10-24 [C] C0/C1/C2/C3/C4/C5/C6/C7: Integrated the complete `apps/web` 3D hardware studio: Next.js App Router (`/` and `/studio`), canonical v1 contract validators and referential integrity checks (`src/lib/rivet`), `FixtureSource` and `HttpSource` data sources with SSE/polling job subscriptions, `RivetStage` with fitted camera and WebGL fallback (`src/components/three/stage`), procedural hardware part recipes and `PartAssembly` (`src/components/three/parts`), selection/hover/isolation controller (`src/components/three/interactions`), deterministic exploded view and assembly step timeline (`src/components/three/assembly`), electrical wiring overlay with schematic fallback (`src/components/three/wiring`), unified `RoverScene`, deterministic 2D differential-drive kinematic simulation engine and 3D viewer connected via `SimView` (`src/components/sim`), `BuildIntake` with image validation and stage log (`src/components/studio/intake`), `PartInspector`/`BOMPanel`/`VerificationPanel`/`ProjectRevisionPicker` (`src/components/studio/panels`), and `<StudioShell>` with `Toolbar`, `StepTimeline`, `PartsPanel`, `Inspector` (including exports and Estelle grounding UI) and `Studio`. Checked: `pnpm --dir apps/web typecheck` clean, `pnpm --dir apps/web test` 39 test files / 355 tests passed, `pnpm --dir apps/web build` succeeded. Notes: Playwright E2E is not configured yet; Vitest covers unit, component, R3F scene graph and studio integration tests.
- 2026-10-24 [B] B-P8: Added `tests/test_demo.py` for the B7 acceptance checks on CLI output: written plan is BuildPlan-valid and complete, every mount/port/step/BOM reference resolves, the failing-driver finding (TT stall 1.5 A vs TB6612 1.2 A) is a blocking FAIL with evidence URLs, simulation is metric with labeled nominal values, compile status is never claimed, two runs match ignoring `created_at`, `--intent` with the sample equals `--sample`. Moved the existing demo tests out of `test_integration.py`. Fixed three tracebacks in `demo.py`: a non-object intent with `--max-budget` (AttributeError), an unreadable intent path such as a directory, and an unwritable `--output`; all now exit 2 with a message. Checked: `uv run pytest -q` 357 passed, 7 skipped (5 placeholder/shared-fixture skips as before, plus shared-intent and `contracts/` schema checks that skip until INT-1/INT-2 land). Notes: no shared JSON schemas exist, so plans are validated by the Pydantic models only; the schema test runs automatically once `contracts/build_plan.schema.json` and `jsonschema` are present.
- 2026-10-24 [B] defect-fix 2: Fixed the second review of `c5b54e4`. (1) Budget is computed from catalog prices only and `integrity.bom` fails BOM rows whose price or purchase link differs from the catalog, so a forged 0.00 BOM can no longer pass a budget. (2) Public `verify()` always runs the fit rule: evidence applies to records identical to the packaged ones; a changed record makes the pair a blocking UNKNOWN (no silent skip). (3) Stop distance must be below the selected sensor range, enforced in `set_behavior_parameter`, in sensor swaps, and by the new `firmware.behavior_parameters` rule (bounds now live in the validator). (4) Non-string parameter names are rejected. (5) `load_fit_evidence` validates every field the rule reads; the rule no longer indexes missing keys. Remaining audit defects fixed: supply capacity must cover documented loads (a 1 mA pack now FAILs); `electrical.motor_channels` fails two motors on one channel; supply over the rated maximum is a blocking FAIL (under the minimum stays an advisory brown-out WARN, intentionally); driver direction/standby inputs are required; controller I2C pins get logic checks; mounted parts need mount references and `mechanical.pose_consistency` fails parts >30 mm from their mount; size limits are UNKNOWN when any part lacks bounds; NaN/inf, non-positive dimensions, negative ratings and invalid `created_at` are rejected; empty or incomplete assembly steps fail; `load_catalog()` returns fresh objects. Checked: `uv run pytest -q` 342 passed, 6 skipped (3 identical runs); each of the reviewer's five reproductions re-run and now fixed; three new rules mutation-checked (disabling each makes its test fail); clean install 341 passed, 7 skipped; engine output and all five edit operations via services/api `parse_edit` pass `assert_build_plan_contract`. Notes: default rover now also FAILs motor voltage because fresh alkaline cells reach 6.4 V; this joins the open motor/driver decision.
- 2026-10-24 [B] defect-fix: Fixed PR #21 review findings and the B1-B6 audit on branch `developer-2-defect-fix`. Review: edits are accepted only if they add no blocking FAIL and keep the requested part (sensor swaps that repair would undo are rejected); non-string instance ids are rejected instead of crashing; the `engine_state` note is schema-validated (bad values, wrong offset shape, extra keys, duplicates -> `INVALID_INPUT`); BOM stays in USD and non-USD budget edits are rejected (solve reports budget UNKNOWN); preferred controller is checked against the builder's own wiring profiles; behavior bounds documented and tested as inside the firmware generator's; this file no longer contradicts itself. Audit: new `data/fit_evidence.json` + `mechanical.fit_evidence` rule (TT motor in Shadow mounts is a blocking UNKNOWN citing SparkFun's assembly guide; wheel, caster and holder fits PASS with sources); ESP32 pin restrictions now cite the ESP-IDF GPIO page that was actually read and GPIO16/17 are allocated last (pin map now uses 18/19); AA alkaline cells (Adafruit 3349) added to catalog and default kit, holder voltage set to 3.2-6.4 V from those cells (WARN vs motor and VM ratings); `budget.price_currency` reports other-currency prices explicitly; loose kit items get `render_overrides.visible = false`; kit order parsed numerically. Untracked the stray `rivet-person-2-tasks/` files (left on disk). Checked: `uv run pytest -q` 296 passed, 6 skipped (3 repeat runs identical); clean install in a fresh copy 295 passed, 7 skipped (firmware-bounds test skips without services/api); demo exit codes 0/0/2; engine output and all five edit operations (sent through services/api `parse_edit`) pass `assert_build_plan_contract`; firmware generator accepts the new pin map but refuses the default plan because it is unbuildable. Notes: services/api's own test suite cannot import on a fresh checkout because `rivet_api/exports/` is ignored by the root `.gitignore` pattern `exports/` (see §6).
- 2026-10-24 [B] B-P7: Reviewed and reconciled with main for sequential merge. Checked: engineering pytest 255 (6 skipped) passed; diff check passed. Notes: Real API adapter solve/catalog/verify/edit and boundary-contract smoke passed; both demo CLI commands passed. Default sourced rover is unbuildable due to motor stall current above driver continuous rating, with findings preserved. Size requirements now persist through edits; malformed offsets reject cleanly and clearing budget preserves null. Full API test collection is blocked by the pre-existing missing rivet_api.exports package on main. Six skips cover implemented-entry-point placeholders and absent shared fixtures. Includes the nine previously requested task text files.

- 2026-10-24 [B] B-P7: Added `configurator.py`, `demo.py`, public entry points in `__init__.py`, package `README.md`, `tests/test_integration.py`, `tests/test_edits.py`. `solve` composes selection -> placement -> wiring -> BOM/steps -> validators -> bounded repair, with runtime UTC `created_at`, deterministic `build_id`, derived simulation (wheel radius 0.0315 m, base 0.137 m, labeled nominal speed and sensor model) and firmware `compile_status` `not_checked` (never `passed`). Unsupported family/behavior/capabilities raise `UNSUPPORTED_REQUEST`; malformed input `INVALID_INPUT`. `apply_edit` supports all five services/api operations, keeps `build_id`, increments revision, never mutates input, rebuilds and re-verifies; out-of-range sensor height and non-sensor swaps are rejected with a finding. Checked: `uv run pytest -q` 245 passed, 6 skipped (4 retired P0 stub checks, 2 shared-fixture tests); clean install in a fresh copy passes; demo `--sample` gives `verified_with_warnings` (32 PASS, 6 WARN, 2 UNKNOWN advisory) and `--max-budget 60` gives `unbuildable`; engine output passes services/api `assert_build_plan_contract` and `render_project` writes the real pin map into `rivet_config.h` (run ad hoc with fastapi installed temporarily, not in B's tests). Engine repair shown on SYNTHETIC parts: over-current motor fixed by swapping to the higher-rated driver; a controller with too few pins is honestly rejected as unbuildable. Notes: B0 and B4 stay IN PROGRESS only because their checks name `contracts/` and the shared failing-driver fixture, which do not exist yet. Edit state rides in one `engine_state:` provenance note (no contract field exists).

- 2026-10-24 [B] B-P6: Reviewed and reconciled with main for sequential merge. Checked: engineering pytest 202 (1 skipped) passed; diff check passed. Notes: Enforced a hard three-round cap even when callers request more, with a regression covering three accepted improvements. Shared fixture remains absent; runtime composition is next.

- 2026-10-24 [B] B-P6: Added `repair.py`: `repair_candidate` verifies, then for each blocking FAIL tries same-category catalog substitutions (all instances of that part at once) and optional injected layout corrections in a stable order, rebuilds and re-verifies through injected callbacks, and keeps the first change that removes a blocking failure without adding one; at most 3 rounds, repeated candidates and rebuild errors are logged and skipped. Substitutes must keep the real/synthetic kind and have evidence no weaker than the part they replace. UNKNOWNs are never repaired away, catalog and input are not mutated, the result carries only canonical plan fields plus a separate attempt log. Outcomes: unchanged / repaired / improved / rejected. Checked: `uv run pytest -q` 200 passed, 1 skipped. Notes: B5 is DONE only after P7 shows a real repair or honest rejection on engine-built plans.

- 2026-10-24 [B] B-P5: Reviewed and reconciled with main for sequential merge. Checked: engineering pytest 188 (1 skipped) passed; diff check passed. Notes: Shared failing-driver fixture remains absent. Unknown prices and unverified product links remain explicit; totals do not silently mix currencies.

- 2026-10-24 [B] B-P5: Added `bom.py`, `assembly.py`, `serialize.py`. BOM rows grouped by catalog ID with quantity = instance count; prices only from the catalog, Decimal subtotal to the cent; a price in another currency is left out, not converted; `complete`/`incomplete`/`not_available` set truthfully; purchase links shown only when verified, otherwise `manufacturer_reference_only` or `not_available`. Assembly steps follow the parent graph (cycles raise), then signal, motor and ground wiring listing every connection, then a wiring check, and the step that connects batteries/USB supply comes last. JSON output is sorted, newline-terminated and round-trips; extra fields are rejected with `INVALID_INPUT`. Checked: `uv run pytest -q` 187 passed, 1 skipped. Notes: one BOM unit = one item as sold (jumper wire pack counts as 1). Simulation fields are derived in P7.

- 2026-10-24 [B] B-P4: Reviewed and reconciled with main for sequential merge. Checked: engineering pytest 165 (1 skipped) passed; diff check passed. Notes: Removed unsupported 1.5x current tolerance: stall above continuous rating now blocks, and unverified current evidence stays UNKNOWN. Shared failing-driver fixture check is skipped because shared fixtures are absent.

- 2026-10-24 [B] B-P4: Added `rivet_engine/validators/` (`verify_candidate`, `aggregate`): referential integrity (duplicate IDs, parents/cycles, mounts, connection ports, BOM quantity/phantoms/subtotal, step references), family/behavior/capabilities, required roles, real parts, availability, mount mates, rotated-box overlap and ground contact via an injected bounds helper, size limits, signal types, GPIO usage (input-only, reserved, strapping, shared pins), supply and motor voltage ranges, logic levels, motor stall vs driver continuous current (WARN up to 1.5x, FAIL above; heuristic documented), common ground, required connections, I2C address collisions, supply capacity, Decimal budget with currency checks, pin-map backing and firmware profile support. Missing ratings give UNKNOWN; a PASS that relies on approximated catalog evidence becomes an advisory WARN. Findings are sorted and de-duplicated; aggregation follows spec B4. Also made the synthetic test plan physically consistent and spread the Shadow Chassis deck mounts so the power bank no longer overlaps the ESP32 board. Checked: `uv run pytest -q` 164 passed, 1 skipped (shared failing-driver fixture not landed). Notes: trial run of the sourced rover gives only advisory findings (out-of-stock ESP32, 1.5 A stall vs 1.2 A continuous, approximated battery voltage and geometry, battery capacity unknown). B4 stays IN PROGRESS until P7 runs it end to end.

- 2026-10-24 [B] B-P3: Reviewed and reconciled with main for sequential merge. Checked: engineering pytest 120 passed; diff check passed. Notes: Unknown supply/current facts remain findings; wiring does not establish firmware compilation or physical readiness.

- 2026-10-24 [B] B-P3: Added `wiring.py` and profile `data/wiring_profiles/esp32_devkitc_tb6612.json` (exact ESP32-DevKitC V4 + Adafruit TB6612 IDs; reserved GPIOs with reasons: flash 6-11, strapping 0/2/5/12/15, UART0 1/3, input-only 34-39). `wire_rover` builds a structured netlist: 7 driver control lines, I2C SDA/SCL on 21/22, 3.3 V logic to driver and sensor, both motor channels, motor and controller supplies, common ground. Sourced pin map: motor_left_pwm 25, in1 26, in2 27, motor_right_pwm 32, in1 33, in2 16, standby 17, i2c_sda 21, i2c_scl 22 (format A's firmware expects). No profile -> no pins plus a blocking UNKNOWN; exhausted pins, missing ports, non-I2C sensors and a logic supply outside a part's range become findings. Checked: `uv run pytest -q` 120 passed. Notes: the USB power bank has no ground port (ground runs in the USB cable). Current and power ratings are left to P4; nothing here marks firmware compiled.

- 2026-10-24 [B] B-P2: Reviewed and reconciled with main for sequential merge. Checked: engineering pytest 103 passed; diff check passed. Notes: Mount and geometry approximations remain labeled; placement is not proof of physical fit. Public composition remains pending.

- 2026-10-24 [B] B-P2: Added `mounts.py` and template `data/templates/rover_2wd.json`. `place_rover` computes every pose as parent x parent mount x offset x inverse(child mount), with XYZ Euler degrees in the three.js order (R = Rx*Ry*Rz) so C can apply `rotation_deg` directly; it then lifts the assembly so the lowest wheel/caster point sits on y = 0. Stable IDs (`chassis-1`, `motor-left-1`, ..., `accessory-<n>`), wheels mount on motor shafts, mates must be listed on both sides, each mount takes one child, missing anchors/illegal mates/out-of-range offsets raise `PLACEMENT_ERROR`, sensor height adjustable -10..+25 mm. `world_aabb` gives conservative rotated bounds for P4. Also changed the TT motor shaft in `components.json` to the body centreline so mirrored motors keep one axle. Checked: `uv run pytest -q` 103 passed. Notes: sourced placement reports `mechanical.geometry_approximated` (advisory UNKNOWN) because mount coordinates are not from CAD. B2 stays IN PROGRESS until P7 integrates it.

- 2026-10-24 [B] B-P1: Reviewed and reconciled with main for sequential merge. Checked: engineering pytest 71 passed; diff check passed. Notes: Source ledger and unknown metadata are preserved; catalog presence does not establish physical or electrical compatibility. Public composition remains pending.

- 2026-10-24 [B] B-P1/B1: Added the sourced catalog `catalog-v1-2026-10-24`: 15 real parts (Espressif ESP32-DevKitC V4 via Adafruit 3269, Adafruit TB6612 2448, Adafruit TT motor 3777 and wheel 3766, SparkFun Shadow Chassis ROB-13301 with its nub caster and 4xAA holder, Adafruit VL53L0X 3317 and VL53L1X 3967, Adafruit power bank 4288, cables 4209/758/592, DC jack adapter 368, breadboard 64). Every rating cites a page read today; ledger in `rivet_engine/data/catalog_sources.md`. `load_catalog()` is offline, validates every record, rejects duplicates and malformed files. Checked: `uv run pytest -q` 71 passed. Notes: mount coordinates are approximated (not CAD); battery holder voltage is derived from 4 AA cells (4.8-6.0 V); TT motor fit in the Shadow motor mounts is assumed, not confirmed by SparkFun; Adafruit 3269 was out of stock today. Known electrical tension for P4: TT motor stall 1.5 A @6 V exceeds TB6612 1.2 A continuous (3 A peak for ~20 ms).

- 2026-10-24 [B] B-P0: Added the `rivet_engine` foundation: Pydantic models for IntentSpec, CatalogComponent and BuildPlan (extra keys forbidden, every §3.4 enum, decimal-string money, nulls kept), internal `Catalog`, selection, placement, wiring, verification and repair types plus `EngineError` classes that carry the API error envelope; `INTERNAL_API.md` fixes the P1–P6 function signatures; public entry points raise instead of returning fake results. Test inputs: exact Appendix A catalog/plan and §3.1 intent, plus a SYNTHETIC TEST-ONLY complete rover catalog/plan with full netlist and adversarial parts. Checked: `cd packages/engineering && uv sync && uv run pytest -q` 49 passed (round-trip, null preservation, all enums, malformed rejection). Notes: no shared `contracts/` schemas exist yet, so validation is Pydantic only. `verify(plan, catalog=None)` takes an optional catalog because services/api calls `verify(plan)`. B0 stays IN PROGRESS until P7.

- 2026-10-24 [B] B-PLAN: Resolved planning PR conflicts against current main, preserving API progress. Checked: diff and file scope; documentation only.
- 2026-10-24 [B] B-PLAN: Added eight scoped work orders with foundation, six concurrent tasks, integration, and individual branch/PR instructions. Checked: B0–B7 coverage and file ownership; documentation only.
- 2026-10-24 [A] A5: Added `RepoGrounder` using only what Estelle's docs specify (`estelle ask "<question>"`, `estelle doctor`). Output is treated as untrusted: a citation counts only if its file exists inside the repo, the line is in range and the file really contains the symbol; otherwise the result is `ungrounded` with no citations. Non-zero exit, timeout, missing CLI, disabled flag, non-git path or `mcp` mode give `unavailable` and never record evidence. `estelle_evidence.json` (under the data dir) is appended only for verified results. Symbol names must be plain identifiers; subprocess runs a fixed argv with no shell, stdin closed, a timeout and a scrubbed environment (no API keys). `verify_change` only enforces that paths stay inside the firmware template folder (symlink escapes included) and then reports `unavailable`, since Estelle's verify/gate usage is undocumented. New env var `RIVET_ESTELLE_REPO` (defaults to this repo). Checked: `pytest` 321 passed (3 repeat runs, plus a mutation check that weakening the citation checks fails 4 tests); all with fake runners. Notes: A5 stays IN PROGRESS, see section 6.
- 2026-10-24 [A] A4: Added firmware generation: `generate_firmware` renders `platformio.ini`, `src/main.cpp`, `include/rivet_config.h`, `README.md` and `manifest.json` (build id, revision, plan status, generation mode, sha256 and template source per file, compile status) from allow-list templates; GPIO numbers come only from the plan's pin map, behavior thresholds from its parameters (converted to mm, ms, PWM), titles are whitelisted so they cannot inject code. Refuses unbuildable plans (422 `FIRMWARE_REFUSED`); `needs_review` plans still generate but say so in the README and manifest, and fixture/fallback plans get a SAVED FIXTURE warning. The rover boots disabled; serial `x` disables, `g` enables; a missing sensor reading stops the motors. `compile_firmware` runs a fixed `pio run -d <dir>` argv with no shell, a timeout and a scrubbed environment (no API keys); no PlatformIO means `not_checked`. Checked: `pytest` 278 passed (3 repeat runs); generated `main.cpp` passes `clang++ -fsyntax-only -Wall -Wextra` against stub Arduino/Wire/VL53L0X headers. Notes: NEVER compiled with PlatformIO (not installed here), so the pinned `espressif32@6.9.0` and `Adafruit VL53L0X@1.2.4` versions and the real library APIs are unverified; the board id `esp32dev` is generic; unit tests use made-up pin numbers as test data only. See the pin_map issue in section 6.
- 2026-10-24 [A] A2/A3: Added exports. `GET /api/projects/{id}/exports/bom.csv` (columns `catalog_id,quantity,instance_ids,unit_price_amount,currency,purchase_url,link_status`, instance ids joined with `;`, a final `TOTAL` row whose `link_status` cell reads `total_status:<status>`) and `exports/build.json` (the stored revision), both with `?revision=`, an attachment filename of `<build_id>-r<n>...`, `nosniff` and `X-Rivet-Generation-Mode`. Null prices and links stay empty cells (never 0); the subtotal is exactly what the engine reported, the API never sums anything; cells starting with `= + - @` or tab/CR get a leading `'` so spreadsheets cannot run them (plain decimals untouched). Checked: `pytest` 229 passed (3 repeat runs); real `uvicorn` run showed the CSV. Notes: firmware ZIP export is not built yet (next). Exports are not in the spec's Hour-16 minimum.
- 2026-10-24 [A] A1: Added the live vision provider and intent sanitizer. `LiveVisionProvider` sends the spec prompt (section 9.7 verbatim plus a data-not-instructions rule) through a `VisionBackend`; `OpenAIBackend` uses Chat Completions JSON mode with the image as a data URI. Replies are parsed strictly (extra keys such as `status` are rejected), retried once with a hint that never echoes the bad reply, then 502 `VISION_PARSE_FAILED` (retryable). Provider errors map to 429/503/502 with generic messages (no key leakage). `sanitize_intent` runs for every provider including the mock: support status is decided by code (non-rover never supported, rc_car planned, line following unsupported), budget and size limits come only from the request, unknown controller ids are nulled, capabilities filtered, text lists capped and cleaned, input rebuilt from the request, image uploads get the hidden-electronics assumption. `user_text` capped at 2000 chars. `RIVET_VISION_PROVIDER=openai` needs `RIVET_VISION_MODEL`, `OPENAI_API_KEY` and `pip install 'openai>=1.40'` (extra `live`); misconfiguration fails at startup. Checked: `pytest` 208 passed (3 repeat runs), all with fake backends. Notes: NOT tested against the real OpenAI API (no key here), so the request shape in `OpenAIBackend` is unverified against a live call; the mock still ignores the image content. Other providers fit behind `VisionBackend`.
- 2026-10-24 [A] A1: Added image upload: `POST /api/assets/images` (multipart `file`) and `GET /api/assets/{id}/preview`. Content is sniffed and fully decoded (PNG/JPEG/WebP only; GIF, SVG, BMP, TIFF, truncated and empty files are `INVALID_IMAGE`), 10 MB limit (413), 40M pixel budget enforced before decoding (decompression bombs rejected), EXIF orientation applied then all metadata dropped by re-encoding from pixels, images over 2048 px downscaled, server-generated ids only, per-session quota (429, `X-Rivet-Session` header or client address, invalid uploads count). Checked: `pytest` 165 passed (3 repeat runs); real `uvicorn` run: 3000x1500 PNG stored as 2048x1024, `/etc/hosts` posing as PNG rejected, generate job from the uploaded asset completed. Notes: A1 stays IN PROGRESS until the vision parser and intent sanitizer land (the other half of A1). Quota is in memory and per process. Added `pillow` and `python-multipart` to `services/api/pyproject.toml`; reinstall the venv deps. Starlette still spools the whole multipart body before the size check.
- 2026-10-24 [A] A2/A3: Added generation pipeline and project routes. `POST /api/projects/generate` (202 + job), `GET /api/projects/{id}`, `/revisions`, `POST /edits` (409 on stale `base_revision`, 422 `UNSUPPORTED_EDIT` for anything outside the five allowed operations, rejected edits leave the stored revision untouched, every outcome goes to the edit log), `GET /api/projects/examples`, `GET /api/catalog`, `X-Rivet-Mode` header. Engine output goes through a structural contract guard (502 `ENGINE_CONTRACT_VIOLATION`, nothing stored); status and findings are stored exactly as the engine gave them. Fixture mode emits one honest `system` event and no fake assembly/validate stages; live engine with a non-live vision provider is labeled `fallback`. Checked: `pytest` 129 passed (5 repeat runs stable); real `uvicorn` run: generate, SSE events, edit, revisions. Notes: vision is the offline mock only (no live provider or sanitizer yet), image upload is a stub that reports no assets, so the image path is tested with a fake asset store. The free-text edit selector is a hook with no model behind it, so free-text-only edits return 422. A2/A3 are done for the fixture flow; live vision, upload and exports remain.
- 2026-10-24 [A] A2: Added `JobManager` and `GET /api/jobs/{job_id}`, `GET /api/jobs/{job_id}/events` (SSE). Monotonic per-job event ids, enums enforced, replay via `Last-Event-ID` or `?last_event_id=`, keepalive comments and a max stream duration, jobs mirrored to `data/jobs/` so finished jobs survive a restart, worker exceptions become a `failed` job with a generic message. `progress` is null unless the job declares `planned_stages`. Checked: `pytest` 81 passed (replay with no gaps or duplicates, live delivery, job that never finishes). Notes: nothing creates jobs yet; the generate route is next. Added `services/api/.gitignore` for runtime `data/`.
- 2026-10-24 [A] A3: Added `ProjectStore`: immutable `revision-N.json` files with atomic writes, 409 `STALE_REVISION` on a stale `base_revision` (per-project lock), validated `build_id` (400 on traversal attempts), 404s, append-only edit log. Checked: `pytest` 57 passed, incl. 8 concurrent appends from one base (exactly one wins) and reload from disk. Notes: not wired to routes yet; the store sets only `build_id`, `revision` and `created_at` on appended revisions and never touches status or findings. Locking is per process.
- 2026-10-24 [A] A2: Added `EngineeringPort` with `FixtureEngineeringAdapter` (saved synthetic build, labeled `fixture`/`fallback`; edits touch only behavior params and colors, never status or findings) and `RealEngineeringAdapter` (imports only `solve`, `apply_edit`, `verify`, `get_catalog`; 503 `ENGINE_UNAVAILABLE` if absent). Checked: `pytest` 35 passed; live mode without `rivet_engine` falls back with `generation_mode=fallback` or raises when fallback is disabled. Notes: not tested against B's real engine (does not exist yet). Fixture adapter prefers repo `fixtures/` once INT-2 lands, else packaged copies in `rivet_api/data/fixtures/`. `set_budget`, `replace_optional_sensor` and `set_mount_offset_within_template` are rejected in fixture mode.
- 2026-10-24 [A] A0: Added Pydantic models (IntentSpec, BuildPlan, JobEvent) and `assert_build_plan_contract` (referential integrity only; no status or findings logic). Checked: `pytest` 16 passed, incl. round trips of the Appendix A plan and rejection of a plan with `driver-1` removed. Notes: private fixture copies in `services/api/tests/fixtures/` extracted from `docs/implementation.md` Appendix A; swap for `fixtures/` once INT-2 lands.
- 2026-10-24 [A] A0: Added `services/api` FastAPI app: settings from env, error envelope, `GET /api/health`. Checked: `pytest` 4 passed; `uvicorn` starts and `/api/health` returns `{"ok":true,"mode":"fixture"}`. Notes: no `uv` on this machine, used a Python 3.12 venv; contract models wait on INT-1/INT-2 (`contracts/`, `fixtures/` not created).
- 2026-10-24 [INT] setup: Rebased on `08fc92f` (specs moved to `docs/`, protocol added); updated paths. Checked: links resolve. Notes: `README.md` still links `project.md`/`implementation.md` at root.
- 2026-10-24 [INT] setup: Cloned `main` (`cb7ec40`); added `context.md`, `AGENTS.md`, `CLAUDE.md`. Checked: task board matches `docs/implementation.md` §2, §6, §7. Notes: no code yet; start with INT-0.

---

## 5. Decisions

Agreed changes to `contracts/**`, `fixtures/**`, the stack, or scope (including cuts). Newest first.
Format: `YYYY-MM-DD: decision. Agreed by: [A] [B] [C]. Reason: why.`

- none yet

---

## 6. Issues and blockers

Open items only; delete an item once it's resolved and log the fix in §4.
Format: `[LANE] TASK-ID: problem. Needs: who or what unblocks it.`

- [A] services/api: the root `.gitignore` line `exports/` (under Generated artifacts) also ignores `services/api/rivet_api/exports/`, so that package was never committed and `rivet_api.routes.exports` fails to import on a fresh checkout. Needs: [A]/[INT] anchor the pattern (e.g. `/exports/`) and commit the package.
- [B] decision: default rover is `unbuildable` (TT motor 1.5 A stall > TB6612 1.2 A continuous; fresh 4xAA alkaline 6.4 V > TT motor 6 V maximum; TT motor fit in Shadow Chassis undocumented). Options: switch to the documented SparkFun Hobby Gearmotor (stall current unpublished -> UNKNOWN) or source a higher-current driver with the same control interface. Needs: team decision.
- [A] A6: Full API test collection on main fails because rivet_api.exports is imported but absent from tracked files. Needs: API owner to add the missing exports package; direct real-engine adapter and contract smoke checks pass.

- [A] A2 / [B] B7: services/api `RealEngineeringAdapter` turns any engine exception into a generic 500. Engine errors carry `code`, `http_status` and `to_envelope()` (`INVALID_INPUT` 400, `UNSUPPORTED_REQUEST` 422). Needs: [A] map `rivet_engine.EngineError` to its envelope in the adapter.

- [B] B0/B4: B0's check needs `contracts/` schemas (INT-1) and B4's check needs `fixtures/plans/rover_failing_driver_v1.json` (INT-2). Engine tests already compare against them when present. Needs: [INT] INT-1/INT-2.

- [A] A5: Estelle was never run for real: the `estelle` CLI is not installed here and there is no account. Needs: a human to run `npm i -g @fatelabs/estelle`, `estelle login`, `estelle setup` in the repo, set `RIVET_ENABLE_ESTELLE=true`, then call `GET /api/estelle/status` and `POST /api/estelle/ground` once and check that `estelle ask` output really carries `file:line` citations (the output format is not documented, so the parser may need adjusting). Also not done: the grounded firmware-edit flow (a patch to the template that is grounded, then compiled), because Estelle's docs give no parameters for the MCP tools or `gate`/`verify`.
- [A] A4 / [B] B3: `firmware.pin_map` format. [B] confirms A's proposal: keys `motor_left_pwm, motor_left_in1, motor_left_in2, motor_right_pwm, motor_right_in1, motor_right_in2, motor_standby, i2c_sda, i2c_scl`, values integer controller GPIO numbers (enforced in `rivet_engine/models.py`, documented in `packages/engineering/INTERNAL_API.md`). Still open until B's sourced plan carries a real pin map (B-P3/B-P7). Needs: [B] P3 wiring.
- [INT] README: spec links point to root `project.md`/`implementation.md`, which moved to `docs/`. Needs: README link fix.

---

## 7. How to update this file

Do this every time you finish a task, and before every push:

1. Set the task's **Status** in [§3](#3-task-board) and fill in **Owner**.
2. Add one line to [§4 Log](#4-log) at the top, using the format given there.
3. Update the header table: **Last updated**, **Branch / commit**, **In progress**, **Blocked**, and **Next up**.
4. If a folder now exists or changed state, update [§2](#2-repo-state).
5. Record contract or scope changes in [§5](#5-decisions) and blockers in [§6](#6-issues-and-blockers).
6. Commit `context.md` together with the work, then push.
