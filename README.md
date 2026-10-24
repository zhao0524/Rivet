# Rivet

AI-assisted hardware-building platform for the **SOON Hackathon**. Upload an inspiration image or describe a build; Rivet turns it into a component-backed design with interactive 3D, a real BOM, wiring, assembly steps, and ESP32 starter firmware.

**Hackathon proof:** a differential-drive indoor rover end to end. Other product families stay labeled *planned* until implemented.

## Specs (start here)

| Document | Role |
|---|---|
| [`project.md`](project.md) | Product requirements, UX, scope, and language |
| [`implementation.md`](implementation.md) | Tech stack, contracts, ownership lanes, schedule, and tests |

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

## Quick start (after bootstrap)

This repo currently holds the product and implementation specs. Once the monorepo skeleton lands (`apps/web`, `services/api`, `packages/engineering`), use:

```bash
# Env
cp .env.example .env

# JS workspace
pnpm install

# Python API + engineering (example with uv)
cd services/api && uv sync
cd ../packages/engineering && uv sync

# Dev processes (typical)
# Terminal 1 — API
cd services/api && uv run uvicorn rivet_api.main:app --reload --port 8000

# Terminal 2 — Web
pnpm --filter web dev
```

Default API: `http://localhost:8000`  
Default web: `http://localhost:3000`

Set `RIVET_MODE=fixture` and `NEXT_PUBLIC_RIVET_USE_FIXTURES=true` so every lane can demo from checked-in fixtures without live AI.

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
2. Real catalog parts and links only — never invent prices, stock, or SKUs.
3. AI proposes; deterministic code validates.
4. Missing evidence → `UNKNOWN` / `WARN` / `NEEDS_REVIEW`, not a fake pass.
5. Ship the rover flow before expanding scope.

## Demo target

Upload a small wheeled-robot reference and ask: *“Design something like this that can avoid obstacles. Use real parts and explain how to build it.”*

Follow-up: *“Make it cheaper and move the sensor higher.”*

## License / attribution

Do not copy source, UI assets, or imagery from unlicensed third-party projects (including Bricked) without a confirmed license or permission. Study architecture; reimplement original code.
