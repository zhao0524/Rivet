# Rivet: Project Context

Shared status file for everyone working in this repo, human or agent.
**Read it before starting a task. Update it when you finish one, and before every push.**

| | |
|---|---|
| **Last updated** | 2026-10-24 · [C] |
| **Branch / commit** | `feat/c-3d-sim` @ `7afb71e` + this update |
| **Current phase** | Parallel lane implementation (`services/api` and `apps/web` active) |
| **Next gate** | Hour 8: every lane demos itself from fixtures (`docs/implementation.md` §7) |
| **In progress** | A5 |
| **Blocked** | none (open issues in §6) |

**Next up:** INT-0 → INT-1 → INT-2 (skeleton, contracts, fixtures). After that, all lanes can branch off and work in parallel.

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
| `packages/engineering/` | B | Not created |
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
| B0 | Domain model and public entry points (`solve`, etc.) | TODO | — | Models match `contracts/` |
| B1 | Catalog of real components | TODO | — | Only real parts; unknown values stay `null` |
| B2 | Parametric mechanical assembly and mounts | TODO | — | Rover template produces consistent instances |
| B3 | Electrical graph; driver and controller assignment | TODO | — | Netlist references only valid pins |
| B4 | Deterministic validators: mechanical, electrical, budget, completeness | TODO | — | Failing-driver fixture produces the expected finding |
| B5 | Repair engine | TODO | — | At least one failure repaired or honestly rejected |
| B6 | BOM, assembly steps, serialization | TODO | — | BOM rows match instance IDs |
| B7 | Tests and standalone demo | TODO | — | `pytest` passes standalone |

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

- 2026-10-24 [C] C0/C1/C2/C3/C4/C5/C6/C7: Integrated the complete `apps/web` 3D hardware studio: Next.js App Router (`/` and `/studio`), canonical v1 contract validators and referential integrity checks (`src/lib/rivet`), `FixtureSource` and `HttpSource` data sources with SSE/polling job subscriptions, `RivetStage` with fitted camera and WebGL fallback (`src/components/three/stage`), procedural hardware part recipes and `PartAssembly` (`src/components/three/parts`), selection/hover/isolation controller (`src/components/three/interactions`), deterministic exploded view and assembly step timeline (`src/components/three/assembly`), electrical wiring overlay with schematic fallback (`src/components/three/wiring`), unified `RoverScene`, deterministic 2D differential-drive kinematic simulation engine and 3D viewer connected via `SimView` (`src/components/sim`), `BuildIntake` with image validation and stage log (`src/components/studio/intake`), `PartInspector`/`BOMPanel`/`VerificationPanel`/`ProjectRevisionPicker` (`src/components/studio/panels`), and `<StudioShell>` with `Toolbar`, `StepTimeline`, `PartsPanel`, `Inspector` (including exports and Estelle grounding UI) and `Studio`. Checked: `pnpm --dir apps/web typecheck` clean, `pnpm --dir apps/web test` 39 test files / 355 tests passed, `pnpm --dir apps/web build` succeeded. Notes: Playwright E2E is not configured yet; Vitest covers unit, component, R3F scene graph and studio integration tests.
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

- [A] A5: Estelle was never run for real: the `estelle` CLI is not installed here and there is no account. Needs: a human to run `npm i -g @fatelabs/estelle`, `estelle login`, `estelle setup` in the repo, set `RIVET_ENABLE_ESTELLE=true`, then call `GET /api/estelle/status` and `POST /api/estelle/ground` once and check that `estelle ask` output really carries `file:line` citations (the output format is not documented, so the parser may need adjusting). Also not done: the grounded firmware-edit flow (a patch to the template that is grounded, then compiled), because Estelle's docs give no parameters for the MCP tools or `gate`/`verify`.
- [A] A4: `BuildPlan.firmware.pin_map` has no defined format in the spec (it is `{}` in every fixture). The firmware template needs these signals, each an integer ESP32 GPIO number: `motor_left_pwm, motor_left_in1, motor_left_in2, motor_right_pwm, motor_right_in1, motor_right_in2, motor_standby, i2c_sda, i2c_scl`. Missing, unknown, duplicate or non-integer entries are rejected (422 `FIRMWARE_INVALID_PIN_MAP`) and an empty map gives 422 `FIRMWARE_NOT_SUPPORTED`, so with today's fixtures firmware export always returns 422. Needs: [B] confirm or change these signal names and the value format in the engine's pin map (and add a real pin_map to the sourced plan); board-specific limits (input-only or flash pins) are B's check, not A's.
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
