# Rivet

AI-assisted hardware-building platform for the **SOON Hackathon**. Upload an inspiration image or describe a build; Rivet turns it into a component-backed design with interactive 3D, a real BOM, wiring, assembly steps, and ESP32 starter firmware.

**Hackathon proof:** a differential-drive indoor rover end to end. Other product families stay labeled *planned* until implemented.

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
Mock interpretation does not read the image and is disclosed as fallback. Intake shows an
interpretation for confirmation before generation; unsupported families require an explicit
closest-rover choice. Saved examples open immediately without a provider.

For live image interpretation, install `services/api[live]`, then configure
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
5. Ship the rover flow before expanding scope.

## Demo target

Upload a small wheeled-robot reference and ask: *“Design something like this that can avoid obstacles. Use real parts and explain how to build it.”*

Follow-up: *“Make it cheaper and move the sensor higher.”*

## License / attribution

Do not copy source, UI assets, or imagery from unlicensed third-party projects (including Bricked) without a confirmed license or permission. Study architecture; reimplement original code.
