# Rivet

AI-assisted hardware-building platform for the **SOON Hackathon**. Upload a photo of any object (or describe one) and Rivet renders it as an interactive 3D model built from separate parts. For the supported rover it goes further: a component-backed design with a real BOM, wiring, assembly steps, simulation and ESP32 starter firmware.

Rivet has two build paths:

| Path | Input | Output | Honesty label |
|---|---|---|---|
| **3D concept model** (default) | Any photo or description: drones, vehicles, furniture, appliances, gadgets, toys | Selectable 3D parts made of shaped primitives (box, cylinder, propeller, wheel, ring, ...) in the colors and materials of the photo; for powered devices, inferred internal boards and wiring, shown with **X-ray**; plain-language edits as new revisions; exploded view | *Concept model · appearance only*: no real products, prices, wiring checks or firmware; internal parts are marked inferred |
| **Real-parts rover** | A small wheeled-robot reference or prompt | Engine-verified differential-drive rover from cataloged parts: BOM with purchase links, wiring, assembly steps, 2D simulation, firmware | Status and findings from the engineering engine |

The rover is also the fallback: if a concept model cannot be built (provider error or unusable reply), the job builds the closest supported rover and says so in the build notes.

## Specs (start here)

| Document | Role |
|---|---|
| [`docs/project.md`](docs/project.md) | Product requirements, UX, scope, and language |
| [`docs/implementation.md`](docs/implementation.md) | Tech stack, contracts, ownership lanes, schedule, and tests |
| [`contracts/api.md`](contracts/api.md) | Frozen v1 REST API, error and job-event contract; JSON schemas sit next to it. Validate with `uv run scripts/validate_contracts.py` |

If the two conflict on schema or safety/verification rules, follow `implementation.md`, then reconcile both in a reviewed change.

## Stack (fixed defaults)

| Layer | Choice |
|---|---|
| Monorepo | `pnpm` workspace + Python (`uv` or `venv`) |
| Frontend | Next.js App Router, TypeScript, React, Tailwind, Three.js / R3F |
| Backend | FastAPI, Pydantic v2, Python 3.11+ |
| Engineering | Pure Python catalog + validators (`packages/engineering`) |
| Firmware | PlatformIO / ESP32 templates |
| Testing | `pytest`, Vitest, Playwright, PlatformIO compile |

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io/)
- Python 3.11+
- [uv](https://github.com/astral-sh/uv) recommended (or a standard `venv`)
- Optional: PlatformIO for firmware compile checks
- Optional: OpenAI (or other) API key for live vision — fixture mode works without it

## Quick start

Install the workspace, then start both services with one command. No team key or paid
provider is needed for the saved examples.

```bash
pnpm install
# Recommended Python setup:
cd services/api
uv sync --extra dev
cd ../..
pnpm dev
```

Without `uv`, install the same dependencies into a standard virtual environment:

```bash
python3 -m venv services/api/.venv
services/api/.venv/bin/pip install -e 'services/api[dev]' -e 'packages/engineering[dev]'
pnpm dev
```

The supervisor labels API/web output, checks ports, and stops both services on Ctrl-C.
Defaults: web `http://localhost:3000/studio`, API `http://localhost:8000/api/health`.
`pnpm dev:api` / `pnpm dev:web` start individual services. Set `RIVET_API_PORT` or
`RIVET_WEB_PORT` to avoid an existing server. It never overwrites `apps/web/.env.local`.

Environment priority is nonempty shell variables, root `.env.local`, then root `.env`.
If `.env` is encrypted or missing, `.env.example` supplies safe defaults automatically.
Personal credentials belong in gitignored root `.env.local`; never replace the tracked
encrypted `.env` with plaintext. Team-key users can run `scripts/setup-env.sh /path/to/key`.
Only the two public web settings are written to a missing `apps/web/.env.local`; provider
keys are removed from the web subprocess environment.

For the real engine with offline interpretation, set `RIVET_MODE=live` and
`RIVET_VISION_PROVIDER=mock` in root `.env.local`, then run `pnpm dev`. The studio uses
HTTP automatically unless `NEXT_PUBLIC_RIVET_USE_FIXTURES` explicitly overrides it.
Mock interpretation does not read the image and is disclosed as fallback; in fixture or mock
mode a concept request returns a saved quadcopter concept. In the intake, **Generate 3D model**
builds a concept of whatever the image or text shows (`interpretation_choice: "concept_model"`);
**Check for a real-parts rover build** shows an interpretation for confirmation before an
engine build, and unsupported families there require an explicit closest-rover choice. Saved
examples open immediately without a provider.

A live provider is needed for concept models of your own photos. For live image interpretation, install `services/api[live]`, then configure
`RIVET_MODE=live`, `RIVET_VISION_PROVIDER=openai`, `RIVET_VISION_MODEL=gpt-4o` and
`OPENAI_API_KEY` in root `.env.local`. See [provider verification](services/api/README.md)
for the opt-in tests. Backboard image input remains unsupported for the demo.

```bash
pnpm test:web
pnpm test:api
pnpm test:engineering
pnpm --filter web e2e
pnpm --filter web e2e:acceptance
python3 scripts/final_verification.py --offline
```

The lane scripts prefer `uv` and fall back to `python3`; for a virtual environment use its Python with
`-m pytest` in each Python project. Browser tests require
`pnpm --filter web exec playwright install chromium` (Linux CI also installs system dependencies).
CI checks contracts, Python suites, web typecheck/tests/build, offline browser regressions,
and real-engine browser acceptance. Firmware compilation is a separate optional job.
The [verification receipt](docs/final-verification.md) distinguishes executed software checks
from live-provider, hardware-fit and human rehearsal gates.

## Team lanes

| Role | Owns | Branch |
|---|---|---|
| Dev A | `services/api/**` | `feat/a-agents-api` |
| Dev B | `packages/engineering/**` | `feat/b-engineering` |
| Dev C | `apps/web/**` (until design handoff) | `feat/c-3d-sim` |
| Designer | `design/**` (+ UI/styles after lock) | `design/visual-system` |

Shared contracts live in `contracts/` and `fixtures/`. Do not invent interfaces — read sections 0–5 of `implementation.md` before writing code.

## Non-negotiables (short)

1. One versioned `BuildPlan` drives 3D, BOM, pins, assembly, firmware, and simulation.
2. Real catalog parts and links only — never invent prices, stock, or SKUs. The API enforces this: it rejects unbacked `verified_product` BOM rows, synthetic parts in live plans, and BOM/firmware exports of synthetic builds (see `services/api/README.md`).
3. AI proposes; deterministic code validates.
4. Missing evidence → `UNKNOWN` / `WARN` / `NEEDS_REVIEW`, not a fake pass.
5. Only the rover is engineered. Every other object is a labeled 3D concept (appearance plus inferred internals), never presented as buildable, priced or verified.

## Demo target

**Any photo:** upload a photo of a drone (or any object) and click **Generate 3D model**. Turn on **X-ray** to see the inferred flight controller, ESCs and wiring inside, then ask for a change such as *“Make the propellers blue and add a camera.”*

**Real-parts rover:** upload a small wheeled-robot reference, choose **Check for a real-parts rover build**, and ask: *“Design something like this that can avoid obstacles. Use real parts and explain how to build it.”*

Follow-up: *“Make it cheaper and move the sensor higher.”*

## License / attribution

Do not copy source, UI assets, or imagery from unlicensed third-party projects (including Bricked) without a confirmed license or permission. Study architecture; reimplement original code.
