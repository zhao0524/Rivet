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

The API reads only the process environment, never a `.env` file: export the variables in the shell that starts uvicorn.

| Variable | Default | Meaning |
|---|---|---|
| `RIVET_MODE` | `fixture` | `fixture` or `live` |
| `RIVET_ENV` | `development` | Free-form environment label |
| `RIVET_DATA_ROOT` | `./data` | Where projects, jobs, uploads and Estelle evidence are written (gitignored) |
| `RIVET_DEMO_FIXTURE` | `rover_obstacle_v1` | Which saved build the fixture engine serves |
| `RIVET_VISION_PROVIDER` | `mock` | `mock`, `openai` or `backboard` (see [Vision providers](#vision-providers)). Any other value fails at startup |
| `RIVET_VISION_MODEL` | empty | Model name sent to the provider. Required for `openai` (the demo uses `gpt-4o`, the only model tried) and for `backboard`; ignored by `mock` |
| `OPENAI_API_KEY` | unset | Required for `openai`. Server side only; never logged or returned |
| `BACKBOARD_API_KEY` | unset | Required for `backboard`. Server side only; never logged or returned |
| `BACKBOARD_LLM_PROVIDER` | `openai` | `backboard` only: which LLM provider Backboard routes the request to |
| `BACKBOARD_BASE_URL` | `https://app.backboard.io/api` | `backboard` only: Backboard API base URL |
| `RIVET_RESOLVER` | `stub` | Product resolver. Only `stub` exists until lane B's resolver lands; it is labeled a saved example and is refused in `RIVET_MODE=live` |
| `RIVET_OFFERS_PROVIDER` | `stub` | Where-to-buy offers provider: `stub` (canned fixtures, never a live lookup), `recorded` (engine replays saved pages) or `live` (engine fetches the web). `recorded`/`live` need `rivet_engine.ecommerce`; any other value fails at startup. See [Offers](#offers) |
| `RIVET_ENABLE_ESTELLE` | `false` | Turn on the Estelle grounding client |
| `RIVET_ESTELLE_MODE` | `cli` | `cli` works; `mcp` always reports unavailable (tool parameters are undocumented) |
| `RIVET_ESTELLE_REPO` | this repo | Repository Estelle should ground against |
| `RIVET_LIVE_VISION_TEST` | unset | Tests only: `1` enables the paid, opt-in `tests/test_live_vision_provider.py` (see [Prove the model sees the image](#prove-the-model-sees-the-image)) |
| `RIVET_LIVE_OFFERS_TEST` | unset | Tests only: `1` enables the opt-in `tests/test_live_offers_provider.py`, which fetches real vendor pages through the live offers provider (see [Offers](#offers)) |

A missing model, key or `openai` package for the selected provider fails at startup with a message that names it. (`RIVET_CATALOG_PATH` in the root `.env.example` is not read by this API.) The `openai` SDK also honors its own variables such as `OPENAI_BASE_URL`, `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID` if they are set; this API never sets or reads them.

### Vision providers

The provider turns the request (image and/or text) into a proposed `IntentSpec`; code then sanitizes it and decides support (only `rover` is supported for engineered builds). Every provider also builds and edits **concept models** of any object (see [Concept models](#concept-models-any-photo)); `mock` answers those with a saved quadcopter concept that does not depend on the image. **`openai` is the live provider for the demo** (decision in [`docs/context.md`](../../docs/context.md) §5, 2026-10-24).

| `RIVET_VISION_PROVIDER` | Status | Needs | What the model receives |
|---|---|---|---|
| `mock` (default) | Offline stand-in, not a model | nothing | Nothing: it ignores the image and answers every request with the saved rover intent, except that the text keywords `drone`, `quadcopter`, `robot arm` and `robotic arm` turn it into an unsupported drone or robot-arm intent. Job events say `fixture vision` |
| `openai` | **Live provider for the demo**, the only one proven end to end ([`docs/e2e-review-2026-10-24.md`](../../docs/e2e-review-2026-10-24.md)) | `RIVET_VISION_MODEL=gpt-4o`, `OPENAI_API_KEY`, `pip install -e '.[live]'` | A Chat Completions call in JSON mode with the system prompt, the user text and the uploaded image (re-encoded, metadata stripped) inline as a base64 `image_url` data URI |
| `backboard` | In code, **unsupported for the demo** | `RIVET_VISION_MODEL`, `BACKBOARD_API_KEY`; optional `BACKBOARD_LLM_PROVIDER`, `BACKBOARD_BASE_URL` | One stateless `POST /threads/messages` (memory and web search off, `json_output` on) with the image as a multipart `files` attachment |

`backboard` is unsupported for the demo for two reasons: (1) image input is unverified: Backboard's docs describe `files` as RAG attachments and `input_image` as image generation, not vision chat, so nothing shows the model sees the picture; (2) the team account has no LLM credit (runs fail with "free credit is reserved for Memory & RAG", which this API reports as 502 `PROVIDER_ERROR`). The code and its tests stay (`adapters/backboard_provider.py`, `tests/test_backboard.py`) in case both are resolved.

Provider failures end the job with a typed error and none of the provider's text: 429 `PROVIDER_QUOTA`, 502 `PROVIDER_AUTH` (bad key), 503 `PROVIDER_UNAVAILABLE`, 502 `PROVIDER_ERROR`. A reply that is not a valid intent twice in a row (one retry) is 502 `VISION_PARSE_FAILED`.

## Prove the model sees the image

`mock` never looks at the picture, so this check needs the live `openai` provider. Send two clearly different pictures, a 2WD rover and a drone, with the same request and no text. If the model reads the picture, the detected `project_family` differs: the rover is accepted and its job completes; the drone is refused with 422 `UNSUPPORTED_PROJECT_FAMILY` and `details.detected_family == "drone"`. If both come back the same, the model is not seeing the image.

1. Install the live extra and draw the two test pictures (original drawings with no text in them; any two clear photos work too):

   ```bash
   cd services/api
   .venv/bin/pip install -e '.[dev,live]'
   .venv/bin/python tests/test_live_vision_provider.py /tmp/rivet-vision-check
   # writes /tmp/rivet-vision-check/rover-2wd.png and /tmp/rivet-vision-check/drone-quadcopter.png
   ```

2. Start the API with the live provider. Fixture mode is enough, since only the vision step is under test. Export `OPENAI_API_KEY` in this shell first; keep a personal key in the gitignored root `.env.local`, never in the shared `.env` or any tracked file.

   ```bash
   RIVET_MODE=fixture RIVET_VISION_PROVIDER=openai RIVET_VISION_MODEL=gpt-4o \
     .venv/bin/python -m uvicorn rivet_api.main:app --port 8000
   ```

3. In a second shell, upload each picture, generate from the image alone and read the job (the events stream ends when the job does):

   ```bash
   check() {
     asset=$(curl -s -F "file=@$1" localhost:8000/api/assets/images | python3 -c 'import json,sys; print(json.load(sys.stdin)["asset_id"])')
     job=$(curl -s -X POST localhost:8000/api/projects/generate -H 'content-type: application/json' \
       -d "{\"input\": {\"kind\": \"image\", \"image_asset_id\": \"$asset\"}}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["job_id"])')
     curl -sN "localhost:8000/api/jobs/$job/events" | grep '^data:'
     curl -s "localhost:8000/api/jobs/$job"; echo
   }
   check /tmp/rivet-vision-check/rover-2wd.png
   check /tmp/rivet-vision-check/drone-quadcopter.png
   ```

Expected, in the key lines (ids vary, and so may the confidence):

```text
rover-2wd.png:        data: {..., "stage": "understand", "actor": "vision", "status": "ok", "message": "Interpreted as a rover (high confidence, live vision)", ...}
                      {"job_id":"job-...","status":"complete","stage":"complete","progress":1.0,"build_id":"rivet-...","revision":1}
drone-quadcopter.png: data: {..., "stage": "failed", "actor": "system", "status": "failed", "message": "Projects of family 'drone' are not supported in this version", ...}
                      {"job_id":"job-...","status":"failed","stage":"failed","progress":0.25,"error":{"code":"UNSUPPORTED_PROJECT_FAMILY","message":"Projects of family 'drone' are not supported in this version","details":{"supported_families":["rover"],"detected_family":"drone"},"retryable":false}}
```

`live vision` shows the `openai` provider answered. With `mock`, both pictures give `Interpreted as a rover (medium confidence, fixture vision)` and both builds complete: that is why `mock` proves nothing here.

The automated version of this check is opt-in, skipped by default and in CI, and makes at least two paid calls. It sends the same two pictures through upload, generate and the job with the real `LiveVisionProvider` + `OpenAIBackend` (model from `RIVET_VISION_MODEL`, default `gpt-4o`) and asserts rover → `rover` (job complete) and drone → `drone` (refused as above):

```bash
cd services/api
RIVET_LIVE_VISION_TEST=1 .venv/bin/python -m pytest -q tests/test_live_vision_provider.py -rs   # with OPENAI_API_KEY exported
```

Without the flag, the key or the `openai` package, the two live tests are reported as skipped with the reason, for example `needs RIVET_LIVE_VISION_TEST=1, OPENAI_API_KEY`.

## Concept models (any photo)

Any uploaded photo or description can be rendered as an interactive 3D model. `POST /api/projects/generate` with `"interpretation_choice": "concept_model"` (the web intake's default; no `intent_id` needed) skips the engine:

1. **Exterior:** the vision provider breaks the object into parts, each a primitive shape (`box`, `rounded_box`, `cylinder`, `tube`, `sphere`, `hemisphere`, `cone`, `capsule`, `torus`, `propeller`, `wheel`) with size, pose, color and material. Long thin parts may be placed by `from_mm`/`to_mm`; the server computes their rotation.
2. **Inside:** for powered devices the same reply adds typical internal parts (`internal: true`, e.g. flight controller, ESCs, power distribution board, receiver) and `wires` between named parts. The server draws each wire through the two part centres, drops wires to unknown parts, and stacks overlapping internal parts.
3. **Checks in code** (`rivet_api/concept/`): strict parse with one repair round (also for floating parts), clamped sizes and positions, model grounded and centred, and `check_concept_plan` (structure against the plan's own `concept_catalog`, no SKU, price or link anywhere, status `needs_review`).

The stored plan is labelled: `provenance.catalog_version` `CONCEPT-1.0`, blocking `UNKNOWN` `concept.not_engineered`, advisory `concept.geometry_estimated` and `concept.internals_inferred`, `behavior: null`, `simulation.kind: "none"`. Plain-language edits (`{"base_revision", "instruction"}`) create new revisions (`422 CONCEPT_EDIT_NEEDS_TEXT` without text; `accepted: false` with `concept.edit_no_change` when nothing changes). BOM CSV and firmware exports are refused. If the concept cannot be built, the job builds the closest supported rover and records `A 3D concept of the upload could not be built, so this is the fallback rover (<CODE>)` in `provenance.notes`. Full contract: [`contracts/api.md`](../../contracts/api.md) "Concept models".

## Geometry-first generation (v2)

`rivet_api/design/` runs the staged pipeline (distill, concept and extra views, three candidate DesignSpecs, compile with streamed partial GLBs, mechanical and engineering checks, repair, six-camera renders, visual review, selection, one critic-guided revision, exports, persistence). Geometry, checks and exports come from `rivet_engine.design_compiler` (install the engine's `geometry` extra); electrical and firmware verdicts come from the engine via `rivet_engine.engineering_bridge`. Results are `DesignBundle` v2 revisions stored in `RIVET_DATA_ROOT/design/` (SQLite events and jobs, content-addressed assets); v1 BuildPlans are untouched, and an engineered bundle links the v1 plan the engine produced for its electronics.

| Variable | Meaning |
|---|---|
| `RIVET_3D_MODE` | `live` uses real providers and never falls back; anything else runs the offline rule-based author, labelled `fixture` |
| `RIVET_DESIGN_MODEL` | Chat/vision model for distill, authoring, critique and patches (default: `RIVET_VISION_MODEL`, then `gpt-4o`); needs `OPENAI_API_KEY` |
| `RIVET_IMAGE_PROVIDER` | `openai` enables concept art and extra views; unset skips those stages with an explicit event |
| `RIVET_IMAGE_MODEL`, `RIVET_IMAGE_SIZE`, `RIVET_IMAGE_QUALITY` | Image model and settings (defaults `gpt-image-1`, `1024x1024`, `medium`). Keys without `gpt-image-1` access can use `gpt-image-1-mini`; an unavailable model fails the job with the model named in the error, never a fallback |
| `RIVET_CRITIC_MODEL` | Multimodal model for the visual critic (default: the design model). Lets a reasoning author pair with a faster vision judge |
| `RIVET_PROVIDER_TIMEOUT_S` | Per-call timeout for the live design/image providers (default `300`; reasoning models need minutes per DesignSpec) |
| `RIVET_VISUAL_TARGET` | Visual-quality target 0-10 (default `8`). A concept below it, or with an unresolved critical visual finding, is `needs_review` with `visual_quality.achieved=false` and an explicit statement; it is never reported as a verified success |
| `RIVET_RENDERER` | `raster` (deterministic CPU renders of the real GLB; default in fixture mode) or `chromium` (three.js through `apps/web/scripts/render-design.mjs`; default in live mode, which fails instead of falling back when Chromium is missing) |

| Route | Purpose |
|---|---|
| `GET /api/v2/session` | Starts or confirms the caller's session (httponly cookie); every v2 route is scoped to it |
| `POST /api/v2/assets/images` | Reference image upload (cleaned, content-addressed, hash recorded) |
| `GET /api/v2/assets/{asset_id}` | Owner-only asset bytes (GLB, PNG, STEP, STL, JSON) |
| `POST /api/v2/generations` | Starts a generation (`input`, `mode`, `quality`, `candidate_count`, `review_rounds`, `allow_cached`, budget); `allow_cached` replays a stored result with `provenance.cached: true` |
| `GET /api/v2/generations/{job_id}` | Job status |
| `GET /api/v2/generations/{job_id}/events` | SSE with resumable ids (`Last-Event-ID` or `last_event_id`) |
| `POST /api/v2/generations/{job_id}/cancel` | Stops a running job at the next stage boundary; artifacts so far are kept |
| `GET /api/v2/projects` | Saved designs of this session |
| `GET /api/v2/projects/{build_id}/design` | DesignBundle (`?revision=N`) |
| `GET /api/v2/projects/{build_id}/candidates` | Candidate summaries with renders, claims and reviews |
| `GET /api/v2/projects/{build_id}/revisions` | Revision lineage |
| `POST /api/v2/projects/{build_id}/select` | Choose a candidate (bound to its generation job) as a new revision |
| `POST /api/v2/projects/{build_id}/revise` | Plain-language targeted edit as a job; rejected edits leave the design unchanged |
| `POST /api/v2/projects/{build_id}/restore` | Undo/redo: copy an earlier revision forward without recomputing |
| `GET /api/v2/projects/{build_id}/export` | `kind=glb|part_glb|step|stl|assembly_step|bom|assembly_steps|manifest|trace|firmware` (`422` with the reason when an export does not apply) |

## Endpoints

Errors always use `{"error": {"code", "message", "details", "retryable"}}`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ok, mode}`; every response also carries `X-Rivet-Mode` |
| GET | `/api/catalog` | `?category=` filters by `identity.category` |
| POST | `/api/assets/images` | multipart `file`; PNG/JPEG/WebP only, 10 MB, EXIF stripped, large images downscaled, per-session quota (`X-Rivet-Session`) |
| GET | `/api/assets/{asset_id}/preview` | The stored (re-encoded) image |
| POST | `/api/projects/generate` | 202 `{job_id, status: "queued", build_id: null}`; body `{input: {kind, image_asset_id?, user_text?}, requirements?, intent_id?, interpretation_choice?}`; `interpretation_choice: "concept_model"` renders any object as a concept model |
| POST | `/api/intents/interpret` | Same body as generate; runs vision + sanitizer only (never the engine) and returns 200 `{intent_id, intent, supported, limitation, vision_mode}`, also for unsupported results (`limitation` = the 422 the support gate would raise). The intent is kept in memory for 1 h: generate with `intent_id` builds exactly it without calling vision again (404 `INTENT_NOT_FOUND`, 409 `INTENT_INPUT_MISMATCH`), and `interpretation_choice: "closest_supported_rover"` is the only way to build from an unsupported one (recorded in `provenance.notes` and a job event) |
| GET | `/api/jobs/{job_id}` | `{status, stage, progress, build_id?, revision?, error?}`; `progress` is null unless real stages were planned |
| GET | `/api/jobs/{job_id}/events` | Server-sent events with `id:` lines; reconnect with `Last-Event-ID` or `?last_event_id=` |
| POST | `/api/resolve` | 202 `{job_id, status: "queued", resolution_id: null}`; body `{input: {kind, image_asset_id?, user_text?}}`. Poll `GET /api/jobs/{job_id}` until it carries `resolution_id`. 503 `RESOLVER_UNAVAILABLE` in live mode without a live resolver |
| GET | `/api/resolutions/{resolution_id}` | The stored resolution: `outcome` (`exact_match`, `partial_match`, `no_match_with_alternatives`, `unsupported`), per-part status (`verified`, `inferred`, `not_found`, `stale`, `conflict`, `unavailable`), typical-for-category parts kept in their own list, and the evidence ledger |
| GET | `/api/resolutions/{resolution_id}/evidence` | Only the ledger: every record the resolver returned, with what the gates concluded about it |
| GET | `/api/parts/{catalog_id}/offers` | `OfferSet` for the part's catalog SKU; `?sort=&vendor_tier=&in_stock=&min_rating=&max_price=&currency=`. 404 `PART_NOT_FOUND`; 422 `EXPORT_REFUSED_SYNTHETIC` for `demo.*` parts (no provider call); 202 `{job_id, status, offer_set_id: null}` only when the `live` provider has no cached answer |
| POST | `/api/offers/search` | `{sku?, mpn?, gtin?, manufacturer?}` (at least one of `sku`/`mpn`/`gtin`) plus the same sort/filter fields. 200 `OfferSet` from `stub`, `recorded` or the cache; 202 job for a live miss (poll `GET /api/jobs/{job_id}` until it carries `offer_set_id`). 400 `INVALID_IDENTIFIER` for an empty identifier or a GTIN with a bad check digit |
| GET | `/api/offers/{offer_set_id}` | The stored, unfiltered `OfferSet` (default `reliability` order). 404 `OFFER_SET_NOT_FOUND` |
| GET | `/api/showcase/products` | `ShowcaseIndex` for the gallery; `?category=` filters (`rover`, `robot`, `drone`, `wearable`, `iot`, `audio`, `display`, `tool`, `other`) |
| GET | `/api/showcase/products/{product_id}` | The full `ShowcaseProduct`. 404 `SHOWCASE_NOT_FOUND` |
| GET | `/api/showcase/products/{product_id}/parts/{part_id}/offers` | `OfferSet` for the part's `sku`/`mpn`/`manufacturer` with the offers sort/filter params: the pre-collected set when one exists (`provider_mode: "recorded"`), else the configured provider (stub set, or 202 job when `live`). With the `live` provider the pre-collected set is returned at once with a "more vendors may be available" notice; `?refresh=true` starts the live job instead. 404 `SHOWCASE_NOT_FOUND` / `PART_NOT_FOUND`; never 422, showcase parts are real |
| GET | `/api/projects/examples` | The saved build, labeled `fixture` |
| GET | `/api/projects/{build_id}` | `?revision=` optional |
| GET | `/api/projects/{build_id}/revisions` | Revision summaries |
| POST | `/api/projects/{build_id}/edits` | `{base_revision, operation, instruction?}`; 409 on a stale `base_revision`; 422 `UNSUPPORTED_EDIT` for anything but the five allowed operations; concept models take a plain-language `instruction` instead |
| GET | `/api/projects/{build_id}/exports/bom.csv` | Null prices stay empty cells; the subtotal is the engine's, never computed here. Trailing `sku`, `vendor`, `offer_url` columns come from the catalog entry (empty when unknown; `offer_url` only when the purchase link is verified). 422 `EXPORT_REFUSED_SYNTHETIC` for a plan built from synthetic demo parts, `EXPORT_REFUSED_CONCEPT` for a concept model |
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

**Run for real against OpenAI `gpt-4o` (2026-10-24, by hand):** concept models from a drone photo (quadcopter with arms, motors, rotors, guards, inferred flight controller, ESC, power distribution board, receiver and wiring), a text-only office chair, and a plain-language edit ("make all four propellers blue and add a small camera") creating revision 2; 8 of 8 interpretations of the drone photo parsed after the out-of-range image-trait fix.

**Has not been run for real (needs a human with the right setup):**

- **OpenAI vision, two-picture check:** the check in [Prove the model sees the image](#prove-the-model-sees-the-image) and `tests/test_live_vision_provider.py` have not been run against the real API (no key was available when they were written); someone with a key has to run them once. The provider itself ran once by hand on 2026-10-24 and read a drawn top-down 2WD rover as a rover with high confidence (`gpt-4o`, [`docs/e2e-review-2026-10-24.md`](../../docs/e2e-review-2026-10-24.md)).
- **Backboard vision:** never completed a run (no LLM credit), so whether its model sees the image is unknown; unsupported for the demo (see [Vision providers](#vision-providers)).
- **Firmware:** the default ESP32 rover compiled with the pinned platform and corrected library name after the template enum fix (RAM 7.0%, flash 23.9%). See `docs/final-verification.md`. No hardware flash or physical fit test was performed; individual exports stay `not_checked` unless their compile runs.

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

## Offers

The where-to-buy layer of `docs/e-commerce-layer/plan.md`: given a SKU/MPN, list verified vendor offers, sort and filter them, and hand the user a link. Rivet does not sell parts, carry a cart or use affiliate links. Bodies are `OfferSet` from `contracts/offer.schema.json` (pydantic mirror in `rivet_api/offers/models.py`, strict: a price needs a currency, an exact match needs an evidence quote, a verified offer is never fuzzy, URLs are https only, `"0"` is not a price). Reference fixtures live in `fixtures/offers/`; the packaged copies in `rivet_api/data/fixtures/offers/` are drift-tested against them.

Providers (`RIVET_OFFERS_PROVIDER`, built by `rivet_api/offers/factory.py`):

| Provider | What answers | Label |
|---|---|---|
| `stub` (default) | The packaged fixtures, matched on the normalised `sku\|mpn\|gtin\|manufacturer` key (or on SKU alone when unambiguous); anything else is `outcome: not_found` with a ledger entry saying no search was made | Every set says `provider_mode: "stub"` and carries a "not a live lookup" notice |
| `recorded` | `rivet_engine.ecommerce.find_offers(..., mode="recorded")` replaying saved pages | `provider_mode: "recorded"` |
| `live` | `rivet_engine.ecommerce.find_offers(..., mode="live")`; a cache miss runs as a job (202) because it fetches the web | `provider_mode: "live"`; a live set with synthetic `*.example` vendors is refused with 502 `SYNTHETIC_OFFERS_IN_LIVE_SET` |

The API re-validates whatever a provider returns; a malformed set (non-https or `javascript:` link, price without currency, fuzzy match in `offers`) is 502 `PROVIDER_ERROR`, never a response. Engine failures map by exception class: `ProviderQuota` 429 `PROVIDER_QUOTA` (retryable), `ProviderAuth` 502 `PROVIDER_AUTH`, `ProviderUnavailable` 503 `PROVIDER_UNAVAILABLE` (retryable), `InvalidIdentifier` 400 `INVALID_IDENTIFIER`. Sets are kept in memory (bounded, per process) under an `offer_set_id`, with a 15 minute cache on the normalised query key, so whitespace and case variants of one SKU share an answer.

Sorting and filtering (`rivet_api/offers/ranking.py`) are server-side and deterministic, and apply to `offers` only (`possible_matches` and `alternatives` are returned as stored):

- `sort`: `reliability` (default), `price_asc`, `price_desc`, `rating`, `availability`, `newest`. Unknown prices and ratings sort last in both price directions and in `rating`; every order ends with `offer_id`.
- Prices are compared only inside one currency: `?currency=` if given, else the majority currency among priced offers. Other currencies follow in `offer_id` order; there is no conversion. A `per_pack` price is compared per unit (`price_amount / pack.quantity`).
- Filters: `vendor_tier` (repeatable), `in_stock=true`, `min_rating` (0..5, on a five-point scale; offers with `rating: null` are excluded), `max_price` (within the comparison currency; unknown prices are excluded because they cannot be shown to satisfy it), `currency`. An empty result after filtering is `200` with `offers: []` and the original `outcome`.
- `status: stale` and `status: demoted` offers stay in the list with their label; nothing is removed silently.

Codes: `PART_NOT_FOUND` 404, `OFFER_SET_NOT_FOUND` 404, `INVALID_IDENTIFIER` 400, `EXPORT_REFUSED_SYNTHETIC` 422 (reused for `demo.*` parts), `PROVIDER_QUOTA` 429, `PROVIDER_AUTH` 502, `PROVIDER_ERROR` 502, `SYNTHETIC_OFFERS_IN_LIVE_SET` 502, `PROVIDER_UNAVAILABLE` 503.

Tests: `tests/test_offers_*.py` run offline against the stub and fake providers. The opt-in live smoke is skipped unless the flag is set and `rivet_engine.ecommerce` is importable:

```bash
RIVET_LIVE_OFFERS_TEST=1 .venv/bin/python -m pytest -q tests/test_live_offers_provider.py -rs
```

## Showcase catalogue

`docs/e-commerce-layer/plan-showcase.md` 3.4: real, buildable products whose maker publishes a parts list, collected ahead of time by the engine and served read-only. Bodies are `ShowcaseProduct` / `ShowcaseIndex` from `contracts/showcase-product.schema.json` (pydantic mirror in `rivet_api/showcase/models.py`; `synthetic` is pinned to `false`, a synthetic showcase product does not validate). The runtime data is the packaged mirror `rivet_api/data/fixtures/showcase/{index.json,products/*.json,offers/*.json}` of `fixtures/showcase/`, loaded and validated at startup by `rivet_api/showcase/store.py`; `tests/test_showcase_api.py` drift-tests every shared file that exists and skips when `fixtures/showcase/` has none yet.

Until the engine's ingestion run lands, the mirror holds one hand-made sample, `sample-sparkfun-inventors-kit`: five linked parts of the SparkFun Inventor's Kit read from the recorded pages in `packages/engineering/tests/support/recorded/` (source page `sparkfun.com/products/21301`; SKUs, prices, quotes, `fetched_at` and hashes are the recorded ones), plus one pre-collected `OfferSet` for the gearmotor pair (`offers/sample-rob-13302.json`, generated by `rivet_engine.ecommerce.find_offers` in recorded mode from the same page). Its summary says it is a sample; it is not a catalogue entry and the integrator replaces it with the ingested files.

Part offers (`GET /api/showcase/products/{id}/parts/{part_id}/offers`, `rivet_api/showcase/service.py`): the query is `sku`, `mpn` and `manufacturer` of the part. A pre-collected set whose `normalized_key` matches is served as `provider_mode: "recorded"` (never `live`) with a notice that it was fetched ahead of time; otherwise the normal offers service answers (stub set, or a 202 job with the `live` provider). With the `live` provider a pre-collected set is still returned immediately, with a "more vendors may be available; search again with refresh=true" notice, and `?refresh=true` starts the live discovery job (the 15 minute cache still applies). Sorting and filtering are `rivet_api/offers/ranking.py`, as everywhere else. Codes: `SHOWCASE_NOT_FOUND` 404, `PART_NOT_FOUND` 404; there is no 422 here because every showcase part has a real SKU quoted by a fetched page.

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
