# Rivet API (`services/api`)

Developer A's lane: image or text in, a validated `IntentSpec` out, a versioned `BuildPlan` back from the engineering engine, plus jobs with live events, edits, exports, firmware and an Estelle grounding client.

**What it does not do:** it never decides whether hardware is valid. The engineering engine (`packages/engineering`, lane B) owns `status`, `verification` and every finding. This API stores exactly what the engine returns and only checks that the plan is structurally coherent (unique ids, references that resolve, BOM counts).

Specs: [`docs/implementation.md`](../../docs/implementation.md) (contracts, section 6 lane A), [`docs/project.md`](../../docs/project.md). Status of the whole repo: [`docs/context.md`](../../docs/context.md).

## Quick start

```bash
cd services/api
python3.12 -m venv .venv                      # Python 3.11+ (uv works too: `uv sync`)
.venv/bin/pip install -e '.[dev]'             # add '.[live]' for the OpenAI vision provider
RIVET_MODE=fixture .venv/bin/python -m uvicorn rivet_api.main:app --port 8000

.venv/bin/python -m pytest -q                 # all tests run offline, no keys needed
.venv/bin/python scripts/smoke.py --in-process                 # end-to-end check, own temp data dir
.venv/bin/python scripts/smoke.py --base-url http://localhost:8000   # against a running server
```

Fixture mode needs nothing else: no engine package, no API keys, no PlatformIO, no Estelle.

## Modes and honest labels

| Mode | What you get | How it is labeled |
|---|---|---|
| `RIVET_MODE=fixture` (default) | A saved **synthetic** rover (`demo.*` parts, no real SKUs, no prices) | `provenance.generation_mode = "fixture"`, one `system` job event saying a saved demo build was loaded, `X-Rivet-Generation-Mode: fixture` on exports, a SAVED FIXTURE warning in firmware READMEs |
| `RIVET_MODE=live`, engine installed and ready | The engine's real plan | `generation_mode = "live"` (or `"fallback"` if the vision provider is the mock: the intent was not live) |
| `RIVET_MODE=live`, engine missing or not ready | The saved fixture again | `generation_mode = "fallback"` with a note. Set `allow_fallback=False` in code to get a 503 `ENGINE_UNAVAILABLE` instead |

To use the real engine: `.venv/bin/pip install -e ../../packages/engineering`, then `RIVET_MODE=live`. The API imports only `solve`, `apply_edit`, `verify` and `get_catalog` from `rivet_engine`. An engine whose entry points still raise `EngineNotImplementedError` counts as not ready.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `RIVET_MODE` | `fixture` | `fixture` or `live` |
| `RIVET_ENV` | `development` | Free-form environment label |
| `RIVET_DATA_ROOT` | `./data` | Where projects, jobs, uploads and Estelle evidence are written (gitignored) |
| `RIVET_DEMO_FIXTURE` | `rover_obstacle_v1` | Which saved build the fixture engine serves |
| `RIVET_VISION_PROVIDER` | `mock` | `mock` or `openai`. A bad value fails at startup |
| `RIVET_VISION_MODEL` | empty | Required for `openai` |
| `OPENAI_API_KEY` | unset | Server side only; required for `openai`. Never logged or returned |
| `RIVET_RESOLVER` | `stub` | Product resolver. Only `stub` exists until lane B's resolver lands; it is labeled a saved example and is refused in `RIVET_MODE=live` |
| `RIVET_ENABLE_ESTELLE` | `false` | Turn on the Estelle grounding client |
| `RIVET_ESTELLE_MODE` | `cli` | `cli` works; `mcp` always reports unavailable (tool parameters are undocumented) |
| `RIVET_ESTELLE_REPO` | this repo | Repository Estelle should ground against |

(`RIVET_CATALOG_PATH` in the root `.env.example` is not read by this API.)

## Endpoints

