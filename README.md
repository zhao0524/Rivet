# Rivet

AI-assisted hardware-building platform, built for the **SOON Hackathon**: describe an object or upload a photo, and Rivet turns it into an interactive 3D model built from separate parts. For the supported rover it goes further, with a design made from cataloged parts, a real BOM, wiring, assembly steps, a simulation and ESP32 starter firmware.

## What it does

Rivet has two build paths:

| Path | Input | Output | Honesty label |
|---|---|---|---|
| **3D concept model** (default) | Any photo or description: drones, vehicles, furniture, appliances, gadgets, toys | Selectable 3D parts made of shaped primitives (box, cylinder, propeller, wheel, ring, ...) in the colors and materials of the photo; for powered devices, inferred internal boards and wiring, shown with **X-ray**; plain-language edits as new revisions; exploded view | *Concept model · appearance only*: no real products, prices, wiring checks or firmware; internal parts are marked inferred |
| **Real-parts rover** | A small wheeled-robot reference or prompt | Engine-verified differential-drive rover from cataloged parts: BOM with purchase links, wiring, assembly steps, 2D simulation, firmware | Status and findings from the engineering engine |

The rover is also the fallback: if a concept model cannot be built (provider error or unusable reply), the job builds the closest supported rover and says so in the build notes.

Key features in the code:

- **Guided project flow** in the web app: landing page → `/new` → `/p/[id]/workspace` (files and build steps, 3D model, chat that asks budget/size questions) → `review`, `parts`, `wiring`, `buy`, `build` steps → `done`. Projects are saved in the browser (localStorage).
- **Deterministic engineering engine** (`packages/engineering`): catalog, placement, netlist and pin map, validators, bounded repair, BOM and assembly steps. AI proposes; this code validates.
- **FastAPI backend** (`services/api`): vision providers (mock, OpenAI, Backboard), jobs with server-sent events, revisions and edits, BOM CSV / `build.json` / firmware ZIP exports, image uploads, product resolution and where-to-buy offers, and an optional Estelle grounding client.
- **v2 geometry-first design workspace** at `/design` (API routes under `/api/v2`), and a **sandbox** of catalogue products at `/sandbox`.
- **Fixture mode**: everything runs offline from saved examples, with no API keys.

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | `pnpm` workspace + Python projects managed with `uv` (or `venv`) |
| Frontend | Next.js 14 App Router, TypeScript, React 18, Tailwind CSS, Three.js / React Three Fiber |
| Backend | FastAPI, Pydantic v2, Python 3.11+ |
| Engineering | Pure Python catalog + validators (`packages/engineering`); optional geometry kernel (OCP, manifold3d) for the v2 design compiler |
| Firmware | PlatformIO / ESP32 templates |
| Testing | `pytest`, Vitest, Playwright, PlatformIO compile |

## Project structure

```
apps/web/              Next.js app (flow screens, 3D stage, simulator, data layer in src/lib/rivet)
services/api/          FastAPI app (rivet_api): vision, orchestration, exports, firmware, offers
packages/engineering/  rivet_engine: catalog, solver, validators, BOM, assembly, geometry
contracts/             Frozen v1 REST API (api.md) and JSON Schemas
fixtures/              Shared, versioned fixtures every lane tests against
design/                Visual system: principles, tokens, component specs, screenshots
docs/                  Product and implementation specs, status board (context.md), audits
scripts/               Dev supervisor, env loader, contract validation, verification tools
bench/                 Recorded live-provider visual benchmark runs
.github/workflows/     CI (ci.yml) and the daily supplier-link check (supplier-links.yml)
```

## Specs

| Document | Role |
|---|---|
| [`docs/project.md`](docs/project.md) | Product requirements, UX, scope, and language |
| [`docs/implementation.md`](docs/implementation.md) | Tech stack, contracts, ownership lanes, schedule, and tests |
| [`docs/context.md`](docs/context.md) | Shared status board: task board, log, decisions, blockers |
| [`contracts/api.md`](contracts/api.md) | Frozen v1 REST API, error and job-event contract; JSON schemas sit next to it |
| [`services/api/README.md`](services/api/README.md) | API modes, environment variables, providers, offers, exports |
| [`packages/engineering/README.md`](packages/engineering/README.md) | Engine entry points, catalog and verification |
| [`docs/SKILLS/README.md`](docs/SKILLS/README.md) | Agent skills installed in this repo and how to add more |

