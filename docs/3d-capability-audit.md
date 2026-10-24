# Rivet 3D generation: capability audit (Gate 0 baseline)

Audit of what existed **before** the v2 geometry-first work on `feat/3d-generation-complete`.
Status values: `working` (exercised by a test), `partial`, `missing`, `broken`, `blocked`.
The living, after-the-work status is in [`3d-capability-checklist.md`](3d-capability-checklist.md).

## Checkout at audit time

| Item | Value |
|---|---|
| Branch | `feat/3d-generation-complete` (tracks `origin/pr-100`) |
| Base | `main` @ `eb857bf` (#95) |
| Teammate commits on the branch | `730f9f7` e-commerce plan (Emaad Qazi); `9554de4` concept models from any photo (David Zhao); `c1f2a06` separate Next dist dirs for test servers (David Zhao) |
| Uncommitted teammate/agent work found | untracked v2 starts: `packages/engineering/rivet_engine/design_ir/models.py` (strict DesignSpec IR, patches), `services/api/rivet_api/design/models.py` (API v2 models), `services/api/rivet_api/design/artifacts.py` (SQLite DesignStore: sessions, content-addressed assets, jobs, events, revisions, cache), `apps/web/src/lib/rivet/design-v2-types.ts`, `design-v2-source.ts` (typed client + resumable SSE), `apps/web/scripts/render-design.mjs` (six-camera headless render of a GLB). No tests, not wired to routes. A half-finished `.venv-runtime` with mixed OCP builds was left behind and is not used. |
| Baseline tests | engine `pytest` 648 passed, 4 skipped; API `pytest` 602 passed, 2 skipped (system Python) and 600 passed, 4 skipped (Python 3.11 venv); web Vitest 58 files / 528 passed |

## Requirement inventory (before)

| Req | Expected behaviour | Rivet module before | Status | Integration gap | Test evidence | Owner / commit |
|---|---|---|---|---|---|---|
| A1 | Text to typed distilled intent with 3-6 signature features, proportions, limits | `agents/vision.py` (IntentSpec for rover only), `concept/model.py` (title/object_type/summary) | partial | No signature features, proportions or simplifications; everything non-rover becomes a concept or the rover | `tests/test_vision.py`, `tests/test_concept.py` | A lane; `9554de4` |
| A2 | Reference image hashed, observed, controls geometry | `assets/store.py` (safe upload), `image_features.py` (sensor height only) | partial | No hash in provenance; only sensor height moves geometry | `tests/test_image_features.py` | B lane |
| A3 | Concept art for text-only prompts via injected image provider | none | missing | No image-generation port | none | |
| A4 | Aligned side/rear/top views with camera labels and contradiction checks | none | missing | | none | |
| A5 | Strict DesignSpec body hierarchy with anchors and attachments | `design_ir/models.py` (untracked draft) | partial | Not compiled, not validated in tests | none | untracked draft |
| B1 | Three diverse candidates concurrently | none | missing | | none | |
| B2 | Deterministic multi-body compiler with attachment DAG | `mounts.py` (fixed rover template) | partial | Template only | `tests/test_mounts.py` | B lane |
| B3 | Parametric CAD shapes and features, GLB/STEP/STL | none (procedural three.js recipes only) | missing | No CAD kernel | none | |
| B4 | Occupancy/voxel/mesh route for organic shapes | none | missing | | none | |
| B5 | Connectivity-first layout and repair | `concept/model.py` `floating_parts` (AABB check, one model retry) | partial | Model-written world poses; no solver | `tests/test_concept.py` | `9554de4` |
| B6 | Functional styling and surface treatment from references | concept primitives with colours | partial | No fillets, cut-outs, grills from geometry | none | |
| B7 | Real variants: 4WD, distinct references, sensor height | rover template; sensor height offset only | partial | 4WD impossible; references cannot change chassis | `tests/test_image_features.py` | |
| B8 | purchased / fabricated / concept_visual body classes | v1 catalog vs `concept.*` entries | partial | No fabricated class | `tests/test_concept.py` | |
| B9 | VL53L0X renders as a ToF breakout, exact catalog mapping | `recipes/index.tsx`: empty `CATALOG_RECIPES`, `/distance|ultrasonic|range|sonar/` to twin-drum ultrasonic | broken | Wrong sensor visual | none | C lane |
| C1 | Broadphase + narrowphase collisions, contact vs penetration | `validators/mechanical.py` (AABB overlap on template) | partial | No mesh narrowphase, no sweep | `tests/test_constraints.py` | |
| C2 | Connectivity/mount checks, DAG, no floating parts | template mounts; concept AABB touch | partial | | | |
| C3 | Support polygon, COM, margin, uncertainty | none | missing | | none | |
| C4 | Deterministic repair, logged | `repair.py` (template substitutions/offsets) | partial | Template only | `tests/test_repair.py` | |
| C5 | Model-guided targeted patch repair with rollback | concept: one retry for floating parts | partial | No typed patches | | |
| C6 | Engine functional gates stay authoritative | `rivet_engine` validators | working (rover) | Must stay in the v2 path | engine suite | |
| C7 | Separate visual/geometric/manufacturing/electrical/firmware/buildability statuses | single `verification.overall` | partial | | | |
| D1 | Six consistent renders per candidate from real assets | `render-design.mjs` (untracked, unused) | partial | Not wired | none | |
| D2 | Multimodal VisualReview with per-body issues | none | missing | | none | |
| D3 | Rank by visual quality subject to feasibility; user choice | none | missing | | none | |
| D4 | Critic-informed revision with best-so-far | none | missing | | none | |
| D5 | Select candidate, NL changes, undo/redo, job-bound choices | v1 revisions + concept NL edits | partial | No candidates | `tests/test_edits.py` | |
| E1 | Stream partial geometry assets | none (status events only) | missing | | none | |
| E2 | Typed SSE with replay, durable jobs, cancel | `orchestration/jobs.py` (memory + JSON mirror, no cancel) | partial | Not durable mid-run; no cancel | `tests/test_jobs_events.py` | |
| E3 | Render arbitrary generated assemblies with layers | `RoverScene` (v1 plans, concept primitives) | partial | No GLB assemblies | web suite | |
| E4 | Candidate comparison UI | none | missing | | none | |
| E5 | Robust free-text geometry edits | `agents/editor.py` five ops; concept NL edits via model | partial | | `tests/test_edits.py` | |
| E6 | Persist inputs, hashes, candidates, renders, scores, lineage | `orchestration/versions.py` (plans only) | partial | | `tests/test_versions.py` | |
| E7 | Content-addressed cache and replay | none | missing | | none | |
| E8 | GLB/STEP/STL/BOM/steps/provenance exports | `routes/exports.py` (BOM CSV, build.json, firmware) | partial | No geometry exports | `tests/test_exports.py` | |