Errors always use `{"error": {"code", "message", "details", "retryable"}}`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ok, mode}`; every response also carries `X-Rivet-Mode` |
| GET | `/api/catalog` | `?category=` filters by `identity.category` |
| POST | `/api/assets/images` | multipart `file`; PNG/JPEG/WebP only, 10 MB, EXIF stripped, large images downscaled, per-session quota (`X-Rivet-Session`) |
| GET | `/api/assets/{asset_id}/preview` | The stored (re-encoded) image |
| POST | `/api/projects/generate` | 202 `{job_id, status: "queued", build_id: null}`; body `{input: {kind, image_asset_id?, user_text?}, requirements?}` |
| GET | `/api/jobs/{job_id}` | `{status, stage, progress, build_id?, revision?, error?}`; `progress` is null unless real stages were planned |
| GET | `/api/jobs/{job_id}/events` | Server-sent events with `id:` lines; reconnect with `Last-Event-ID` or `?last_event_id=` |
| POST | `/api/resolve` | 202 `{job_id, status: "queued", resolution_id: null}`; body `{input: {kind, image_asset_id?, user_text?}}`. Poll `GET /api/jobs/{job_id}` until it carries `resolution_id`. 503 `RESOLVER_UNAVAILABLE` in live mode without a live resolver |
| GET | `/api/resolutions/{resolution_id}` | The stored resolution: `outcome` (`exact_match`, `partial_match`, `no_match_with_alternatives`, `unsupported`), per-part status (`verified`, `inferred`, `not_found`, `stale`, `conflict`, `unavailable`), typical-for-category parts kept in their own list, and the evidence ledger |
| GET | `/api/resolutions/{resolution_id}/evidence` | Only the ledger: every record the resolver returned, with what the gates concluded about it |
| GET | `/api/projects/examples` | The saved build, labeled `fixture` |
| GET | `/api/projects/{build_id}` | `?revision=` optional |
| GET | `/api/projects/{build_id}/revisions` | Revision summaries |
| POST | `/api/projects/{build_id}/edits` | `{base_revision, operation, instruction?}`; 409 on a stale `base_revision`; 422 `UNSUPPORTED_EDIT` for anything but the five allowed operations |
| GET | `/api/projects/{build_id}/exports/bom.csv` | Null prices stay empty cells; the subtotal is the engine's, never computed here. 422 `EXPORT_REFUSED_SYNTHETIC` for a plan built from synthetic demo parts |
| GET | `/api/projects/{build_id}/exports/build.json` | The stored revision; every export carries `X-Rivet-Synthetic: true\|false` |
| GET | `/api/projects/{build_id}/exports/firmware.zip` | `?revision=`, `?compile=true`; header `X-Rivet-Compile-Status`. 422 `FIRMWARE_REFUSED` for synthetic or unbuildable plans |
| GET | `/api/estelle/status` | Enabled/available, plus the output of `estelle doctor` when reachable |
| POST | `/api/estelle/ground` | `{kind: "locate" \| "dependencies", name: "<identifier>"}` |

Allowed edit operations: `set_budget`, `set_behavior_parameter`, `replace_optional_sensor`, `set_mount_offset_within_template`, `change_appearance_color` (each with `"op"` and its own fields; see `rivet_api/agents/editor.py`).

```bash
curl -s -X POST localhost:8000/api/projects/generate -H 'content-type: application/json' \
  -d '{"input": {"kind": "text", "user_text": "small rover that avoids obstacles"}}'
curl -sN localhost:8000/api/jobs/<job_id>/events
curl -s -X POST localhost:8000/api/projects/<build_id>/edits -H 'content-type: application/json' \
  -d '{"base_revision": 1, "operation": {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 800}}'