If the two specs conflict on schema or safety/verification rules, follow `implementation.md`, then reconcile both in a reviewed change.

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io/) 10 (`packageManager` is pinned in `package.json`)
- Python 3.11+
- [uv](https://github.com/astral-sh/uv) recommended (or a standard `venv`)
- Optional: PlatformIO for firmware compile checks
- Optional: an OpenAI API key for live vision; fixture mode works without it

## Quick start

Install the workspace, then start both services with one command. No team key or paid
provider is needed for the saved examples.

```bash
pnpm install
cd services/api && uv sync --extra dev && cd ../..
pnpm dev
```

Without `uv`, install the same dependencies into a standard virtual environment:

```bash
python3 -m venv services/api/.venv
services/api/.venv/bin/pip install -e 'services/api[dev]' -e 'packages/engineering[dev]'
pnpm dev
```

`pnpm dev` (`scripts/dev.sh`) labels API/web output, checks ports, and stops both services on Ctrl-C.
Defaults: web `http://localhost:3000`, API `http://localhost:8000/api/health`.
`pnpm dev:api` / `pnpm dev:web` start individual services. Set `RIVET_API_PORT` or
`RIVET_WEB_PORT` to avoid an existing server. It never overwrites `apps/web/.env.local`.

### Modes

- **Fixture (default):** saved examples, no provider. In fixture or mock mode a concept request returns a saved quadcopter concept.
- **Real engine, offline interpretation:** set `RIVET_MODE=live` and `RIVET_VISION_PROVIDER=mock` in root `.env.local`, then run `pnpm dev`. Mock interpretation does not read the image and is disclosed as fallback.
- **Live vision:** install `services/api[live]`, then set `RIVET_MODE=live`, `RIVET_VISION_PROVIDER=openai`, `RIVET_VISION_MODEL=gpt-4o` and `OPENAI_API_KEY` in root `.env.local`. A live provider is needed for concept models of your own photos. See [provider verification](services/api/README.md) for the opt-in tests. Backboard image input remains unsupported for the demo.

The web app uses the API automatically unless `NEXT_PUBLIC_RIVET_USE_FIXTURES` explicitly overrides it.
In the workspace chat, a request for something other than the supported rover asks whether to
**Build a 3D model of this** (`interpretation_choice: "concept_model"`) or **Use the closest supported
rover** (`closest_supported_rover`), then asks for budget and size. The v2 `/design` routes are enabled
only when `rivet_engine` is importable by the API (e.g. `services/api/.venv/bin/pip install -e 'packages/engineering[geometry]'`
or `RIVET_MODE=live`, which adds `packages/engineering` to the API's `PYTHONPATH`).

## Environment variables

[`.env.example`](.env.example) lists every variable with safe defaults. Load order (`scripts/load-env.sh`):
nonempty shell variables win, then root `.env.local`, then root `.env`. The tracked `.env` is
encrypted with git-crypt; while it is encrypted or missing, `.env.example` is used instead. Put
personal keys in gitignored root `.env.local`; team-key holders can run `scripts/setup-env.sh /path/to/key`.
Provider keys are removed from the web subprocess environment.

| Group | Variables | Purpose |
|---|---|---|
| API mode | `RIVET_MODE`, `RIVET_ENV`, `RIVET_DATA_ROOT`, `RIVET_DEMO_FIXTURE` | `fixture` or `live`; runtime data directory; saved demo build |
| Vision | `RIVET_VISION_PROVIDER`, `RIVET_VISION_MODEL`, `OPENAI_API_KEY`, `BACKBOARD_API_KEY`, `BACKBOARD_LLM_PROVIDER`, `BACKBOARD_BASE_URL` | Intent interpretation provider (`mock`, `openai`, `backboard`) and its credentials |
| Parts and offers | `RIVET_RESOLVER`, `RIVET_OFFERS_PROVIDER`, `BRAVE_SEARCH_API_KEY`, `NEXAR_CLIENT_ID`/`SECRET`, `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID`/`SECRET`, `ELEMENT14_API_KEY` | Product resolution and where-to-buy offers (`stub`, `recorded`, `live`); supplier API keys are optional |
| v2 design | `RIVET_3D_MODE`, `RIVET_DESIGN_MODEL`, `RIVET_IMAGE_PROVIDER`, `RIVET_IMAGE_MODEL`, `RIVET_IMAGE_SIZE`, `RIVET_IMAGE_QUALITY`, `RIVET_RENDERER` | Geometry-first design workspace: live or fixture authoring, image previews, renderer |
| Estelle | `RIVET_ENABLE_ESTELLE`, `RIVET_ESTELLE_MODE`, `RIVET_ESTELLE_REPO` | Optional repository-grounding client |
| Local dev | `RIVET_API_PORT`, `RIVET_WEB_PORT` | Ports used by `scripts/dev.sh` |
| Web (public) | `NEXT_PUBLIC_RIVET_API_URL`, `NEXT_PUBLIC_RIVET_USE_FIXTURES` | API rewrite target and fixture toggle; `pnpm dev` derives them if unset |

Full per-variable notes for the API are in [`services/api/README.md`](services/api/README.md#environment-variables).

## Scripts

Root `package.json`:

| Command | What it runs |
|---|---|
| `pnpm dev` / `pnpm dev:api` / `pnpm dev:web` | Both services / API only / web only, via `scripts/dev.sh` |
| `pnpm build` | Production build of the web app with env loaded |
| `pnpm lint`, `pnpm typecheck` | `tsc --noEmit` in `apps/web` |
| `pnpm test` | `test:web`, `test:engineering`, `test:api` in sequence |
| `pnpm test:web` | Vitest in `apps/web` |
| `pnpm test:api`, `pnpm test:engineering` | `pytest` in `services/api` / `packages/engineering` (uses `uv` if installed, else `python3`) |

Other checks:

```bash
uv run scripts/validate_contracts.py       # fixtures and examples against contracts/ schemas
pnpm --filter web e2e                      # Playwright fixture suite (apps/web/e2e)
pnpm --filter web e2e:acceptance           # Playwright real-engine acceptance (apps/web/e2e-acceptance)
python3 scripts/final_verification.py --offline
```

Browser tests require `pnpm --filter web exec playwright install chromium` (Linux CI also installs
system dependencies). For a virtual environment, use its Python with `-m pytest` in each Python project.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs independent jobs: contract/fixture
validation, engine pytest, API pytest (fixture mode), web lint/typecheck/Vitest/build, a verified-parts
golden set from recorded pages, and an optional PlatformIO firmware compile.
[`supplier-links.yml`](.github/workflows/supplier-links.yml) checks catalog purchase links daily and opens
an issue when one breaks. The [verification receipt](docs/final-verification.md) distinguishes executed
software checks from live-provider, hardware-fit and human rehearsal gates.

## Deployment

`.vercelignore` excludes everything except the web app (`services/`, `packages/`, `scripts/`, docs and
tests are ignored), so a Vercel deployment serves `apps/web` only. Point `NEXT_PUBLIC_RIVET_API_URL` at a
running API, or set `NEXT_PUBLIC_RIVET_USE_FIXTURES=true` to use the built-in fixtures.

## Team lanes

| Role | Owns | Branch |
|---|---|---|
| Dev A | `services/api/**` | `feat/a-agents-api` |
| Dev B | `packages/engineering/**` | `feat/b-engineering` |
| Dev C | `apps/web/**` (until design handoff) | `feat/c-3d-sim` |
| Designer | `design/**` (+ UI/styles after lock) | `design/visual-system` |

Shared contracts live in `contracts/` and `fixtures/`. Contributor rules are in [`docs/AGENTS.md`](docs/AGENTS.md)
and [`docs/agent-collaboration.md`](docs/agent-collaboration.md). Do not invent interfaces: read sections 0–5 of
`implementation.md` before writing code.

## Non-negotiables

1. One versioned `BuildPlan` drives 3D, BOM, pins, assembly, firmware, and simulation.
2. Real catalog parts and links only: never invent prices, stock, or SKUs. The API enforces this: it rejects unbacked `verified_product` BOM rows, synthetic parts in live plans, and BOM/firmware exports of synthetic builds (see `services/api/README.md`).
3. AI proposes; deterministic code validates.
4. Missing evidence → `UNKNOWN` / `WARN` / `NEEDS_REVIEW`, not a fake pass.
5. Only the rover is engineered. Every other object is a labeled 3D concept (appearance plus inferred internals), never presented as buildable, priced or verified.

## Demo target

**Any photo:** upload a photo of a drone (or any object) and choose **Build a 3D model of this**. On the review step, **Show inside parts** (X-ray) reveals the inferred flight controller, ESCs and wiring, then **Change something** asks for an edit such as *“Make the propellers blue and add a camera.”*

**Real-parts rover:** upload a small wheeled-robot reference and ask: *“Design something like this that can avoid obstacles. Use real parts and explain how to build it.”*

Follow-up: *“Make it cheaper and move the sensor higher.”*

## Attribution

There is no LICENSE file in this repository. Do not copy source, UI assets, or imagery from unlicensed third-party projects (including Bricked) without a confirmed license or permission. Study architecture; reimplement original code.
