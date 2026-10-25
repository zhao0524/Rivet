# Browser acceptance: the demo path on the real engine

One ordered Playwright story (`demo-path.spec.ts`) that drives the app the way the demo does,
against a local API running the real engineering engine with the **mock** vision provider.
No API keys, no network. The fixture-only suite lives in `../e2e` and never starts an API.

What it covers, in order: `/new` with the reference image → Clarify (the interpretation is
read from the API first; no generate request until it is confirmed) → Generate (real job events)
→ Review (exactly the plan's blocking checks) → Parts (every visible component, prices, spec
sources) → Wiring & firmware (connections, pin map, firmware ZIP from the API) → Buy (every BOM
line, prices, link statuses, cart links, both CSVs) → Build (every assembly step, safety gate,
firmware card) → Done → an edit through Iterate (whatever the API answers is what the modal
must show) → a structured edit on the API, which Review then loads as revision 2.

## Run

```sh
pnpm --filter web e2e:acceptance
# or, from apps/web
npx playwright test -c playwright.acceptance.config.ts
```

The config starts both servers itself and stops them afterwards:

- API: `python -m uvicorn rivet_api.main:app` on `E2E_ACCEPTANCE_API_PORT` (default 8917),
  `RIVET_MODE=live`, `RIVET_VISION_PROVIDER=mock`, a fresh `RIVET_DATA_ROOT` per run.
- Web: `next dev` on `E2E_ACCEPTANCE_WEB_PORT` (default 3917) in HTTP mode
  (`NEXT_PUBLIC_RIVET_USE_FIXTURES=false`, `NEXT_PUBLIC_RIVET_API_URL` pointing at the API).

## Environment variables

| Variable | Meaning |
| --- | --- |
| `RIVET_PYTHON` | Interpreter with the API's dependencies, e.g. `services/api/.venv/bin/python`. Default `python3`. The engine is put on `PYTHONPATH` from `packages/engineering`. |
| `E2E_CHANNEL` | Browser channel, e.g. `chrome`, when Playwright's own Chromium is not downloaded. Unset in CI. |
| `E2E_ACCEPTANCE_WEB_CWD` | Directory to run `next dev` from. Default: `apps/web`. Point it at a copy of `apps/web` (sources plus a `node_modules` symlink) when another `next dev` already serves this directory: two dev servers share one `.next/` and corrupt it. |
| `E2E_ACCEPTANCE_WEB_PORT`, `E2E_ACCEPTANCE_API_PORT` | Ports, chosen so a developer's own servers are never reused. |
| `RIVET_E2E_DATA_ROOT` | Reuse a data directory instead of a temporary one (it is then not deleted). |

Reports: `playwright-report/acceptance`, traces and screenshots under `test-results/acceptance`.
