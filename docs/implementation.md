# RIVET — Implementation Plan for Three Parallel Developers

> **Implementation contract · SOON Hackathon · v1.0 · October 24, 2026**  
> Companion: [`project.md`](project.md)  
> **This document is written to hand directly to three coding agents.** Read sections 0–5 before writing code, then execute only the assigned developer lane. The designer is a fourth, independent contributor.

## 0. Mission, invariants, and execution rules

**Goal:** Build Rivet, an AI-assisted platform that interprets an uploaded image or text request, creates a **single structured hardware design** using known purchasable parts, verifies supported constraints, renders a high-quality interactive 3D assembly, and exports BOM, assembly instructions, wiring information, and supported ESP32 starter firmware. The hackathon's fully supported family is a **differential-drive indoor rover**. RC vehicle variations are optional; drones, arms, and general electronics remain vision/coming-soon unless independently proven.

**Read in this order:** (1) project requirements here, (2) shared types and JSON examples in sections 3–4, (3) your lane in section 6, (4) integration and tests in sections 7–11. Do not invent missing interfaces. Do not block on work owned by another developer; use the supplied contracts and fixtures.

### Non-negotiable implementation rules

1. **One canonical `BuildPlan` per revision.** Every visual object, BOM row, pin, assembly step, behavior and firmware output must point to a specific `build_id` and `revision`.
2. **Agents propose, code validates.** Model output must be parsed into `IntentSpec`, then converted to legal configurations only by deterministic catalog-backed code.
3. **Source data is evidence, not decoration.** Missing datasheet specs, SKU links, prices or dimensions must remain `null/unknown`; never guess and label it verified.
4. **No engineer edits another engineer's owned implementation folder.** Integrations happen through pre-agreed typed interfaces. Contract changes require the explicit three-person handshake in section 5.
5. **No engineer waits for the designer.** Build minimal neutral controls, stable component APIs and functional 3D interactions. The separate designer replaces/polishes UI components and design tokens later.
6. **The 3D implementation is not throwaway.** Developer C builds a production-quality viewer/interaction pipeline even if surrounding pages are intentionally plain.
7. **All lanes are independently demoable from checked-in fixtures.** API, hardware compiler, and viewer/simulator work separately from minute one.
8. **No fake sponsor integration.** Actual Estelle calls, code references and compile/test results are captured; absence is shown honestly.
9. **No pretending robotics simulation guarantees hardware behavior.** Simulation approximations are documented and labeled.
10. **No copied third-party source unless licensing/permission is confirmed.** Reimplement described algorithms and architecture in original code.
11. **Ship the rover flow first.** (Rover acceptance is met; see [0.1](#01-scope-update-any-photo-to-a-3d-concept-model) for the appearance-only concept path that now renders any photo.) Do not make an engineered drone workflow, arbitrary CAD importer, payment processor, 6-DOF simulator, native mobile app, or collaborative editor before the acceptance gates pass.
12. **Every feature must have a deterministic fixture path.** External API unavailability must never prevent teammates from developing or the saved-build demo from opening.

### Success in one sentence

A user uploads a rover reference, Rivet makes an honest component-backed model, lets the user inspect a real purchasable part and modify the design, verifies supported constraints, animates assembly and a bounded rover simulation, and provides a consistent build/export package.

### 0.1 Scope update: any photo to a 3D concept model

After the rover gates passed, scope was extended so **any uploaded photo (or description) renders as an interactive 3D model**. This adds a second, appearance-only build path next to the engineered rover; it does not relax any rule for engineered builds. Contract detail: [`contracts/api.md`](../contracts/api.md) "Concept models"; status and decision: [`context.md`](context.md) sections 4 and 5.

| | 3D concept model | Engineered rover |
|---|---|---|
| Request | `interpretation_choice: "concept_model"` (the web intake default, no `intent_id` needed) | `as_interpreted` / `closest_supported_rover` |
| Producer | `services/api/rivet_api/concept/` (vision model proposes, code cleans and validates); no engine run | `rivet_engine.solve` |
| Parts | `concept.*` entries carried in the plan's `concept_catalog`: primitive shapes (`box`, `rounded_box`, `cylinder`, `tube`, `sphere`, `hemisphere`, `cone`, `capsule`, `torus`, `propeller`, `wheel`, `cable`), no SKU, price or link | Real catalog components |
| Inside | Inferred internal parts (`render_overrides.internal: true`) and wires (`role: "wire"`, `concept:cable`, `path_mm`, `connects`) for powered devices; overlapping internals are stacked | Engine wiring and pin map |
| Status | Always `needs_review`, blocking `UNKNOWN` `concept.not_engineered`, `behavior: null`, `simulation.kind: "none"` | From the engine's verification |
| Edits | Plain-language `instruction`, applied by the vision model, new revision | Typed operations |
| Exports | `build.json` only; BOM CSV `422 EXPORT_REFUSED_CONCEPT`, firmware refused | All |
| Studio | Concept label, X-ray toggle, no Wiring or Simulate mode | Full studio |
| Failure | Falls back to the closest supported rover with a labelled note | Error as before |

Code still validates everything a model proposes: strict parsing with one repair round, clamped sizes and positions, parts placed by two endpoints instead of model-written rotations, a connectivity check for floating parts, wires only between existing named parts, and a contract check that no concept part claims sourcing.

---

## 1. Technology choices and environment

These are **fixed initial defaults** to minimize integration risk; change only after agreeing a concrete reason.

| Layer | Choice | Rationale |
|---|---|---|
| Monorepo | `pnpm` workspace + Python `uv` project (or plain `venv` fallback) | Clear JS/Python isolation |
| Frontend | Next.js App Router, TypeScript, React, Tailwind (neutral starter), Zustand optional | Fast demo and designer handoff |
| 3D | Three.js + React Three Fiber + drei | Renderer, selection, camera, animation, exploded view |
| Backend | FastAPI, Pydantic v2, Python 3.11+ | Typed contracts, JSON endpoints, straightforward integration |
| AI vision/text | Provider adapter with configurable multimodal model | Real API where available; deterministic fixture/mock otherwise |
| Constraint engine | Pure Python with typed models; OR-Tools only if needed | Deterministic, testable, no AI in validation |
| Catalog | Versioned JSON fixtures, optional SQLite/Postgres after MVP | No database/network dependency to load project |
| Robot simulation | Browser-side TypeScript 2D kinematic model using `BehaviorSpec` | Deterministic and simple; visibly honest |
| Firmware | C++ Arduino/ESP32, generated PlatformIO project from verified templates | Conventional reproducible build artifact |
| Source grounding | Estelle MCP/CLI with real runtime setup | Demonstrate repo-specific evidence and genuine code action |
| Testing | `pytest`, Vitest, Playwright (one E2E), PlatformIO compile | Unit/contract/UI/firmware checks |

### Environment variables

Use `.env.example`, never commit secrets:

```dotenv
RIVET_ENV=development
RIVET_MODE=fixture                # fixture | live
RIVET_VISION_PROVIDER=mock        # mock | openai | other configured adapter
RIVET_VISION_MODEL=              # must be set for live vision provider
OPENAI_API_KEY=                  # server only, optional
RIVET_DATA_ROOT=./data
RIVET_CATALOG_PATH=./data/catalog/components.json
RIVET_DEMO_FIXTURE=rover_obstacle_v1
RIVET_ENABLE_ESTELLE=false       # real connection only when installed/authenticated
RIVET_ESTELLE_MODE=cli           # cli | mcp ; gate by real connectivity
NEXT_PUBLIC_RIVET_API_URL=http://localhost:8000
NEXT_PUBLIC_RIVET_USE_FIXTURES=true
```

- Frontend may expose **only** `NEXT_PUBLIC_*` variables without secrets.
- Pin major dependency versions at project initialization; commit lock files. Do not spend hours upgrading packages mid-hackathon.
- A clean install must work on macOS or Linux. Never hardcode developer-local absolute file paths.

---

## 2. Repository organization: exclusive file ownership

```text
rivet/
├── README.md                         # brief setup and demo commands; integrator edits
├── project.md                        # product specification; reviewed changes only
├── implementation.md                 # this plan; reviewed changes only
├── .env.example                      # agreed env contract; initial bootstrap
├── package.json                      # root scripts / pnpm workspace; bootstrap
├── pnpm-workspace.yaml               # bootstrap
├── pnpm-lock.yaml                    # generated at bootstrap; integrator only
├── .github/workflows/ci.yml          # bootstrap, then agreed shared changes
│
├── contracts/                        # FROZEN v1: changes require all 3 developers
│   ├── intent.schema.json
│   ├── component.schema.json
│   ├── build-plan.schema.json
│   ├── errors.schema.json
│   └── api.md
│
├── fixtures/                         # versioned shared test/demo fixtures; append-only by agreement
│   ├── intent/rover_obstacle_v1.json
│   ├── plans/rover_obstacle_v1.json
│   ├── plans/rover_failing_driver_v1.json
│   ├── catalog/seed-components.json
│   ├── sim/obstacle-scenario.json
│   └── images/rover-reference.*      # use own/licensed image, not third-party copied asset
│
├── services/api/                     # DEV A OWNS ALL CONTENTS
│   ├── pyproject.toml
│   ├── rivet_api/__init__.py
│   ├── rivet_api/main.py
│   ├── rivet_api/routes/{projects,health,assets}.py
│   ├── rivet_api/models/{intent,requests,responses}.py
│   ├── rivet_api/agents/{vision,planner,editor,grounder}.py
│   ├── rivet_api/orchestration/{pipeline,versions,events}.py
│   ├── rivet_api/adapters/{engineering,fixture,vision_provider}.py
│   ├── rivet_api/firmware/{templates,generate,compile,estelle}.py
│   ├── rivet_api/firmware/templates/esp32_rover/...
│   └── tests/{test_api,test_pipeline,test_vision,test_firmware}.py
│
├── packages/engineering/             # DEV B OWNS ALL CONTENTS
│   ├── pyproject.toml
│   ├── rivet_engine/__init__.py
│   ├── rivet_engine/models.py
│   ├── rivet_engine/catalog.py
│   ├── rivet_engine/configurator.py
│   ├── rivet_engine/mounts.py
│   ├── rivet_engine/wiring.py
│   ├── rivet_engine/validators/{mechanical,electrical,budget,completeness}.py
│   ├── rivet_engine/repair.py
│   ├── rivet_engine/assembly.py
│   ├── rivet_engine/bom.py
│   ├── rivet_engine/serialize.py
│   ├── rivet_engine/data/components.json
│   ├── rivet_engine/data/templates/rover_2wd.json
│   └── tests/{test_catalog,test_constraints,test_repair,test_bom,test_mounts}.py
│
├── apps/web/                          # DEV C OWNS ALL CONTENTS UNTIL DESIGN HANDOFF
│   ├── package.json
│   ├── src/app/{page,studio/page}.tsx
│   ├── src/components/studio/{Studio,Toolbar,Inspector,PartsPanel,StepTimeline}.tsx
│   ├── src/components/three/{RoverScene,PartMesh,Selection,Explode,WireOverlay,CameraRig}.tsx
│   ├── src/components/sim/{SimView,sim-core,behaviors}.ts[x]
│   ├── src/lib/{api,contracts,fixtures,geometry,plan-store}.ts
│   ├── src/components/ui/             # DESIGNER MAY REPLACE after lock-point
│   ├── src/styles/                    # DESIGNER OWNED after lock-point
│   ├── public/models/                 # approved assets / generated low-poly meshes
│   └── tests/{viewer,sim,contract}.test.ts[x]
│
└── design/                            # DESIGNER OWNS ALL CONTENTS
    ├── tokens.md
    ├── component-spec.md
    ├── assets/...
    └── handoff.md
```

### Ownership enforcement

- **A only:** `services/api/**`.  
- **B only:** `packages/engineering/**`.  
- **C only:** `apps/web/**` engineering modules; prior to the design freeze, C owns temporary UI.  
- **Designer only:** `design/**`; after handoff owns `apps/web/src/components/ui/**` and `apps/web/src/styles/**` *with C's agreement*.  
- **Shared:** `contracts/**`, `fixtures/**`, repository configs; change via a short synchronized contract proposal and one integrator's PR, never three competing edits.
- **No dependency in reverse:** Engineering core never imports API or frontend. API imports engine through a narrow adapter. Web uses HTTP + fixture JSON only. Designer should not modify engineering models or API logic.
- **CI independently tests each lane** to make feature branch merges non-blocking.

### Repo bootstrap: time-box to 20–30 minutes, then parallelize

Before the coding clock, distribute both Markdown specs and the sample fixture JSON below to all three developers. During the first 20–30 minutes, **one designated integrator** commits empty folder skeleton, shared schemas, contracts, root scripts, two valid fixtures and seed catalog, then merges to main. Other developers **do not idle**: they start their own named branches and copy the exact v1 fixture from this spec locally. If the bootstrap branch is late, their lane can still run standalone; cherry-pick the bootstrap later. The spec already freezes field names so nobody needs to ask about contracts.

Branch names: `feat/a-agents-api`, `feat/b-engineering`, `feat/c-3d-sim`, `design/visual-system`. Keep PRs file-scope-disjoint and merge often in small units.

---

## 3. Canonical contracts: do not improvise

**Versioning:** all domain JSON includes `schema_version: "1.0"`. Fields are `snake_case` across Python, JSON, and TypeScript; do not introduce hidden camelCase aliases. Python owns serialization; TypeScript consumes the exact wire format. JSON schema files should enforce the definitions below; each lane validates fixtures before continuing.

**Units:** mechanical lengths in **millimeters**; transforms use right-handed coordinates: `x` right, `y` up, `z` forward/toward the rover front; Euler rotations in **degrees** applied XYZ consistently; masses in grams; voltage V, current A, power W; financial amounts decimal strings in a stated ISO currency; simulator distances in meters (explicit conversion `/1000`) and angles in radians.

**Core stable IDs:** `catalog_id` identifies a catalog item; `instance_id` identifies one physical instance; `mount_id` and `port_id` identify connection points on that catalog item; `build_id` identifies one logical project and `revision` one immutable snapshot. Do not use UI array indices as IDs.

### 3.1 `IntentSpec` (output of A; input to B)

Example, also saved as `fixtures/intent/rover_obstacle_v1.json`:

```json
{
  "schema_version": "1.0",
  "intent_id": "intent-rover-001",
  "input": {
    "kind": "image_and_text",
    "image_asset_id": "asset-rover-reference-001",
    "user_text": "Build a small rover that avoids obstacles",
    "image_interpretation_is_approximate": true
  },
  "project_family": "rover",
  "requested_behavior": "obstacle_avoidance",
  "visual_features": ["compact chassis", "two visible drive wheels", "front-facing range sensor"],
  "requirements": {
    "max_budget": null,
    "currency": "USD",
    "max_length_mm": null,
    "max_width_mm": null,
    "preferred_controller_catalog_id": "board.esp32_devkit_v1",
    "required_capabilities": ["differential_drive", "distance_sensing"],
    "preferred_color": "charcoal"
  },
  "assumptions": ["Hidden electronics are not inferable from the image"],
  "unknowns": ["Actual source robot dimensions", "Motor and battery specifications"],
  "confidence": "medium",
  "support_status": "supported"
}
```

Rules:
- `project_family` is `rover | rc_car | drone | robot_arm | iot | unknown`; `support_status` is `supported | limited | planned | unsupported`. MVP selects `supported` for rover only. `rc_car` can become `limited` only when the actual feature works.
- `requested_behavior` is `manual_drive | obstacle_avoidance | line_following | none | unknown`; *obstacle avoidance* is the mandatory functioning behavior. Line-following requires an actual supported reflectance sensor entry and simulation, otherwise `unsupported`.
- Visual inference is descriptive and uncertainty-aware, not exact reverse engineering.
- `max_budget = null` means no hard budget specified, not zero. Unknown catalog prices prevent a **verified** budget-pass claim.
- `input.kind` can be `image`, `text`, or `image_and_text`. `image_asset_id` may be null for text input.
- Any unrecognized/unsupported intent should return a structured limitation and optionally a supported alternative, not an invented fully supported plan.

Additive integration proposal (#67): optional `image_features` follows
`contracts/intent.schema.json`: nullable wheel count/caster, bounded sensor position/kind,
wheel/chassis size, body color and visible controller. Existing intents remain valid.
Only supported template adjustments apply; applied/ignored traits are recorded in provenance.
Exact-product resolution remains the separate roadmap in `plan-verified-parts.md`.

### 3.2 `CatalogComponent` (B owns; all consume)

Example canonical catalog record (values are **illustrative schema samples**, not verified vendor specifications):

```json
{
  "schema_version": "1.0",
  "catalog_id": "driver.tb6612_breakout_v1",
  "identity": {
    "manufacturer": "Curated manufacturer",
    "model": "TB6612 breakout (specific variant)",
    "sku": null,
    "category": "motor_driver"
  },
  "physical": {
    "dimensions_mm": {"x": 25.0, "y": 5.0, "z": 20.0},
    "mass_g": null,
    "bounds_verified": false,
    "geometry_kind": "procedural",
    "asset_path": null,
    "material_preset": "pcb"
  },
  "mounts": [
    {"mount_id": "bottom_plate", "kind": "planar_fastened", "position_mm": [0, -2.5, 0], "rotation_deg": [0, 0, 0], "allowed_mates": ["electronics_deck"]}
  ],
  "ports": [
    {"port_id": "logic_vcc", "signal": "power_in", "voltage_min_v": null, "voltage_max_v": null, "current_limit_a": null, "logic_level_v": null, "notes": "Populate from selected breakout documentation"},
    {"port_id": "motor_a", "signal": "motor_output", "voltage_min_v": null, "voltage_max_v": null, "current_limit_a": null, "logic_level_v": null, "notes": "Populate from selected breakout documentation"}
  ],
  "sourcing": {
    "manufacturer_reference_url": null,
    "datasheet_url": null,
    "purchase_url": null,
    "purchase_url_verified_at": null,
    "price_amount": null,
    "price_currency": null,
    "price_checked_at": null,
    "availability_status": "unknown"
  },
  "evidence": {
    "dimensions": "unverified",
    "electrical": "unverified",
    "price": "unknown",
    "notes": ["Sample record; not suitable for VERIFIED checks"]
  }
}
```

**IMPORTANT:** This is a *schema illustration*. Developer B must create actual catalog entries using manufacturer/vendor documentation and explicitly mark what remains unknown. Do not ship the illustrative dimension/voltage as factual measurements.

Production seed catalog target: 12–25 entries including at least 1 controller, 1 known driver breakout, 2 motors or a documented motor pair, 2 matching wheels, 1 base chassis, 1 caster, 1 supported distance sensor breakout, mounting hardware, wires, motor supply, controller power connection, optional switch, and a compatible alternative only if verified. Do not imply every catalog item is interchangeable.

### 3.3 `BuildPlan` (B generates; A stores/exposes; C renders)

The following is a **shape-only contract fixture**, not a verified hardware design. The real `rover_obstacle_v1.json` fixture will contain every required actual component and verified/failing/unknown findings.

```json
{
  "schema_version": "1.0",
  "build_id": "rivet-demo-rover-001",
  "revision": 1,
  "project_family": "rover",
  "title": "Indoor obstacle rover",
  "source_intent_id": "intent-rover-001",
  "created_at": "2026-10-24T00:00:00Z",
  "status": "needs_review",
  "components": [
    {
      "instance_id": "chassis-1",
      "catalog_id": "chassis.rover_2wd_v1",
      "role": "chassis",
      "parent_instance_id": null,
      "attached_to_mount_id": null,
      "own_mount_id": null,
      "pose": {"position_mm": [0, 0, 0], "rotation_deg": [0, 0, 0]},
      "render_overrides": {"color": "#2D3542"}
    },
    {
      "instance_id": "controller-1",
      "catalog_id": "board.esp32_devkit_v1",
      "role": "controller",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "electronics_deck",
      "own_mount_id": "bottom_plate",
      "pose": {"position_mm": [0, 24, 0], "rotation_deg": [0, 0, 0]},
      "render_overrides": {}
    }
  ],
  "connections": [],
  "verification": {
    "overall": "needs_review",
    "findings": [
      {
        "rule_id": "completeness.required_motor_driver",
        "result": "UNKNOWN",
        "severity": "blocking",
        "affected_instance_ids": ["controller-1"],
        "message": "This abbreviated documentation example is not a complete rover",
        "evidence_urls": []
      }
    ]
  },
  "assembly_steps": [
    {"step": 1, "title": "Prepare chassis", "instance_ids": ["chassis-1"], "instructions": "Prepare the base and confirm its documented mounting points", "safety_notes": []}
  ],
  "bom": {
    "currency": "USD",
    "known_subtotal_amount": null,
    "total_status": "incomplete",
    "items": [
      {
        "catalog_id": "chassis.rover_2wd_v1",
        "quantity": 1,
        "instance_ids": ["chassis-1"],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      }
    ]
  },
  "behavior": {
    "profile_id": "rover.obstacle_avoidance.v1",
    "controller_catalog_id": "board.esp32_devkit_v1",
    "parameters": {"obstacle_stop_distance_m": 0.25, "turn_duration_ms": 600, "forward_speed_fraction": 0.45}
  },
  "simulation": {
    "kind": "differential_drive_2d",
    "enabled": true,
    "wheel_radius_m": 0.032,
    "wheel_base_m": 0.12,
    "max_wheel_speed_mps": 0.25,
    "sensor_range_m": 1.2,
    "sensor_fov_deg": 20,
    "limitations": ["Kinematic approximation", "No motor torque, slip or real sensor noise"]
  },
  "firmware": {
    "target": "esp32_arduino_platformio",
    "profile_id": "rover.obstacle_avoidance.v1",
    "pin_map": {},
    "compile_status": "not_checked"
  },
  "provenance": {
    "input_mode": "image_and_text",
    "catalog_version": "catalog-v1",
    "generation_mode": "fixture",
    "notes": ["Documentation contract fixture; not a manufacturable design"]
  }
}
```

**Data validity rule:** The example above illustrates the wire shape with only a chassis and controller and is **not** an operational or complete rover. It intentionally returns `needs_review`, not `verified`. It must **not** be used as the running rover fixture. In the checked-in fixture, every referenced instance/mount/port resolves and the component, BOM and step counts agree. Tests must explicitly reject a separate malformed plan where an electrical connection references a missing `driver-1`. A complete synthetic starter fixture is embedded in Appendix A for independent frontend/API work.

### 3.4 Field enumerations, status semantics, and referential rules

| Field | Allowed values / rule |
|---|---|
| `BuildPlan.status` | `verified`, `verified_with_warnings`, `needs_review`, `unbuildable` |
| `verification.findings[].result` | `PASS`, `WARN`, `FAIL`, `UNKNOWN` |
| `verification.findings[].severity` | `blocking`, `advisory` |
| `verification.overall` | same values as `BuildPlan.status` |
| `firmware.compile_status` | `passed`, `failed`, `not_checked`, `not_supported` |
| `bom.total_status` | `complete`, `incomplete`, `not_available` |
| `bom.items[].link_status` | `verified_product`, `manufacturer_reference_only`, `not_available` |
| `simulation.kind` | `differential_drive_2d` or `none` |
| `generation_mode` | `live`, `fixture`, `fallback`, `manual_template` |
| `connection.kind` | `electrical` or `mechanical` |

Integrity constraints:

- Every `components[].instance_id` is unique and every `catalog_id` exists in the catalog (or `UNKNOWN` / blocking finding prevents a validated build).
- Every non-null `parent_instance_id` and `connections[].from/to.instance_id` must be present in the same build.
- Every non-null `own_mount_id` / `attached_to_mount_id` must refer to a real mount in its corresponding catalog component.
- Every electrical port reference must exist on the correct `CatalogComponent`.
- Every `assembly_steps[].instance_ids[]` and `bom.items[].instance_ids[]` must resolve to a component occurrence in the same revision.
- Quantity of a BOM row equals the count of referenced component instances, except explicit packaged hardware sets with a documented pack multiplier (which must be modeled, not assumed).
- Every firmware pin-map signal is backed by an actual electrical port and an allocated controller pin.
- Every revision is immutable; future revisions preserve build ID and increment revision, or create a new build ID for a new project.
- `status=verified` only if all **implemented mandatory** constraints pass and no blocking unknown/fail remains; it is *not* a real-world safety certification.
- A requested hard budget cannot be marked passed if any required item is unpriced.
- `created_at` is ISO-8601 UTC, generated at runtime for actual builds; fixtures use a fixed timestamp to make tests reproducible.

### 3.5 API contract (A owns implementation, B/C code against it)

Base URL: `http://localhost:8000`; every response uses exact JSON shape and explicit errors. A supplies fixture handlers before live AI/engine hookups.

| Method | Path | Request | Response / notes |
|---|---|---|---|
| GET | `/api/health` | — | `{ "ok": true, "mode": "fixture|live" }` |
| GET | `/api/catalog` | optional `?category=` | `{ "schema_version": "1.0", "synthetic", "synthetic_catalog_ids", "components": [CatalogComponent] }` (the two flags are API additions; see "Real-product guard") |
| GET | `/api/projects/examples` | — | list of supported saved builds, titles/status |
| POST | `/api/assets/images` | multipart `file` | `{ "asset_id", "mime_type", "size_bytes", "preview_url" }` (server-controlled URL; no arbitrary path) |
| POST | `/api/projects/generate` | `{ "input": { "kind", "image_asset_id", "user_text" }, "requirements" }` | `{ "job_id", "status": "queued|running|complete|failed", "build_id": null }` |
| GET | `/api/jobs/{job_id}` | — | `{ "job_id", "status", "stage", "progress", "error"?, "build_id"?, "revision"? }` |
| GET | `/api/jobs/{job_id}/events` | — | `text/event-stream` with typed stage events; no invented progress percentages |
| GET | `/api/projects/{build_id}` | `?revision=` optional | complete validated `BuildPlan` JSON; the response adds `provenance.sourcing` (read-only, never stored) |
| POST | `/api/projects/{build_id}/edits` | `{ "base_revision", "instruction", "operation"? }` | `{ "accepted", "build_id", "revision"?, "finding"?, "job_id"? }`; reject stale revision |
| GET | `/api/projects/{build_id}/revisions` | — | list of revision summaries |
| GET | `/api/projects/{build_id}/exports/bom.csv` | `?revision=` | actual BOM CSV; price null/unknown preserved; `422 EXPORT_REFUSED_SYNTHETIC` for a plan built from synthetic parts |
| GET | `/api/projects/{build_id}/exports/firmware.zip` | `?revision=` | ZIP with PlatformIO project and manifest tied to build revision; `422 FIRMWARE_REFUSED` for synthetic or unbuildable plans |
| GET | `/api/projects/{build_id}/exports/build.json` | `?revision=` | complete design file; served for synthetic plans too, flagged by `X-Rivet-Synthetic: true` |

**Core minimum for hour 16:** health, catalog, generate job, job status, project GET, and revision edit endpoint. Exports can be added after working design.

#### API errors

HTTP errors use:

```json
{
  "error": {
    "code": "UNSUPPORTED_PROJECT_FAMILY",
    "message": "Flight-ready drone generation is not supported in this version",
    "details": {"supported_families": ["rover"]},
    "retryable": false
  }
}
```

Use `400` for bad request, `404` for missing resource, `409` for stale revision/conflict, `422` for semantically unsupported requests, `429` for provider quota, `502/503` for upstream unavailability. Service mode fallback returns explicit `generation_mode=fallback`, never undisclosed fabricated live output.

#### Real-product guard (API)

The engine decides hardware validity; the API additionally refuses to relay sourcing the catalog cannot back. It never invents or repairs data.

- A `bom.items[]` row may have `link_status = verified_product` only if its catalog entry has `identity.sku` and a `sourcing.purchase_url` (https) with `purchase_url_verified_at`, and the row's `purchase_url` equals it. A row's `unit_price_amount` must equal the catalog price in the BOM currency (both null otherwise). A violation is `502 ENGINE_CONTRACT_VIOLATION` and nothing is stored. Kit items with no SKU or link stay valid `manufacturer_reference_only` rows.
- A plan with `generation_mode = live` that contains a synthetic part is `502 SYNTHETIC_PARTS_IN_LIVE_PLAN`. A part is synthetic if its `catalog_id` starts with `demo.` or `synthetic.`, its manufacturer contains `SYNTHETIC`, or the plan's `catalog_version` starts with `SYNTHETIC`. `fixture` and `fallback` plans are allowed and flagged.
- Read responses add `provenance.sourcing = { synthetic, synthetic_catalog_ids, unverified_link_count, sku_missing_count, link_checks? }` (supplier-check fields in `contracts/api.md`). It is computed on read and not part of the stored `BuildPlan`, because the engine rejects unknown keys. Every export carries `X-Rivet-Synthetic: true|false`.
- `replace_optional_sensor` to a synthetic part or one without a SKU and a verified https purchase link is returned as `accepted: false` with finding `api.real_product_only`, before the engine is called.
- Not checked: that a SKU or URL still resolves at the vendor. Verify links by hand before the demo (see the hour 34-36 gate).

#### Job events

Use event payload:

```json
{
  "event_id": 1,
  "job_id": "job-demo-001",
  "stage": "catalog_selection",
  "actor": "planner",
  "status": "running",
  "message": "Finding compatible controller and motor driver",
  "timestamp": "2026-10-24T00:00:00Z",
  "references": []
}
```

`stage` allowed: `upload`, `understand`, `catalog_selection`, `assembly`, `validate`, `repair`, `render_ready`, `firmware`, `complete`, `failed`; `actor`: `vision|planner|engineer|validator|repair|firmware|system`; `status`: `running|ok|warning|failed`. Stream **actual** stage progression; don't replay a pre-written success story pretending it's a real generation. `event_id` monotonically increases per job. Keep JSON event history accessible if SSE reconnects.

### 3.6 Firmware and behavior contract

A and C share behavior **parameters**, not implementation language. C simulates the same high-level finite-state policy that A emits as a firmware template; the simulation does **not** execute the compiled C++ code.

`BehaviorSpec`:

```json
{
  "profile_id": "rover.obstacle_avoidance.v1",
  "controller_catalog_id": "board.esp32_devkit_v1",
  "parameters": {
    "obstacle_stop_distance_m": 0.25,
    "turn_duration_ms": 600,
    "forward_speed_fraction": 0.45
  }
}
```

Finite-state policy:

1. `FORWARD`: command wheel speeds positive at configured fraction; monitor modeled/sensed front range.
2. When range `< obstacle_stop_distance_m`, command `STOP`, then enter `TURN` for `turn_duration_ms`.
3. Return to `FORWARD`; stop immediately on an explicit `DISABLE` event.
4. Avoid high-speed or autonomous physical demonstrations without real sensor/driver verification and a human-operated disable mechanism.

Firmware templates consume **validated, documented pin mapping** derived from B's `BuildPlan.firmware.pin_map`. No LLM-invented GPIO assignment, no direct motor current through ESP32 pins, no blind writes to source based on a camera image. Emit project file manifest and compile status.

### 3.7 Shared fixture requirements

Before code implementation, create *valid* fixtures with these properties:

- `rover_obstacle_v1`: full rover with chassis, two distinct motor instances, two distinct wheel instances, driver, controller, range sensor, caster, power entries, proper mount/port references, BOM and at least six assembly steps.
- `rover_failing_driver_v1`: identical baseline but with intentionally incompatible motor current requirement (or missing current evidence) and a failing/unknown validator finding; don't make up a nonexistent motor spec to generate this case. A synthetic **test-only** component with explicit fake metadata is acceptable if marked as synthetic and never shown as real hardware.
- `intent/rover_obstacle_v1`: stable image/text intent from above.
- `sim/obstacle-scenario`: one starting pose, a wall/box ahead, deterministic expected state transition timings.
- Valid fixture must parse and round-trip against JSON schemas and TypeScript types. Invalid sample in section 3.3 must be rejected.

Developers may each package private fixture copies inside their own folder initially; after shared fixture files land, import or mirror their contents through tests. Never wait for someone else's live server to begin work.

---

## 4. Architecture patterns Rivet implements from scratch

The patterns below are common to generative build tools; Rivet implements each one in original code, with its own mechanical/firmware model. No third-party source is reused.

| Pattern | Rivet implementation | Primary owner |
|---|---|---|
| Multi-stage idea/image → brief → physical build → check → render → critique pipeline | `services/api/rivet_api/orchestration/pipeline.py` and the v2 design orchestrator; parse `IntentSpec`, call B's engineering compiler, record actual stages and revisions | A |
| Small structured briefs; the model never emits arbitrary geometry | Structured `IntentSpec` + controlled catalog configuration proposal schema; DesignSpec v2 for geometry | A/B |
| Immutable part, subassembly, inventory and version objects | Typed catalog and `BuildPlan` with `instance_id`, port/mount IDs, precise provenance | B |
| Semantic knobs + typed/sized sockets; code computes placements | Robot chassis templates, `mount_id`s, controller deck frames, wheel/motor mounting | B |
| Deterministic validation report | Mechanical/electrical/budget/reference integrity checks; `PASS/WARN/FAIL/UNKNOWN` | B |
| Budget-bounded deterministic substitutions before model escalation | Compatible motor-driver/sensor/part selection; repair and rerun gates with bound on attempts | B |
| Immutable revisions, replay, undo/redo and edit ops | Backend project revisions and optimistic concurrency via `base_revision` | A |
| Topological step ordering and insertion checks | Build assembly steps from mount graph and wiring order; no false claim of a full robotic insertion planner | B/C |
| Real-time structured agent-event stream | SSE event schema showing actual reasoning stages and repairs | A |
| Render → visual critique → optional repair | Image-based critique after verified geometry exists; never a substitute for geometry checks | A |
| Geometric collision/groundedness checks | B's bounds/mount validation and the v2 geometry kernel checks | B |
| Part metadata and canonical library lookup | Hardware catalog, product references, dimensions, datasheet provenance | B |
| Atomic proposed edits; rejected changes do not mutate the accepted design | Versioned, typed partial edits with validation gate and rejection explanation | A/B |
| Hardware asset resolver and viewer | Three.js hardware asset resolver with local GLB/procedural part meshes; `RoverScene`, `PartMesh`, overlays, camera/explosion/selection systems | C |
| Scroll-driven assembly timeline | Part/step scrubber synchronized with `assembly_steps` | C |
| Live progress visual grammar | Rivet engineering timeline with its own styling | Designer + C |

**Out of scope:** toy-brick occupancy cells, brick geometry as generic CAD, brick colour substitution or clutch-stability claims, and any third-party branding or assets. The mechanical/firmware model in Rivet is its own.

---

## 5. Team contract: three developers, nobody blocked

### The exact concurrency design

- **A's input from B:** `solve(intent: IntentSpec, catalog: Catalog) -> BuildPlan`. While B implements it, A uses `FixtureEngineeringAdapter` returning the valid shared plan; never blocks API or vision work.
- **B's input from A:** `IntentSpec` v1 JSON. B runs direct unit tests against the fixture; no need for a working vision service.
- **C's input from B:** `BuildPlan` v1 JSON + component catalog. C imports fixture files and starts rendering on hour one; no need for server/model/hardware compiler.
- **A's output to C:** HTTP `GET /api/projects/{id}` with same BuildPlan JSON as fixture and job status. C toggles between fixture and API adapter with one env variable.
- **C's simulation input from A/B:** `BehaviorSpec` and `SimulationConfig` embedded in BuildPlan, with fixed units; no need to execute real C++ code in browser.
- **Designer input from C:** page structure, named slots and functional component props. Designer delivers a token sheet and replacement UI components/assets; no edits to underlying model or scene engine.

### Invariants that enable independent work

1. Shared v1 field names and enumerations are **locked before first coding sprint**.
2. Every consumer has fixtures and schema validation tests.
3. Each lane can run its own test suite without the other two processes.
4. Each lane ships a small self-contained demo entry point at hour 8.
5. No cross-lane imports into internals. Only typed `solve` adapter and documented HTTP contracts.
6. A cannot treat its mock adapter as a verified engineering result; it must label `generation_mode=fixture`.
7. C cannot embed a hard-coded BOM or 3D geometry disconnected from selected component instance IDs.
8. B cannot block generation forever waiting for supplier price or a model call; unsupported/missing data returns a structured finding.
9. Designer merges final visuals after C has stabilized functional API/props. UI engineering remains functional without the designer.

### Contract-change process (rare)

If a field is truly missing: propose a 5-line change explaining old/new JSON, owners affected, fixture update, and backward-compatibility. Get A/B/C approval in the team chat, assign **one** person to change `contracts/**` and fixtures, merge, then each owner updates their own implementation. Never silently rename a field while others code against it. Additive optional fields are preferable to breaking changes.

### Integration coordinator

Choose any one developer to act as integration coordinator for **merge timing only** (not ownership of another person's code). Daily checkpoints and CI are owned by all; designate a single person to manage release branch `release/soon-demo` after hour 24. Branch changes remain scoped to owned directories.

---

## 6. Three independent coding-agent work orders

### Developer A — Vision, agents, API, versioning, firmware/Estelle

**Owner:** Everything within `services/api/**`. Treat `IntentSpec` and `BuildPlan` schemas as immutable. Import B through a switchable adapter. Your deliverable is a functioning API that can work with fixtures before real model/provider/engineering integration.

#### A0. Local bootstrap (can start with only these two Markdown files)

- Create standalone FastAPI project with Pydantic v2 models matching section 3 exactly.
- Add `GET /api/health`; load fixture IntentSpec and BuildPlan from private test copies if shared path is not ready.
- Create `EngineeringPort` protocol:

```python
from typing import Protocol

class EngineeringPort(Protocol):
    def solve(self, intent: dict) -> dict: ...
    def apply_edit(self, plan: dict, operation: dict) -> dict: ...

class FixtureEngineeringAdapter:
    def solve(self, intent: dict) -> dict:
        # Deep-copy the checked fixture, label as fixture, never claim a live result.
        ...
```

- Provide `RealEngineeringAdapter` importing `rivet_engine` **only when installed/configured**, so A's tests never fail due to B's incomplete package.

#### A1. Image upload and input normalization

- Accept only PNG/JPEG/WebP; apply content-type sniffing, 10 MB file limit, max input dimensions or safe downscaling, per-session quotas, and sanitized server-generated asset IDs. Never trust extension alone.
- Store uploads in temporary server-controlled directory; do not echo local filesystem paths or transmit confidential data unintentionally.
- Multimodal parser extracts **visible traits** and **functional goals** into `IntentSpec`. Separate user-stated facts from model-inferred assumptions.
- Constrain response with strict Pydantic parsing; retry once on invalid model JSON, then return a meaningful error or explicitly labeled fixture fallback.
- Reject unsupported category requests gracefully. Distinguish “I see a drone” from “the flight engineering is verified.”
- For text-only input, use the same schema and parser path.

#### A2. Orchestration pipeline

Phases: `upload → understand → catalog_selection → assembly → validate → repair (if needed) → render_ready → firmware → complete`.

The API does not place meshes itself. `solve` delegates to B. Every phase emits an **honest** event; timestamps and sources are tied to actual operations. Proposed pseudo-code:

```python
def generate_project(request, engineer: EngineeringPort, vision: VisionPort):
    intent = vision.interpret(request)  # typed, bounded, no invented dimensions
    ensure_supported(intent)
    plan = engineer.solve(intent.model_dump())
    assert_build_plan_contract(plan)
    plan = attach_provenance(plan, model_or_fixture_mode=vision.mode)
    persist_immutable_revision(plan)
    return plan
```

- Use FastAPI `BackgroundTasks` only as an in-process hackathon job runner (or a process-local queue); don't call it production-durable.
- Jobs are addressable and status is persistent at least within current demo process. If process restarts, saved builds can be reloaded from disk.
- SSE reconnects should replay actual events by ID; return safe errors and do not hang indefinitely.
- Under fixture mode, load a **saved build** and mark it visibly as such; do not synthesize fake “AI deciding” progress.

#### A3. Project storage and edits

- Store JSON revisions in `data/projects/{build_id}/revision-{n}.json`, via safe path construction and atomic write + rename. Do not allow user-controlled file paths.
- `POST /edits` requires `base_revision` and returns 409 for stale clients.
- Parse allowed operations only: `set_budget`, `set_behavior_parameter`, `replace_optional_sensor`, `set_mount_offset_within_template`, `change_appearance_color` (extend only when B supports). For the text instruction, LLM may select one of these operations, not an arbitrary unsafe patch.
- Route edit to B's `apply_edit`, validate result, increment revision only if accepted. Failures leave previous revision untouched.
- Keep an append-only edit log with input and actual findings. Undo/redo can load previous revisions without mutating them.

#### A4. Firmware generator (important for Fate Labs)

- Generate PlatformIO project from **one supported exact profile**: `rover.obstacle_avoidance.v1` targeting the chosen ESP32 variant.
- Template placeholders strictly allowed: GPIO map from validated B output, I2C address/profiles from exact catalog driver, behavior thresholds, motor PWM/control mapping, human-readable metadata.
- Structure generated ZIP: `platformio.ini`, `src/main.cpp`, `include/rivet_config.h`, `README.md`, `manifest.json`, optional license text for bundled dependencies.
- Map each generated firmware symbol back to its supporting template source file. Code should use hardware abstraction functions (`drive_forward`, `turn_in_place`, `read_front_distance`, `stop_motors`) so source grounding is meaningful.
- Test compile using installed PlatformIO in a bounded subprocess with a strict timeout and known project working directory. **Never execute user-provided shell commands** from a prompt, generated text, or image.
- If toolchain unavailable, mark `compile_status=not_checked` rather than passed. If compile fails, return logs summary and `failed`.
- No direct motor drive via microcontroller pins; generate signals to a documented motor driver only.

#### A5. Estelle integration (real, not simulated)

Implement `RepoGrounder` with interfaces `locate_symbols(query)`, `inspect_dependencies(symbol)`, `verify_change(paths)` and `capture_evidence()`. Exact tool calls must match the actual installed Estelle MCP/CLI tool set; **do not invent endpoint or tool argument names**.

Official client options:

- MCP hosted server endpoint documented at `https://api.fatelabs.ca/mcp` (OAuth through client).
- CLI setup documented as `npm i -g @fatelabs/estelle`, then `estelle login` and `estelle setup` in the repo.
- Official docs: `https://www.fatelabs.ca/docs/install` and `https://www.fatelabs.ca/docs`.

Hackathon integration strategy:

1. Connect and index Rivet's **actual** firmware source/template repo with Estelle.
2. Ask it to locate the implemented front-range sensor reading, motor control entry points and shared behavior-state logic.
3. Use those **actual citations/definitions** to ground an allowed code modification to obstacle behavior. Keep the change scoped to the firmware template, not arbitrary filesystem writes.
4. Run PlatformIO compile/tests before claiming success.
5. Capture `estelle_evidence.json` containing actual tool name, time, referenced repository path/symbol/source ranges and result status; never manufacture citation-like strings.
6. In the UI, display real evidence and test result, or “Estelle unavailable” if connection failed. An evidence-free generated code answer **does not** count as Estelle success.

Hosted Estelle may only see pushed code; official docs distinguish CLI/plugin modes for uncommitted working-tree grounding. If demonstrating new local edits, use a supported mode that can actually inspect them, or push a safe branch before grounding.

#### A6. Tests and independent demo

- Unit: image file type/size reject; valid text IntentSpec; unsupported drone intent; model JSON parse failure; deterministic fallback labeling.
- Unit: generate with fixture adapter returns valid versioned plan and honest source mode.
- Unit: stale revision returns 409; rejected edit preserves previous snapshot; accepted edit increments revision.
- Unit: code generator produces all required ZIP members and pin-map data from fixture.
- Unit: PlatformIO compile outcome correctly reports `passed/failed/not_checked` (mock subprocess allowed in CI).
- Unit: missing Estelle credentials never fabricates evidence.
- Demo command: `RIVET_MODE=fixture uvicorn rivet_api.main:app --reload --port 8000` exposes endpoints without B/C.

**A completion criteria:** API contract tests green; fixture and live adapter switch works; authenticated Estelle grounding integration documented and demonstrated when available; firmware export exists for supported plan; no silent fake mode.

---

### Developer B — Hardware intelligence, catalog, validator, BOM, wiring and assembly

**Owner:** Everything in `packages/engineering/**`. Implement a pure typed Python engine. **Never call the LLM, web, or API from within `solve()`**. B can work entirely from fixture IntentSpec.

#### B0. Domain model and public entry points

```python
def solve(intent: dict) -> dict:
    """Return a complete versioned BuildPlan for supported rover intent."""
    ...

def apply_edit(plan: dict, operation: dict) -> dict:
    """Return new BuildPlan candidate or rejection; never mutate input."""
    ...

def verify(plan: dict, catalog: dict) -> dict:
    """Return structured verification report; deterministic."""
    ...

def get_catalog() -> list[dict]: ...
```

- Pure functions wherever practical; fixed fixture should produce byte-stable ordering except intentional metadata timestamp.
- Validate all input/output via Pydantic v2 and JSON schema.
- No model-generated raw coordinates. `IntentSpec` proposes semantic needs; `rover_2wd` template and mounts compute every transform.

#### B1. Catalog from real components

Build a small **source-backed** catalog, not a scraped catalog of 10,000 unverifiable listings. Each entry includes:

- `catalog_id`, manufacturer/model/SKU or product family variant; quantity/pack semantics.
- Exact dimensions (verified or approximated/unknown flag), local render recipe or GLB path, mass if known.
- Mount frames, allowed mate types, port definitions (GPIO/I2C/motor power/motor outputs) and polarity constraints.
- Nominal/range logic and motor supply voltages, current specifications **with provenance**; use `null` for missing values.
- Manufacturer/product URL, datasheet URL, vendor URL **only if verified**, price amount/currency/checked-at **only if actually obtained**.
- Evidence per dimension and rating with source and date.

Start with one known coherent two-wheel rover stack. A realistic architecture may use one ESP32 dev board, a TB6612FNG-class motor driver breakout, two gear motors, a documented ToF breakout such as the Adafruit VL53L0X, pre-made chassis with matching wheels/caster, cables, fasteners and documented power arrangement. Verify exact product variant and electrically relevant limits before marking checks passed. A 2WD chassis can have two drive wheels plus one caster, rather than inventing a third motor. Avoid relying on HC-SR04 direct 5 V echo into 3.3 V GPIO unless a suitable level shifter/divider is explicitly included and specified.

**Critical electrical truth:** A motor driver's acceptable logic Vcc does not establish its motor output current capacity or supply compatibility. Use individual exact SKU docs. If motor stall current is unavailable, current-related verification is `UNKNOWN`, not PASS.

#### B2. Parametric mechanical assembly

- Use a known 2WD chassis template defining named mount frames such as `motor_left`, `motor_right`, `controller_deck`, `driver_deck`, `range_sensor_front`, `caster_rear`, and wheel/shaft connectors.
- Define all model-space transforms in mm and use a consistent right-handed Y-up system. A child pose is computed by composing parent world transform and mount-local transforms; output stored per instance.
- Generate a visually valid rover with chassis, motors, wheels, controller, driver, front sensor, power and other required components. Use distinct instance IDs for duplicates.
- Verify mount compatibility and missing anchor references. Basic collision uses geometry AABBs where shapes/poses permit; record limitations and explicit allowed mates that intentionally overlap at connection surfaces. For rotated geometry use conservative transformed AABBs or OBB only if feasible.
- Do not claim load-bearing engineering from a center-of-mass heuristic alone. If mass unknown, mass-related checks are unknown, not reliable stability proof.
- Support an allowed sensor height adjustment **within** template-defined range, recalculating pose and clearance.

Pseudo-code for deterministic placement:

```python
def place_child(parent_world, parent_mount, child_mount):
    # Define mount transforms as rigid transforms in one coordinate convention.
    # world_child = world_parent * parent_mount * inverse(child_mount)
    # Assert matching mechanical mate types before committing.
    return compose(parent_world, parent_mount, inverse(child_mount))
```

#### B3. Electrical graph, driver and controller assignment

- Every power or signal connection references documented endpoints in actual catalog items.
- Allocate GPIO deterministically from a curated list of usable pins for the **exact selected board**; respect reserved/boot-sensitive pins and bus rules from manufacturer docs. Do not hardcode a generic pin map for all ESP32 variants.
- Motor signals: driver PWM/direction/enable pins map to supported controller outputs; motor outputs go to motor terminals; separate motor supply and logic supply represented explicitly; common ground represented in netlist.
- Distance sensing: front range sensor I2C SDA/SCL uses the correct supply/logic levels for the selected breakout; address collisions are reported if multiple devices share address.
- Validate polarity/supply range, known current limitations, pin quantity/conflicts, unsupported peripherals and unconnected required ports.
- Represent no-electrical-risk certainty: `UNKNOWN` where motor inrush/stall, noise, total power or board wiring parameters cannot be verified.
- Produce a **structured netlist**, not an unreviewed pretty wiring picture; C renders it.

#### B4. Deterministic validators

Each rule produces one or more findings with **rule_id, result, severity, affected_instance_ids, message, evidence_urls**. Required categories:

1. **Referential integrity**: all component/mount/port/BOM/step IDs resolve.
2. **Requirements and family**: supported rover configuration/behavior only; list unsupported behaviors explicitly.
3. **Mechanical**: mount type/mating, bounds, clearance, geometry overlap heuristics, chassis dimensions; preserve unknown source geometry flags.
4. **Electrical logic**: logic-level voltage, driver input compatibility, GPIO availability, I2C bus/address and documented pin restrictions.
5. **Electrical power**: motor power supply in rated range; known peak/stall current against driver rating; power source capacity where rated; unknown if missing data.
6. **BOM completeness**: every placed component counted, required accessories/fasteners included or marked unknown, no phantom line items.
7. **Budget**: quantity × confirmed price; if any required item missing price, budget result unknown/incomplete even when known subtotal is low.
8. **Firmware support**: selected board/driver/sensor/behavior maps to a tested firmware template; otherwise `not_supported` and block claimed firmware readiness.

Example failing finding:

```json
{
  "rule_id": "electrical.motor_driver_current",
  "result": "UNKNOWN",
  "severity": "blocking",
  "affected_instance_ids": ["motor-left-1", "driver-1"],
  "message": "Cannot confirm stall-current margin because this motor's stall-current rating is not sourced",
  "evidence_urls": []
}
```

Overall aggregation:
- `unbuildable` if a supported mandatory requirement has a known unsatisfied FAIL with no legal repair.
- `needs_review` if mandatory UNKNOWN remains (or required unsupported documentation), even if no FAIL.
- `verified_with_warnings` if all mandatory implemented checks PASS but advisory WARN/UNKNOWN remain.
- `verified` if all implemented required checks PASS, no blocking issues, and no advisory issues; label this as **verified against supported rules**, not physically certified.

#### B5. Repair engine

Implement a bounded repair loop with an explicit hierarchy of fixes:

```text
propose catalog-backed configuration
  → place mounts + allocate netlist
  → run deterministic validators
  → if pass or only labeled limitations: finalize
  → if repairable: try deterministic compatible substitution or local layout correction
  → re-run ALL relevant validation gates
  → stop after <=3 repair rounds, return best candidate with truthful failures
```

Priority: fix an exact known bad component choice with a **documented compatible** alternative; never arbitrarily choose a cheaper motor if current/power not verified. No LLM required to repair known catalog issues. A separate AI suggestion can be passed in as a new intent; the verifier remains final authority.

Tests must include: valid supported combination, wrong logic voltage, not enough pins, impossible mount, invalid reference, missing price, impossible budget, unsupported behavior, non-matching current limit, and deterministic repair.

#### B6. BOM, assembly steps, and serialization

- **BOM:** group by `catalog_id`, record quantity, instance IDs, manufacturer/model, unit price/URL states, and row total only when known. `known_subtotal` is not total. Costs/currency must not mix silently.
- **Sourcing:** If vendor link is unverified, show manufacturer reference and `manufacturer_reference_only`, not invented purchase URL. Timestamp/checking process recorded where prices do exist.
- **Assembly:** topologically order by structural dependency; mechanically attach chassis, motors, wheels, caster, electronics, wiring, checking after each logical stage. Assembly instructions for power connections should include caution not to connect until wiring verified. Steps must be referentially valid.
- **Serialization:** deterministic ordering; `BuildPlan` fully JSON serializable with only documented fields; B does not store in A's persistence folder.
- **Simulation:** export `wheel_radius_m`, `wheel_base_m`, bounded nominal speeds, sensor range assumptions and behavior profile from chosen configuration. If derived dimensions/specs unknown, use explicitly labeled heuristic defaults and mark simulation approximate.

#### B7. Independent tests and demo

- `pytest packages/engineering/tests -q` fully offline.
- `python -m rivet_engine.demo --intent fixtures/intent/rover_obstacle_v1.json --output /tmp/rivet-plan.json` generates a complete plan without A/C.
- Contract test: missing connection instance invalid; valid plan references all instances; 2 wheels correspond to 2 motor roles; BOM matches component counts.
- Repeatability: same input/catalog version → same component selections/transforms/steps, ignoring timestamp.
- Failing-input tests return concrete findings, never an unhandled traceback.

**B completion criteria:** valid and failing plans generated deterministically, catalog has identifiable sourced parts and honest unknowns, mechanical/electrical/BOM gates run, edits preserve consistency, no dependency on AI or renderer.

---

### Developer C — Exceptional 3D studio, frontend data layer and bounded simulation

**Owner:** `apps/web/**`, excluding final designer-owned UI styling after handoff. Your main engineering deliverable is the **highest-quality 3D scene and interaction system possible**, not a fancy landing page. Start from shared fixture without API or agent.

#### C0. Local bootstrap

- Scaffold Next.js with simple `Upload`, `Load demo`, `Open studio` controls; a plain functional UI is acceptable until designer supplies polished visuals.
- Create `src/lib/contracts.ts` from JSON schemas and enforce fixture validation (Zod optional). Add a typed `RivetDataSource`:

```ts
export interface RivetDataSource {
  getCatalog(): Promise<CatalogComponent[]>;
  getBuild(buildId: string, revision?: number): Promise<BuildPlan>;
  generate(input: GenerateRequest): Promise<{job_id: string}>;
  edit(buildId: string, request: EditRequest): Promise<EditResponse>;
}

export class FixtureSource implements RivetDataSource { /* uses checked fixtures */ }
export class HttpSource implements RivetDataSource { /* uses documented API */ }
```

- Start rendering valid fixture plan immediately. Do not wait for B to choose parts or A's service to boot.

#### C1. Part-backed 3D renderer (top priority)

Use one primary React Three Fiber canvas. Geometry is derived from `CatalogComponent.physical`, combined with `BuildPlan.components[].pose`.

- Map `catalog_id → asset/procedural mesh recipe`; use glTF/GLB only with permitted licenses, attribution and accurate scale. If no asset, compose high-quality procedural components from boxes/cylinders/torus/extrusions, using catalog dimensions.
- Separate `PartNode` transform (real pose) from visual detail meshes; add external chrome only as non-physical decoration on the same node. Do not create phantom purchasable components.
- Draw chassis at origin, matched wheel and motor pairs, recognizable ESP32 board, motor driver, front sensor, battery/power pack, caster and mounting brackets. Use distinct material presets.
- Implement orbit controls, zoom bounds, fit-to-assembly, smooth transitions, selection raycasting, tooltip names and linked inspector, hiding/isolating, wire overlay and debugging overlay toggle.
- Strong opening camera and deterministic snapshots; auto-framing based on bounding box and canvas aspect.
- Optimize: memoize geometry/materials, coalesce primitives, cap device pixel ratio 1–1.5, pause hidden animations, dispose resources, avoid unnecessary new WebGL contexts for product cards.
- Drag/selection should never silently mutate `BuildPlan` geometry without backend validation. If direct manipulation is added, preview ghost only; commit via accepted edit endpoint.

#### C2. Exploded view and assembly timeline

- Exploded view computes offsets from component hierarchy and role, keeps deterministic direction and ordering, interpolates against original poses. The canonical assembly remains unchanged.
- Assembly timeline reads actual `assembly_steps`, reveals exactly referenced `instance_ids`, and ghosts future steps. A selection highlights related BOM entry and vice versa.
- User can click or scrub step `n`, play/pause, and return to full assembly without desynchronization.
- Add well-lit assembly stage, soft shadows, ambient occlusion where performant, restrained outlines, smooth ~200–400 ms transitions, no glitter/noise for its own sake.
- Wiring overlay draws separate color-coded paths from actual electrical connections/ports. If a 3D port location is unknown, use a label or schematic fallback, not a precise fake wire pin placement.

#### C3. BOM and inspector UX (functional shell)

- Inspector of selected part: catalog name/role/SKU, unit quantities, known versus unknown price, manufacturer/datasheet/purchase links, relevant verification findings and assembly steps.
- `purchase_url` clickable only if sourced; `link_status` visible. A manufacturer reference is not styled as guaranteed store checkout.
- BOM count derived from `plan.bom.items`, not hardcoded display text. If price incomplete, show “Known subtotal” or “Total unavailable” rather than “Total $X.”
- Verification inspector shows PASS/WARN/FAIL/UNKNOWN and context; `verified` is never presented as a universal safety guarantee.
- Project revision switcher and user edits call API or fixture-mode stub, never locally invent validated results.

#### C4. Bounded rover simulation (must work)

Use a **2D differential-drive kinematic model** with an attractive visual stage (may render robot in 3D on a flat obstacle course, but physics calculation remains 2D). Do not spend 10+ hours integrating a heavyweight universal physics engine.

Continuous kinematics:

```text
v = (v_right + v_left) / 2
omega = (v_right - v_left) / wheel_base_m
x_next = x + v * cos(theta) * dt
y_next = y + v * sin(theta) * dt
theta_next = theta + omega * dt
```

- `dt` clamped, e.g. max 0.05 s; use a fixed timestep accumulation for reproducibility. State and positions in meters.
- Raycast a front-facing distance sensor against a couple of fixed polygons or circles within configured `sensor_range_m` and `sensor_fov_deg`; clearly approximate.
- Implement the `FORWARD → STOP → TURN → FORWARD` state machine from `BehaviorSpec`, plus `DISABLE`.
- Draw rover, obstacles, sensor cone/ray, animated wheels and track trail. Present current state, range and speed.
- Distinctly label **“Simplified kinematic simulation”** and limitations. Do not depict collision avoidance as proof of real robot safety.
- Simulator parameters must be sourced from current plan; varying width/wheel base or behavior threshold changes the simulation.
- Deterministic fixture test: robot approaches obstacle; enters STOP/TURN at expected threshold; never moves through wall in test scenario (stop at boundary or explicitly report collision rather than pass through).

#### C5. Image/prompt upload and streaming job UX

- Temporary functional upload, image preview, prompt form, loading/progress view. Parse events from SSE or poll `GET /api/jobs/{id}` when SSE unavailable.
- `FixtureSource`: obvious “Saved example” label, instant model load; no animated pretend generation steps.
- `HttpSource`: consumes actual job stages and displays real status, error handling, and retries.
- Do not upload oversized files from browser and do not put provider keys in browser JS.

#### C6. Designer interface and handoff

The designer controls final aesthetic; C must **expose clean components and predictable slots**:

```tsx
<StudioShell
  sidebar={<ProjectControls ... />}
  scene={<RoverScene plan={plan} catalog={catalog} ... />}
  inspector={<PartInspector ... />}
  timeline={<AssemblyTimeline ... />}
  bottomPanel={<SimulationPanel ... />}
/>
```

Use tokens/classes instead of hardcoding branding across engineering components. Hold a 15-minute review at hour 8–10: agree screen dimensions, DOM slots, event names, props and token names. Designer may own `components/ui/**` and `styles/**` after that handoff; C remains owner of `components/three/**`, `components/sim/**` and data integration. Keep the original working controls accessible if final animations break.

#### C7. Tests and independent demo

- `pnpm --dir apps/web dev` runs with `NEXT_PUBLIC_RIVET_USE_FIXTURES=true`, zero API required.
- Contract test: fixture validates, every plan instance renders a `PartNode` with its `instance_id`, every selected instance maps to a BOM row.
- Timeline test: step count from `assembly_steps`, correct parts visible at each step.
- Simulation unit tests: exact differential-drive straight/turn behavior; obstacle ray and state transition; behavior threshold update; disable stops.
- UI test: selected `driver-1` shows its real catalog evidence and never fabricates a purchase URL.
- Performance smoke: viewport interactive on target laptop with no WebGL context crash or uncontrolled geometry allocations.
- At least one screenshot/golden reference from fixed camera, stable and aesthetically polished.

**C completion criteria:** high-quality interactive studio, connected BOM/assembly inspector, selected-parts highlight, true exploded/timeline state, runnable deterministic rover simulation, both fixture and API adapters. Surrounding non-3D UI may remain understated until designer integration.

---

## 7. Practical 36-hour schedule with independent checkpoints

**Assumption:** A ~36-hour SOON development window, three developers + separate designer. If less time remains, follow the cut order in section 10. Every checkpoint is an **artifact produced independently**, not a meeting where teammates wait.

| Window | Developer A | Developer B | Developer C | Designer |
|---|---|---|---|---|
| 0–2 h | API fixture endpoint, typed intent, vision stub | Domain types, catalog seed, working sample rover transform | Render fixture in basic scene with orbit | Reference moodboard, Rivet identity, layout principles |
| 2–8 h | Image upload, real/fixture parser, jobs and SSE | Catalog + mount engine + complete valid BOM | Functional 3D part meshes, selection, material polish | Studio wireframe, control patterns, interaction specs |
| 8–12 h | Edits/revisions and pipeline integration adapter | Mechanical/electrical findings and failing fixture | Exploded view, assembly timeline | Deliver CSS tokens, base controls, responsive shell |
| 12–18 h | Live provider + supported planner; firmware scaffold | Repair/substitution + assembly steps + source-backed links | Simulation core, obstacles and behavior logic | Polish upload/progress/inspector designs |
| 18–24 h | Estelle grounding + compiler + real endpoint integration | Full engine contract and regression tests; substitute verified parts | Live backend switch, simulator polish, wiring overlay | Integrate UI visual polish in bounded owned folders |
| 24–30 h | Error handling, evidence, deployment, exports | Fix integration findings, freeze hardware catalog | Performance, camera/lighting, demo flow and UI tests | Final motion, screenshots, responsive fixes |
| 30–36 h | End-to-end test, sponsor demo, fallback | Verify BOM links, checks, hardware truthfulness | End-to-end run, animation stability, screenshot record | Pitch visuals, rehearsal and polish only |

### Hour 8 gate: every lane can demonstrate itself

- A: image/text fixture → validated IntentSpec → `generate` returns saved BuildPlan JSON with real job/result semantics.
- B: `solve(IntentSpec)` → complete rover BuildPlan with matching instance IDs, BOM, known/unknown verification.
- C: opens fixture in styled, interactive 3D and selects parts, independently of API.
- Designer: documented, implementable design tokens and layout wireframe; no engineering deadline is blocked.

### Hour 16 gate: working vertical path

- A+B: HTTP can return B-generated BuildPlan from a real parsed intent.
- B+C: C can render B-generated fixture without transformation/refactor.
- A+C: C can load a saved plan over HTTP in lieu of live generation.
- Full project: single valid (or honestly caveated `needs_review`) rover displayed with BOM and one meaningful edit.

### Hour 24 gate: freeze product scope

Stop adding major new project families or architecture. Prioritize complete flow: input → model → validation → BOM → assembly → simulation → firmware. Hook up Estelle using actual service; if it fails, keep truthful fallback and focus on demonstration proof. Designer/UI integration should not endanger functioning canvas.

### Hour 30 gate: demo freeze

No new dependencies, no framework swaps, no geometry schema changes, no speculative drone functionality. Capture one supported saved example (with a timestamp and visible label), check offline path, compile firmware if possible, practice demo against fresh data and the fallback.

### Hour 34–36: rehearsal and final verification

Rehearse timed 3-minute demo, hardware caveats, Estelle evidence, total prices, what is genuinely implemented. Confirm every displayed SKU and supplier link works, or label it unverified/not available. Assign one person to drive UI, one to handle backup environment and one to answer architecture questions.

---

## 8. Integration recipes and contract test strategy

### End-to-end pipeline in production-mode semantics

```text
POST /api/assets/images
  → stores image and returns asset_id
POST /api/projects/generate
  → creates job, stores staged events
VisionAdapter.interpret(image/text)
  → IntentSpec (strict parse, uncertainty recorded)
EngineeringPort.solve(intent)
  → BuildPlan (real catalog selection + placement + validation)
ProjectStore.save(plan)
  → immutable revision JSON
GET /api/projects/{id}
  → Web parses BuildPlan and catalog
RoverScene + Inspector + BOM + Timeline + SimView
  → all use same plan instance IDs
POST /api/projects/{id}/edits
  → typed op -> B's engine -> validate -> new revision or rejection
GET /api/projects/{id}/exports/firmware.zip
  → supported template from current pin map + profile + compile status
```

### API/engine boundary: no leaking internals

A should only import these B entry points from public `rivet_engine` package:

```python
from rivet_engine import solve, apply_edit, verify, get_catalog
```

Do **not** import `rivet_engine.mounts` directly from A. B has freedom to refactor internal validation. In A's tests, stub those four functions or use `FixtureEngineeringAdapter`; do not depend on B being finished.

### Frontend/backend boundary: no Python-only state

C consumes JSON from HTTP/fixtures, never assumes access to Python classes or Python runtime. Explicit TypeScript type guards fail closed on invalid JSON; do not render a plan that references missing catalog IDs as if all parts exist. Display a recoverable contract error.

### Integration smoke script: required assertions

```text
1. POST a local rover image, get asset_id.
2. POST generate with image_asset_id and obstacle_avoidance intent.
3. Poll job until complete (bounded timeout); events reflect real transitions.
4. GET returned build; schema_version == 1.0.
5. Assert no unresolved referenced catalog, instance, mount or port IDs.
6. Assert rendering item count == plan.components count (excluding documented
   visual-only children inside one component), all rows linked by catalog_id.
7. Assert known BOM subtotal is labeled incomplete when any required price null.
8. Edit mounted sensor height inside allowed template range.
9. Assert revision increment; selected sensor pose changes; validation reruns.
10. Load simulator: threshold + wheel base derive from new revision.
11. Export firmware ZIP and verify manifest build_id/revision match selected.
12. Run compile if toolchain installed; report actual result.
13. If Estelle connected, show recorded source-grounded symbols and actual check.
14. If offline, load saved fixture explicitly labeled 'Saved demo build'.
```

### Tests per layer

| Layer | Minimum passing tests |
|---|---|
| Schema | Valid real fixture passes; dangling instance, unknown port, bad enum, missing schema version rejected |
| Vision/intent | Valid image/text normalized; unknown project family not falsely supported; bad AI JSON rejected |
| Engineering | Compatible rover, voltage mismatch, motor-rating unknown, pin conflict, missing mount, incomplete BOM, budget unknown, deterministic repair |
| Revisions | Edit accepted only if valid; reject leaves original immutable; stale base revision 409 |
| 3D | Correct instance IDs, pick → inspector, explode resets, assembly step visibility, no crashing null fields |
| Simulation | Straight, turn, obstacle STOP/TURN, disable; uses current wheelbase and threshold |
| Firmware | Selected supported profile maps pins, includes all zip files, not-supported status otherwise, compile status truthful |
| Estelle | Missing auth → unavailable; real evidence has real source paths; no fake citations; changed files actually compile/test |
| End-to-end | Upload fixture → actual BuildPlan → inspector/BOM/scene → edit → firmware export |

---

## 9. Core algorithms and implementation notes

### 9.1 Solver strategy: small constrained search, not arbitrary generation

For rover MVP, do not solve full CAD/robot synthesis. Start from one chassis template and enumerated catalog options. Filter by behavior capability (requires motion, controller, range sensor), budget (when prices complete), known electrical compatibility, and mount availability. Score passing candidates by requirement satisfaction, size and cost confidence; preserve unknown values rather than pretending low cost. Return first/best supported candidate plus findings. Deterministic tie-break by sorted `catalog_id`.

```python
for config in candidate_configurations(intent, catalog):
    instances = place_from_template(config)
    netlist = allocate_documented_ports(instances)
    plan = make_build_plan(intent, instances, netlist)
    report = verify(plan, catalog)
    if no_blocking_failures(report):
        return finalize(plan, report)
    remember_failure(plan, report)
return best_honest_failure_or_unbuildable()
```

A model cannot override validator results. Use a bounded number of candidates; record rationale, alternatives and unknowns. The aim is evidence-backed, not the largest possible search tree.

### 9.2 Component geometry, mounts and exploded motion

Physical `pose` is immutable world transform. Asset-local orientation is handled inside its renderer recipe and should not corrupt engineering pose. A mounting relationship relates two named local frames. For exploded view, compute **presentation-only** displacement:

```ts
const displayPosition = realPosition.clone().add(
  explosionDirectionByRole[role].clone().multiplyScalar(explosionProgress)
);
```

Never write `displayPosition` back into BuildPlan. When switching revisions, interpolate between poses for **matching instance IDs**; spawn/remove newly added IDs with opacity/scale animation, not mismatched moving hardware.

### 9.3 Mechanical verification scope

Checks supported: exact named mount existence, mating compatibility, known bounding-box overlap excluding documented fastening interfaces, chassis component placement inside permissible envelope, no unsupported mount offsets. Unknown source dimensions cause unknown/needs-review. Full finite-element stress, bolt torque, vibration, collision under physical motion and certified stability are **not** implemented. Do not write “guaranteed stable” in UI.

### 9.4 Electrical verification scope

Use a typed connection graph and voltage/current constraints. Distinguish:

- Supply domain: motor supply vs logic supply vs sensor supply.
- Signal direction: input/output/I2C bidirectional/open-drain as documented.
- Board pin capabilities and reserved pins for exact board variant.
- Driver continuous/peak ratings and documented motor current (including stall when available).
- Ground continuity, polarity and required decoupling **only** if catalog/template specifies.

Fail certain contradictions, e.g. known incompatible logic levels. Mark missing vendor specifications unknown. Do not infer unseen connectors from input image.

### 9.5 Pricing and source verification

- Require `manufacturer_reference_url` (or reliable documentation) for real catalog entries, preferably exact SKU.
- Purchase URL must point to specific actual product listing and be manually or programmatically checked at curation time; URL alone does not establish stock/price.
- Record timestamp and currency for every captured price. In a static hackathon catalog, expiry/freshness is expected. No live stock claims.
- Include required ancillary items in BOM: wires, motor power, mounts, fasteners, caster, switch, as applicable; missing accessories turn completeness to WARN/UNKNOWN.
- Provide one-click link from 3D selected instance to matching catalog/BOM entry, not fabricated shopping widgets.

### 9.6 Generated firmware limits

The ESP32 firmware should be **template-based** to maximize correctness. The agent may choose behavior parameters and supported drivers, not write unreviewed arbitrary code. Any LLM/Estelle-assisted patch is only accepted after code review/compile tests and it does not bypass the B hardware verifier. Use stable source names/functions so citations are meaningful. README warns about wiring verification and real sensor calibration. When driver versions require an update, pin known compatible versions rather than assuming any library API.

### 9.7 Image grounding and uncertainty

Vision should extract only image-supported shape/style attributes and optionally infer likely category. It should never say “this image contains model X motor with 1.2 A stall current” from appearances. Prompt rules:

```text
You are Rivet's visual requirements extractor, not a hardware certifier.
Describe visible shape and probable functions. Distinguish observed facts,
user-stated constraints, and assumptions. Do not infer invisible electrical
ratings, exact product SKUs, dimensions, or safety certifications. Return
strict JSON matching IntentSpec. If unsupported, return unsupported status.
```

Then a deterministic catalog mapper chooses actual parts. If visual request is not achievable with supported templates, show “buildable interpretation” and clear differences instead of generating a fake exact reconstruction.

### 9.8 Simulation honesty

A 2D differential-drive model can show how a rover **might** respond under abstracted sensing. It does not model real motor torque, center of mass under acceleration, wheel slip, noisy measurements, battery discharge, mechanical failures or hazards. The simulator should have reset, replay, speed controls and deterministic seed. Use a readable environment, not an empty spinning robot; display state/obstacle distance so behavior is understandable.

---

## 10. Priorities and explicit cut order

### P0 — Absolutely required; do these before embellishing

1. Shared schemas and fixture plan plus seed catalog.
2. A working image/text-to-IntentSpec pipeline (fixture fallback disclosed).
3. B's component-backed rover with consistent catalog IDs, mounts and BOM.
4. Actual validation with at least one meaningful failure/repair or honest rejection.
5. C's polished 3D viewer, picking, exploded mode and assembly steps.
6. Simplified rover obstacle behavior, tied to BuildPlan.
7. Firmware template and real export tied to revision.
8. Real saved-example fallback and honest status everywhere.

### P1 — Track competitiveness after P0 is solid

- Estelle-powered, source-backed firmware modification with real evidence and compilation.
- Wiring overlay from actual netlist.
- Edit budget/sensor height and see a validated revision.
- Strong designer integration and excellent demo transitions.
- One documented physical rover running equivalent supported behavior.

### P2 — Only if everything else is stable

- RC-car variant using same template/driver primitives.
- Second sensor/control profile; advanced simulation visuals.
- Better GLB assets, procedural screws/labels, screenshots.
- Advanced design options and project gallery.

### Cut immediately if the schedule slips

- Engineered drone/robot-arm support (appearance-only concept models of any object are in scope, see 0.1), universal device editor, full 3D generative CAD, PCB routing, high-fidelity robotics physics, fabrication ordering, marketplace checkout, native app, multi-user collaboration, real-time retailer stock sync, unbounded source-code editing, payments and manufacturing certification.

---

## 11. Designer-specific handoff contract (fourth contributor)

Designer owns the final **visual system**, not separate engineering deliverables. The design task is substantial: create a compelling branded app while C builds first-class Three.js interactions. Designer may use separate Figma/static work without needing local API. After hour 8–10, take over bounded `apps/web/src/components/ui/**` and `apps/web/src/styles/**` from C; coordinate any `StudioShell` prop changes.

### Expected designer outputs

- Name/brand: **Rivet**, cohesive identity, favicon, simple usage-friendly logo/wordmark. No imitation of other products' styling.
- Screen compositions: home/upload, analyzing, studio, component inspector, BOM/build kit, assembly, simulation, verification status, empty/error.
- Tokens: colors, text scale, radii, spacing, shadows, motion durations, dark/light approach, accessible contrast.
- Functional states: loading, unknown price, broken supplier link, unsupported family, verification warnings, simulation limitation, Estelle unavailable.
- Interaction polish: upload drop zone, scene toolbar, side panels, selection context, progress timeline, mobile responsive fallback.
- Visual priority: 3D scene occupies primary viewport; don't bury it beneath giant prompt cards.

### Design boundaries

- The designer can improve composition and presentation but cannot change field names, simulation physics, catalog semantics, or verification logic.
- No fake progress animations suggesting hardware was validated when it wasn't.
- No unnecessary modal workflows to reach the central 3D model.
- Do not block developer C from shipping 3D work; abstract scene in `<StudioShell>`.

---

## 12. CI, dev commands, code health and release

### Local setup

From repo root (commands are expected scripts to implement during bootstrap):

```bash
# Web setup
pnpm install
pnpm --dir apps/web dev

# Backend setup
cd services/api && uv sync && uv run uvicorn rivet_api.main:app --port 8000 --reload

# Standalone engineering tests
cd packages/engineering && uv sync && uv run pytest -q

# Frontend checks
pnpm --dir apps/web lint
pnpm --dir apps/web test
pnpm --dir apps/web build

# API checks
cd services/api && uv run pytest -q

# Firmware validation when PlatformIO available
# Generate one profile project first; run in that generated project directory:
pio run
```

If `uv` isn't installed, a Python 3.11+ venv with `pip install -e .[dev]` is acceptable. Keep commands in README accurate to the actual repo; never claim commands are tested until they run.

### CI workflow

Separate jobs: (1) shared JSON fixture/schema validation, (2) engineering `pytest`, (3) API fixture-mode `pytest`, (4) web lint/typecheck/Vitest/build, (5) optional PlatformIO compile with documented cache. A failed optional external AI/Estelle call **must not** cause offline tests to fail; integration tests should be opt-in with credentials.

### Source-control norms

- Commit early and often; no 12-hour invisible branch.
- PR titles: `[A] API job pipeline`, `[B] Rover catalog & gates`, `[C] Viewer selection & explode`, `[DESIGN] Studio tokens`.
- Don't commit `.env`, uploaded user images, model provider responses containing user data, API keys, private vendor datasets, binary datasets without license, or generated gigantic build folders.
- Dependency addition requires reason, lockfile update, and clean install.
- Review changes to `contracts/**` and supplier data carefully; these are integration-critical.

### Demo contingency matrix

| Failure | Expected fallback |
|---|---|
| Multimodal provider down | Load clearly labeled saved example with same BuildPlan/3D/BOM |
| Estelle not connected | Show source-grounding unavailable; firmware template still generates, no fake citation |
| Price lookup stale | Show sourced product links, known subtotal and unknown live price/availability |
| Firmware compile environment missing | ZIP generated, status `not_checked`; no claim compile success |
| 3D asset missing | High-quality procedural mesh using known dimensions, visibly a representation |
| Mechanical spec missing | Verification `UNKNOWN/needs_review` with reason |
| Hardware prototype fails | Software demo still fully works; explain simulation boundary |
| Backend unreachable at venue | Browser fixture/source mode remains useful and explicitly labeled |

---

## 13. Quality bar and final acceptance checklist

**Do not announce Rivet is complete until these conditions are true:**

- [ ] `project.md` and `implementation.md` reflect actual implementation and supported claims.
- [ ] `contracts/**` v1 is stable; valid fixtures round-trip across Python and TypeScript.
- [ ] A can demo its API in fixture mode independently.
- [ ] B can generate an actual rover `BuildPlan` without A/C or network.
- [ ] C can render/inspect/simulate fixture rover without A/B or network.
- [ ] Input image is interpreted, not copied into a fake final model; visible assumptions documented.
- [ ] Every viewer-selectable physical component points to a catalog item and BOM instance.
- [ ] BOM source/product links are genuine, no invented SKUs/prices/stock, completeness explicit.
- [ ] Electrical/mount validators produce correct PASS/WARN/FAIL/UNKNOWN with sources.
- [ ] Unsupported component substitutions are rejected and previous revision remains intact.
- [ ] User edit changes a real model/property and creates a validated revision.
- [ ] Assembly steps use actual IDs and renderer step visibility corresponds to plan.
- [ ] Simulation uses same revision and behavior profile and displays its limits.
- [ ] Firmware export includes pin map, build manifest, and accurate compile status.
- [ ] Estelle demonstration uses real code-grounded evidence and code change/test or is labeled unavailable.
- [ ] Designer's UI does not break the core 3D model or obscure engineering warnings.
- [ ] Demo has a **real** live path and a clearly labeled saved-example path.
- [ ] No claimed general drone support, real-world safety certification, or exact hidden-part inference. Concept models of any photo are labeled appearance-only and their internals inferred.
- [ ] Teammates have not copied third-party implementation without confirmed permission/license.
- [ ] Automated contract/unit/browser checks pass, and the 3-minute demo is rehearsed.

---

## 14. Hand-off prompts: paste one into each coding agent

### Prompt for Developer A agent

> You are Developer A on Rivet. Read `project.md` and `implementation.md`, especially sections 0–5 and **Developer A** in section 6. Own ONLY `services/api/**`. Build a production-shaped FastAPI service for image/text hardware intent parsing, typed job/SSE orchestration, immutable project revisions and edits, ESP32 firmware template export, and honest real Estelle source-grounding support. Work immediately with fixture schemas and `FixtureEngineeringAdapter`; do not wait for Developer B. Do not invent unsupported AI capabilities, measurements, Estelle calls, compile success, prices or UI. Ensure fixture mode is fully operable and clearly labeled. Deliver code, unit tests, README commands, and a sample API demo. Never change other owners' implementation folders or v1 contracts without agreement. Start by writing API fixtures and tests, then implement.

### Prompt for Developer B agent

> You are Developer B on Rivet. Read `project.md` and `implementation.md`, especially sections 0–5 and **Developer B** in section 6. Own ONLY `packages/engineering/**`. Implement a standalone, deterministic, typed hardware design engine taking `IntentSpec` and returning the canonical `BuildPlan`. Focus on a 2WD ESP32 indoor rover with a curated source-backed component catalog, semantic mount frames, electrical pin/netlist allocation, mechanical/electrical/budget/referential checks, limited deterministic repair, BOM and assembly steps. All unknown ratings stay UNKNOWN; never certify real-world safety or invent part links. Start from the provided intent fixture, no dependency on A/C, and produce a valid complete rover plan plus meaningful failure fixture and pytest coverage. Expose only `solve`, `apply_edit`, `verify`, `get_catalog`. Do not copy Bricked source or change shared contracts unilaterally.

### Prompt for Developer C agent

> You are Developer C on Rivet. Read `project.md` and `implementation.md`, especially sections 0–5 and **Developer C** in section 6. Own ONLY `apps/web/**` engineering implementation. Build an exceptional Three.js/React Three Fiber 3D hardware studio using checked fixture `BuildPlan` JSON from day one: precise catalog-based component geometry, strong lighting/materials/camera, exploded view, selection, linked parts/BOM inspector, assembly steps, wiring overlay where grounded, and deterministic simplified rover obstacle-avoidance simulator. Use a typed fixture/API data source toggle; do not wait for backend or engine. The separate designer will own final styling/UI; create only a clean functional shell and stable `<StudioShell>` slots. Do not fabricate validation results or component identities. Optimize the 3D experience ahead of general frontend polish. Deliver browser demo, contracts tests, sim tests and screenshots.

### Prompt for designer (optional, separate person)

> You are Rivet's independent product designer. Read `project.md` and the Designer handoff section of `implementation.md`. Own branding, final UI style, responsive composition and motion while three engineers build the software. Prioritize the 3D studio as the centerpiece, a beautiful upload→assembly narrative, rich part inspection, sourced BOM, clear verification states and intuitive simulation controls. Produce tokens and handoff documentation immediately. After agreeing stable component props with Developer C, implement style/UI in the bounded designer-owned folders. Do not alter contracts, engineering logic, or 3D component placement algorithms. Never style unknown engineering results as verified.

---

## 15. Reference URLs and provenance

**Architecture:** section 4 lists the patterns Rivet implements; all logic, geometry, assets and visual identity are original. No third-party source is reused.

**Tools and hardware documentation:**

- [Estelle getting started](https://www.fatelabs.ca/docs)
- [Estelle installation and MCP/CLI setup](https://www.fatelabs.ca/docs/install)
- [PlatformIO project configuration](https://docs.platformio.org/en/latest/projectconf.html)
- [PlatformIO Espressif32 docs](https://docs.platformio.org/en/latest/platforms/espressif32.html)
- [Adafruit TB6612 breakout pinouts](https://learn.adafruit.com/adafruit-tb6612-h-bridge-dc-stepper-motor-driver-breakout/pinouts)
- [Adafruit VL53L0X breakout pinouts](https://learn.adafruit.com/adafruit-vl53l0x-micro-lidar-distance-sensor-breakout/pinouts)

**Final decision rule for agents:** When torn between (A) a glossy feature that only appears to work and (B) a smaller feature whose 3D, BOM, wiring, constraints and code genuinely correspond to one another, **ship B**. Rivet wins its credibility from the connection between the visible model and the buildable hardware plan.

---

## Appendix A — Copy-ready, internally consistent SYNTHETIC bootstrap fixtures

**Purpose:** These two JSON blocks are provided so A, B and C can implement/test in parallel without waiting on anybody else's server or catalog. They are deliberately synthetic and not supplier-verified. The geometry, electrical ports, dimensions, assembly instructions, and products here are **not real hardware advice**. They must never be represented to judges as a sourced, physically safe robot. B must replace them with documented manufacturer-specific parts and rerun engineering checks before Rivet claims real purchasing/compatibility. A uses this as a labeled offline saved build. C uses it for scene, selection, explosion, simulation and timeline development immediately.

**Startup action:** Copy block 1 to `fixtures/catalog/seed-components.json` and block 2 to `fixtures/plans/rover_obstacle_v1.json`. Add `fixtures/intent/rover_obstacle_v1.json` from section 3.1. `RIVET_MODE=fixture` must show a **Saved synthetic example** banner (C can key it off `provenance.sourcing.synthetic`). The API refuses BOM CSV and firmware exports for this build. Every `demo.*` catalog ID has no purchase URL; the BOM correctly reports unknown total. It is **not** the final sourced demonstration build.

### A.1 `fixtures/catalog/seed-components.json`

```json
[
  {
    "schema_version": "1.0",
    "catalog_id": "demo.chassis_2wd",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "2WD Chassis",
      "sku": null,
      "category": "chassis"
    },
    "physical": {
      "dimensions_mm": {
        "x": 140,
        "y": 12,
        "z": 180
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "polymer"
    },
    "mounts": [
      {
        "mount_id": "motor_left",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "motor_right",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "wheel_left",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "wheel_right",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "caster_rear",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "controller_deck",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "driver_deck",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "front_sensor",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "power_deck",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "power_usb",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  },
  {
    "schema_version": "1.0",
    "catalog_id": "demo.tt_motor",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Gear Motor",
      "sku": null,
      "category": "motor"
    },
    "physical": {
      "dimensions_mm": {
        "x": 65,
        "y": 24,
        "z": 22
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "metal"
    },
    "mounts": [
      {
        "mount_id": "base",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      },
      {
        "mount_id": "shaft",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [
      {
        "port_id": "motor_pos",
        "signal": "motor_power",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      },
      {
        "port_id": "motor_neg",
        "signal": "motor_power",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      }
    ],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  },
  {
    "schema_version": "1.0",
    "catalog_id": "demo.wheel",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Rubber Wheel",
      "sku": null,
      "category": "wheel"
    },
    "physical": {
      "dimensions_mm": {
        "x": 65,
        "y": 18,
        "z": 65
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "rubber"
    },
    "mounts": [
      {
        "mount_id": "base",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  },
  {
    "schema_version": "1.0",
    "catalog_id": "demo.caster",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Rear Caster",
      "sku": null,
      "category": "caster"
    },
    "physical": {
      "dimensions_mm": {
        "x": 28,
        "y": 28,
        "z": 28
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "metal"
    },
    "mounts": [
      {
        "mount_id": "base",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  },
  {
    "schema_version": "1.0",
    "catalog_id": "demo.esp32",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "ESP32 Board",
      "sku": null,
      "category": "controller"
    },
    "physical": {
      "dimensions_mm": {
        "x": 55,
        "y": 8,
        "z": 28
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "pcb"
    },
    "mounts": [
      {
        "mount_id": "base",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [
      {
        "port_id": "gpio18",
        "signal": "digital_output",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      },
      {
        "port_id": "sda",
        "signal": "i2c",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      },
      {
        "port_id": "scl",
        "signal": "i2c",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      }
    ],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  },
  {
    "schema_version": "1.0",
    "catalog_id": "demo.tb6612",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Motor Driver",
      "sku": null,
      "category": "motor_driver"
    },
    "physical": {
      "dimensions_mm": {
        "x": 30,
        "y": 7,
        "z": 25
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "pcb"
    },
    "mounts": [
      {
        "mount_id": "base",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [
      {
        "port_id": "pwm_a",
        "signal": "pwm_input",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      },
      {
        "port_id": "motor_a",
        "signal": "motor_output",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      }
    ],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  },
  {
    "schema_version": "1.0",
    "catalog_id": "demo.range",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Front Range Sensor",
      "sku": null,
      "category": "distance_sensor"
    },
    "physical": {
      "dimensions_mm": {
        "x": 22,
        "y": 8,
        "z": 16
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "pcb"
    },
    "mounts": [
      {
        "mount_id": "base",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [
      {
        "port_id": "sda",
        "signal": "i2c",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      },
      {
        "port_id": "scl",
        "signal": "i2c",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      }
    ],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  },
  {
    "schema_version": "1.0",
    "catalog_id": "demo.motor_power",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Motor Supply",
      "sku": null,
      "category": "power_supply"
    },
    "physical": {
      "dimensions_mm": {
        "x": 58,
        "y": 24,
        "z": 60
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "polymer"
    },
    "mounts": [
      {
        "mount_id": "base",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [
      {
        "port_id": "motor_v",
        "signal": "power_output",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      },
      {
        "port_id": "ground",
        "signal": "ground",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      }
    ],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  },
  {
    "schema_version": "1.0",
    "catalog_id": "demo.controller_power",
    "identity": {
      "manufacturer": "SYNTHETIC DEMO ONLY",
      "model": "Controller Supply",
      "sku": null,
      "category": "power_supply"
    },
    "physical": {
      "dimensions_mm": {
        "x": 45,
        "y": 14,
        "z": 40
      },
      "mass_g": null,
      "bounds_verified": false,
      "geometry_kind": "procedural",
      "asset_path": null,
      "material_preset": "polymer"
    },
    "mounts": [
      {
        "mount_id": "base",
        "kind": "template_bracket",
        "position_mm": [
          0,
          0,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ],
        "allowed_mates": [
          "template_bracket",
          "electronics_deck"
        ]
      }
    ],
    "ports": [
      {
        "port_id": "v_5",
        "signal": "power_output",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      },
      {
        "port_id": "ground",
        "signal": "ground",
        "voltage_min_v": null,
        "voltage_max_v": null,
        "current_limit_a": null,
        "logic_level_v": null,
        "notes": "SYNTHETIC DEMO PORT: no electrical rating claimed"
      }
    ],
    "sourcing": {
      "manufacturer_reference_url": null,
      "datasheet_url": null,
      "purchase_url": null,
      "purchase_url_verified_at": null,
      "price_amount": null,
      "price_currency": null,
      "price_checked_at": null,
      "availability_status": "unknown"
    },
    "evidence": {
      "dimensions": "synthetic_approximation",
      "electrical": "unverified",
      "price": "unknown",
      "notes": [
        "For agent/frontend bootstrapping only; replace with verified specific product metadata before real BOM demo."
      ]
    }
  }
]
```

### A.2 `fixtures/plans/rover_obstacle_v1.json`

```json
{
  "schema_version": "1.0",
  "build_id": "rivet-synthetic-rover-fixture",
  "revision": 1,
  "project_family": "rover",
  "title": "Synthetic starter rover (NOT SOURCED)",
  "source_intent_id": "intent-rover-001",
  "created_at": "2026-10-24T00:00:00Z",
  "status": "needs_review",
  "components": [
    {
      "instance_id": "chassis-1",
      "catalog_id": "demo.chassis_2wd",
      "role": "chassis",
      "parent_instance_id": null,
      "attached_to_mount_id": null,
      "own_mount_id": null,
      "pose": {
        "position_mm": [
          0,
          10,
          0
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#343942"
      }
    },
    {
      "instance_id": "motor-left-1",
      "catalog_id": "demo.tt_motor",
      "role": "motor",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "motor_left",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          -56,
          20,
          25
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#A6A9AE"
      }
    },
    {
      "instance_id": "motor-right-1",
      "catalog_id": "demo.tt_motor",
      "role": "motor",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "motor_right",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          56,
          20,
          25
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#A6A9AE"
      }
    },
    {
      "instance_id": "wheel-left-1",
      "catalog_id": "demo.wheel",
      "role": "wheel",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "wheel_left",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          -78,
          20,
          25
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#26292B"
      }
    },
    {
      "instance_id": "wheel-right-1",
      "catalog_id": "demo.wheel",
      "role": "wheel",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "wheel_right",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          78,
          20,
          25
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#26292B"
      }
    },
    {
      "instance_id": "caster-1",
      "catalog_id": "demo.caster",
      "role": "caster",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "caster_rear",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          0,
          2,
          -62
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#C1C8CC"
      }
    },
    {
      "instance_id": "controller-1",
      "catalog_id": "demo.esp32",
      "role": "controller",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "controller_deck",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          -25,
          29,
          -15
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#1C5746"
      }
    },
    {
      "instance_id": "driver-1",
      "catalog_id": "demo.tb6612",
      "role": "motor_driver",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "driver_deck",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          28,
          29,
          -10
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#1C5746"
      }
    },
    {
      "instance_id": "sensor-1",
      "catalog_id": "demo.range",
      "role": "distance_sensor",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "front_sensor",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          0,
          35,
          81
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#1C5746"
      }
    },
    {
      "instance_id": "power-motor-1",
      "catalog_id": "demo.motor_power",
      "role": "power_supply",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "power_deck",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          0,
          27,
          -46
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#4B5563"
      }
    },
    {
      "instance_id": "power-control-1",
      "catalog_id": "demo.controller_power",
      "role": "power_supply",
      "parent_instance_id": "chassis-1",
      "attached_to_mount_id": "power_usb",
      "own_mount_id": "base",
      "pose": {
        "position_mm": [
          0,
          42,
          -35
        ],
        "rotation_deg": [
          0,
          0,
          0
        ]
      },
      "render_overrides": {
        "color": "#4B5563"
      }
    }
  ],
  "connections": [
    {
      "connection_id": "wire-motor-pwm-synthetic",
      "kind": "electrical",
      "from": {
        "instance_id": "controller-1",
        "port_id": "gpio18"
      },
      "to": {
        "instance_id": "driver-1",
        "port_id": "pwm_a"
      },
      "net_name": "DEMO_PWM_NOT_VERIFIED",
      "notes": "Synthetic display-only sample; not an actual verified full driver netlist"
    },
    {
      "connection_id": "wire-sensor-i2c-synthetic",
      "kind": "electrical",
      "from": {
        "instance_id": "controller-1",
        "port_id": "sda"
      },
      "to": {
        "instance_id": "sensor-1",
        "port_id": "sda"
      },
      "net_name": "DEMO_SDA_NOT_VERIFIED",
      "notes": "Synthetic display-only sample; not a verified electrical wiring guide"
    }
  ],
  "verification": {
    "overall": "needs_review",
    "findings": [
      {
        "rule_id": "fixture.synthetic_not_sourced",
        "result": "UNKNOWN",
        "severity": "blocking",
        "affected_instance_ids": [
          "chassis-1",
          "motor-left-1",
          "motor-right-1",
          "wheel-left-1",
          "wheel-right-1",
          "caster-1",
          "controller-1",
          "driver-1",
          "sensor-1",
          "power-motor-1",
          "power-control-1"
        ],
        "message": "All component identities and geometry in this fixture are synthetic; do not treat it as buildable or purchasable",
        "evidence_urls": []
      },
      {
        "rule_id": "electrical.complete_power_netlist",
        "result": "UNKNOWN",
        "severity": "blocking",
        "affected_instance_ids": [
          "driver-1",
          "power-motor-1",
          "controller-1"
        ],
        "message": "Complete rated wiring and motor-current validation are not provided by this frontend scaffold",
        "evidence_urls": []
      }
    ]
  },
  "assembly_steps": [
    {
      "step": 1,
      "title": "Mount the chassis",
      "instance_ids": [
        "chassis-1"
      ],
      "instructions": "Mount the chassis; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 2,
      "title": "Attach the motors",
      "instance_ids": [
        "motor-left-1",
        "motor-right-1"
      ],
      "instructions": "Attach the motors; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 3,
      "title": "Install the wheels and caster",
      "instance_ids": [
        "wheel-left-1",
        "wheel-right-1",
        "caster-1"
      ],
      "instructions": "Install the wheels and caster; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 4,
      "title": "Place controller and driver",
      "instance_ids": [
        "controller-1",
        "driver-1"
      ],
      "instructions": "Place controller and driver; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 5,
      "title": "Mount the sensor",
      "instance_ids": [
        "sensor-1"
      ],
      "instructions": "Mount the sensor; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 6,
      "title": "Position the power supplies",
      "instance_ids": [
        "power-motor-1",
        "power-control-1"
      ],
      "instructions": "Position the power supplies; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 7,
      "title": "Inspect wiring",
      "instance_ids": [
        "controller-1",
        "driver-1",
        "sensor-1"
      ],
      "instructions": "Inspect wiring; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    },
    {
      "step": 8,
      "title": "Review assembly",
      "instance_ids": [
        "chassis-1",
        "controller-1"
      ],
      "instructions": "Review assembly; synthetic visual step only",
      "safety_notes": [
        "Do not wire a physical device using this synthetic fixture."
      ]
    }
  ],
  "bom": {
    "currency": "USD",
    "known_subtotal_amount": null,
    "total_status": "not_available",
    "items": [
      {
        "catalog_id": "demo.caster",
        "quantity": 1,
        "instance_ids": [
          "caster-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      },
      {
        "catalog_id": "demo.chassis_2wd",
        "quantity": 1,
        "instance_ids": [
          "chassis-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      },
      {
        "catalog_id": "demo.controller_power",
        "quantity": 1,
        "instance_ids": [
          "power-control-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      },
      {
        "catalog_id": "demo.esp32",
        "quantity": 1,
        "instance_ids": [
          "controller-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      },
      {
        "catalog_id": "demo.motor_power",
        "quantity": 1,
        "instance_ids": [
          "power-motor-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      },
      {
        "catalog_id": "demo.range",
        "quantity": 1,
        "instance_ids": [
          "sensor-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      },
      {
        "catalog_id": "demo.tb6612",
        "quantity": 1,
        "instance_ids": [
          "driver-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      },
      {
        "catalog_id": "demo.tt_motor",
        "quantity": 2,
        "instance_ids": [
          "motor-left-1",
          "motor-right-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      },
      {
        "catalog_id": "demo.wheel",
        "quantity": 2,
        "instance_ids": [
          "wheel-left-1",
          "wheel-right-1"
        ],
        "unit_price_amount": null,
        "purchase_url": null,
        "link_status": "not_available"
      }
    ]
  },
  "behavior": {
    "profile_id": "rover.obstacle_avoidance.v1",
    "controller_catalog_id": "demo.esp32",
    "parameters": {
      "obstacle_stop_distance_m": 0.25,
      "turn_duration_ms": 600,
      "forward_speed_fraction": 0.45
    }
  },
  "simulation": {
    "kind": "differential_drive_2d",
    "enabled": true,
    "wheel_radius_m": 0.0325,
    "wheel_base_m": 0.156,
    "max_wheel_speed_mps": 0.2,
    "sensor_range_m": 1.0,
    "sensor_fov_deg": 20,
    "limitations": [
      "Synthetic illustrative dimensions",
      "Simplified kinematics only",
      "No physical feasibility verified"
    ]
  },
  "firmware": {
    "target": "esp32_arduino_platformio",
    "profile_id": "rover.obstacle_avoidance.v1",
    "pin_map": {},
    "compile_status": "not_supported"
  },
  "provenance": {
    "input_mode": "image_and_text",
    "catalog_version": "SYNTHETIC-BOOTSTRAP",
    "generation_mode": "fixture",
    "notes": [
      "Replace every demo.* item and source before presenting real buildability, wiring, purchasing or firmware"
    ]
  }
}
```

### A.3 Fixture upgrade procedure

1. B replaces `demo.*` with exact known purchased/product SKUs and documented electrical/mount/geometry facts, creating a **new catalog version**. B must not silently redefine `demo.*` as production-grade without provenance.
2. B emits a matching fresh BuildPlan where each instance, connection, BOM item and assembly step refers to new catalog IDs. Ensure real motor driver/controller/power netlist is complete.
3. B runs full validators; mandatory missing ratings remain UNKNOWN and visible.
4. A uses the new plan as a sourced saved example and enables firmware export only for a genuinely supported profile.
5. C's 3D viewer requires no component-specific code rewrites beyond asset/procedural component render recipes.
6. CI asserts all connection endpoints, step references and BOM instance counts are internally consistent before the fixture is displayed.

**Appendix contract check:** The synthetic appendix was mechanically checked for unique instance IDs, catalog references, connection endpoint/port references, chassis mount references, assembly-step references, and BOM quantity totals. Its **physical/electrical feasibility is explicitly unverified**.