```

## What has and has not been run

Verified by the automated tests (offline, fake backends): the whole API contract above, storage and revisions, SSE replay, upload hardening, sanitizing of model output, exports, firmware generation, engine error mapping.

**Has not been run for real (needs a human with the right setup):**

- **OpenAI vision:** the request shape in `OpenAIBackend` was never sent to the real API (no key was available).
- **PlatformIO compile:** `pio` was not installed, so the generated firmware has never been built; the pinned `espressif32@6.9.0` and `Adafruit VL53L0X@1.2.4` versions are unverified. `main.cpp` only passed a syntax check against stub headers. Compile status is `not_checked` unless `?compile=true` succeeds.
- **Estelle:** the CLI was never run (not installed, no account). Its MCP tool parameters and `verify`/`gate` usage are undocumented, so only `estelle ask` and `estelle doctor` are used, and its output format is an assumption (see `rivet_api/firmware/estelle.py`).
- **The real engine:** lane B's `rivet_engine` was not ready when this was written, so the real adapter is tested only against fakes.

**Open contract gap:** `BuildPlan.firmware.pin_map` has no defined format in the spec. The firmware template needs nine integer GPIO signals (`motor_left_pwm`, `motor_left_in1`, `motor_left_in2`, `motor_right_pwm`, `motor_right_in1`, `motor_right_in2`, `motor_standby`, `i2c_sda`, `i2c_scl`), and this API chose none of the numbers. Every current fixture ships an empty `pin_map`, so `firmware.zip` returns 422 until lane B provides one. Board-specific pin limits are lane B's check.

## Product resolution

`POST /api/resolve` implements the API half of `docs/plan-verified-parts.md`. Vision proposes a `ProductGuess` (`brand`, `model_guess`, `category`, `visible_features`, `confidence`, `verdict`; mock, OpenAI and Backboard providers return the same strict shape). The verdict is decided in code: `not_a_product`, an unsupported verdict, or `low` confidence all give `unsupported` with no brand or model, and a low-confidence reading asks for another photo instead of guessing. A resolver (`rivet_api/resolution/resolver.py`, an interface; lane B supplies the real one) returns candidates with `Evidence`. `rivet_api/resolution/gates.py` re-checks every record and decides the outcome; nothing a resolver or model says is trusted.

- `verified` needs a manufacturer or distributor host, https, a fresh record (within `ttl_days`), a content hash, `matched_text` containing the value, and an extractor other than `llm-extract`. Teardown sources and model extractions give `inferred`; community sources, a 200 page that lacks the value, and malformed records are rejected. A claim backed only by records older than their TTL is `stale` (needs refetching) and counts as a gap, never as verified.
- Two sources disagreeing on a SKU is `conflict`; values are listed, never averaged. A brand that differs from the identified brand never confirms a product.
- `exact_match` needs a verified product SKU and at least one part, every part `verified` or explicitly `unavailable`. Otherwise `partial_match`. No verified product gives `no_match_with_alternatives`. Alternatives and "typical" parts must themselves carry verified evidence or they are dropped, and typical parts are never merged into the product's parts.
- An offline or blocked resolver fails the job (`RESOLVER_OFFLINE` 503, `RESOLVER_BLOCKED` 502) and nothing is stored. Live mode with a non-live resolver is refused up front, and a resolver that reports itself live but returns sample data (reserved or documentation hosts such as `*.invalid`, `*.test`, `example.com`, IP addresses, or `STUB-`/`synthetic` values) fails the job with `SYNTHETIC_EVIDENCE_IN_LIVE_RESOLUTION` 502 and stores nothing. In fixture mode the stub works, and the stored `provenance.saved_example` is true with a banner.

Errors: `RESOLVER_UNAVAILABLE`, `RESOLVER_OFFLINE`, `RESOLVER_BLOCKED`, `RESOLVER_FAILED`, `RESOLVER_CONTRACT_VIOLATION`, `SYNTHETIC_EVIDENCE_IN_LIVE_RESOLUTION`, `VISION_PARSE_FAILED`, `RESOLUTION_NOT_FOUND`. Resolutions are written once to `<data root>/resolutions/`.

## Real products only

The engine owns hardware truth; the API refuses to relay sourcing it cannot back:

- A BOM row may say `verified_product` only if the catalog entry has a SKU and a verified `https` purchase link equal to the row's URL, and prices must equal the catalog's. Otherwise the plan is rejected (502 `ENGINE_CONTRACT_VIOLATION`) and nothing is stored.
- A plan labeled `live` that contains synthetic parts (`demo.*` / `synthetic.*` ids, a `SYNTHETIC` manufacturer, or a `SYNTHETIC*` catalog version) is rejected with 502 `SYNTHETIC_PARTS_IN_LIVE_PLAN`. Fixture and fallback plans are allowed and flagged.
- `GET /api/projects/{id}` adds `provenance.sourcing` (`synthetic`, `synthetic_catalog_ids`, `unverified_link_count`, `sku_missing_count`) on read only; it is never stored, because the engine rejects plans with unknown keys. `GET /api/catalog` adds `synthetic` and `synthetic_catalog_ids`.
- Sensor swaps to a part that is synthetic or lacks a SKU and a verified https purchase link are rejected before the engine is called (finding `api.real_product_only`).
- Kit items with no SKU or link (for example the chassis caster) are legitimate `manufacturer_reference_only` rows, not errors.

Not checked here: that a SKU or URL still resolves on the vendor's site. That needs a human or a scheduled link check.

## Safety notes

Generated firmware boots with the motors disabled (serial `g` enables, `x` disables), stops when the distance sensor gives no valid reading, and states the plan status and fixture label in its README. Nothing here is a certification, and the browser simulation is not the compiled code.
