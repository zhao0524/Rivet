# Rivet: Project Context

Shared status file for everyone working in this repo, human or agent.
**Read it before starting a task. Update it when you finish one, and before every push.**

| | |
|---|---|
| **Last updated** | 2026-10-24 · [A] |
| **Branch / commit** | `main` @ `08fc92f` + this update |
| **Current phase** | Pre-bootstrap: only the specs exist |
| **Next gate** | Hour 8: every lane demos itself from fixtures (`docs/implementation.md` §7) |
| **In progress** | none |
| **Blocked** | none (1 open issue in §6) |

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
| `services/api/` | A | Started: FastAPI app, settings, error envelope, `/api/health`; Pydantic models for IntentSpec, BuildPlan, JobEvent and a plan integrity guard (`contract.py`). No other routes yet |
| `packages/engineering/` | B | Not created |
| `apps/web/` | C | Not created |
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
| A1 | Image upload and input normalization | TODO | — | Upload returns an asset id; bad input returns a typed error |
| A2 | Pipeline: vision → IntentSpec → engine → BuildPlan, with jobs and SSE | TODO | — | Fixture image → saved BuildPlan through job events |
| A3 | Project storage, edits, revisions | TODO | — | An edit creates a new revision with the same `build_id` |
| A4 | Firmware generator (ESP32 rover template) | TODO | — | Generated project is tied to `build_id` and `revision` |
| A5 | Estelle integration (real calls, honest fallback) | TODO | — | Real evidence captured, or its absence shown |
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
| C0 | Bootstrap: Next.js app and fixture loader | TODO | — | `pnpm --filter web dev` renders the fixture |
| C1 | Part-backed 3D renderer (top priority) | TODO | — | Fixture rover renders; parts are selectable |
| C2 | Exploded view and assembly timeline | TODO | — | Can explode the model and step through assembly |
| C3 | BOM and inspector (functional shell) | TODO | — | Selecting a part shows its catalog data and links |
| C4 | Bounded rover simulation | TODO | — | Obstacle scenario runs and is labeled as an approximation |
| C5 | Image/prompt upload and streaming job UX | TODO | — | Job events shown live, or replayed from a fixture |
| C6 | Designer interface and handoff | TODO | — | Designer can swap UI components without touching engine code |
| C7 | Tests and standalone demo | TODO | — | Vitest and Playwright pass |

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
