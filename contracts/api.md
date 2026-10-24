# Rivet REST API contract (v1)

**FROZEN v1.** Source: `docs/implementation.md` §3.5. Changes need all three developers (§5) and a reviewed PR; record them in `docs/context.md` §5.
A implements this in `services/api`; B and C code against it. Domain bodies are defined by the JSON schemas in this folder:

| Schema | Wire object |
|---|---|
| [`intent.schema.json`](intent.schema.json) | `IntentSpec` (§3.1) |
| [`component.schema.json`](component.schema.json) | `CatalogComponent` (§3.2) |
| [`build-plan.schema.json`](build-plan.schema.json) | `BuildPlan` (§3.3, §3.4, §3.6) |
| [`errors.schema.json`](errors.schema.json) | error envelope (§3.5) |

Validate fixtures or any JSON file with `uv run scripts/validate_contracts.py` (see [Validation](#validation)).

## Conventions

- Base URL `http://localhost:8000`. All paths start with `/api`. JSON bodies are UTF-8, `snake_case`, no camelCase aliases.
- Every domain object carries `schema_version: "1.0"`.
- Money is a decimal **string** (`"12.50"`) with an ISO 4217 currency; unknown is `null`, never `0`.
- Timestamps are ISO-8601 UTC ending in `Z`. Catalog `price_checked_at` / `purchase_url_verified_at` may be a plain date (`YYYY-MM-DD`).
- Lengths in mm, masses in g, angles in degrees (XYZ Euler), right-handed `x` right, `y` up, `z` forward. The simulator converts to metres and radians.
- Unknown source data is `null` / `UNKNOWN`, never a guess.

## Endpoints

| Method | Path | Request | Success response |
|---|---|---|---|
| GET | `/api/health` | none | `200 { "ok": true, "mode": "fixture" \| "live" }` |
| GET | `/api/catalog` | optional `?category=<identity.category>` | `200 { "schema_version": "1.0", "synthetic": bool, "synthetic_catalog_ids": [id], "components": [CatalogComponent] }` |
| GET | `/api/projects/examples` | none | `200 { "examples": [{ "example_id", "title", "project_family", "status", "generation_mode" }] }` |
| POST | `/api/assets/images` | multipart `file` (image) | `200 { "asset_id", "mime_type", "size_bytes", "preview_url" }`. `preview_url` is server-controlled; clients never send paths |
| GET | `/api/assets/{asset_id}/preview` | none | image bytes |
| POST | `/api/projects/generate` | `{ "input": { "kind", "image_asset_id", "user_text" }, "requirements"? }` | `202 { "job_id", "status": "queued" \| "running" \| "complete" \| "failed", "build_id": null }` |
| GET | `/api/jobs/{job_id}` | none | `200 { "job_id", "status", "stage", "progress", "error"?, "build_id"?, "revision"? }` |
| GET | `/api/jobs/{job_id}/events` | optional `Last-Event-ID` header | `200 text/event-stream` of [job events](#job-events) |
| GET | `/api/projects/{build_id}` | optional `?revision=<int ≥ 1>` (default latest) | `200 BuildPlan` |
| GET | `/api/projects/{build_id}/revisions` | none | `200 { "build_id", "revisions": [{ "revision", "created_at", "status", "title" }] }` |
| POST | `/api/projects/{build_id}/edits` | `{ "base_revision": int ≥ 1, "instruction"?, "operation"? }` | `200 { "accepted": true, "build_id", "revision" }` or `200 { "accepted": false, "build_id", "finding" }` |
| GET | `/api/projects/{build_id}/exports/bom.csv` | optional `?revision=` | `200 text/csv`; unknown prices stay empty/unknown, never `0`. `422 EXPORT_REFUSED_SYNTHETIC` for a plan built from synthetic parts |
| GET | `/api/projects/{build_id}/exports/build.json` | optional `?revision=` | `200` `BuildPlan` as a download |
| GET | `/api/projects/{build_id}/exports/firmware.zip` | optional `?revision=`, `?compile=true` | `200 application/zip`: PlatformIO project plus manifest tied to `build_id` and `revision`. `422 FIRMWARE_REFUSED` for a plan built from synthetic parts |

Request details:

- `generate.input.kind` is `image | text | image_and_text`. `image` and `image_and_text` require an uploaded `image_asset_id`; `text` requires non-blank `user_text` and no image.
- `generate.requirements` holds only what the user stated (`max_budget` decimal string or `null`, `currency`, `max_length_mm`, `max_width_mm`, `preferred_color`). The server never fills it from model output.
- Job `progress` is a server-measured fraction `0..1` or `null`. Clients must not invent percentages.
- Edits never mutate a revision. Accepted edits create `revision = base_revision + 1` with the same `build_id`. A rejected edit returns the blocking `finding` (BuildPlan finding shape) and keeps the previous revision current.
- `GET /api/projects/{build_id}` may add an optional, response-only `provenance.sourcing` object (`synthetic`, `synthetic_catalog_ids`, `unverified_link_count`, `sku_missing_count`), computed from the catalog on read. Stored revisions, `build.json` exports and engine output never carry it. Clients should read `sourcing.synthetic` instead of searching notes for "SYNTHETIC".
- Every export response carries `X-Rivet-Generation-Mode` and `X-Rivet-Synthetic: true|false`. A `verified_product` BOM row needs a catalog SKU and a verified https purchase link equal to the row's URL; a `live` plan with synthetic parts is refused with `502 SYNTHETIC_PARTS_IN_LIVE_PLAN`.
- Every plan the API returns has passed schema and referential checks. Source mode is reported honestly in `provenance.generation_mode` (`live | fixture | fallback | manual_template`); a fallback is never presented as live output.

## Errors

Every non-2xx JSON response matches [`errors.schema.json`](errors.schema.json):

```json
{
  "error": {
    "code": "UNSUPPORTED_PROJECT_FAMILY",
    "message": "Flight-ready drone generation is not supported in this version",
    "details": { "supported_families": ["rover"] },
    "retryable": false
  }
}
```

`details` is always an object (empty when there is nothing to add). `retryable: true` means the same request may succeed later without changes.

| Status | Meaning |
|---|---|
| 400 | Malformed or invalid request |
| 404 | Missing build, revision, job or asset |
| 409 | Stale `base_revision` or conflicting write |
| 413 | Upload too large |
| 422 | Well-formed but semantically unsupported (unsupported family, edit or firmware profile) |
| 429 | Provider or local quota exceeded |
| 500 | Unexpected server error |
| 502 / 503 | Upstream (vision provider, engine) failed or is unavailable |

Codes in use in v1. Clients must treat unlisted codes by their HTTP status; new codes may be added without a contract change, existing ones must not be renamed.

| Code | Status | Retryable |
|---|---|---|
| `BAD_REQUEST`, `BAD_BUILD_ID`, `INVALID_IMAGE`, `INVALID_SYMBOL`, `PATH_NOT_ALLOWED` | 400 | no |
| `PROJECT_NOT_FOUND`, `REVISION_NOT_FOUND`, `JOB_NOT_FOUND`, `ASSET_NOT_FOUND` | 404 | no |
| `STALE_REVISION`, `PROJECT_EXISTS` | 409 | no |
| `FILE_TOO_LARGE` | 413 | no |
| `UNSUPPORTED_PROJECT_FAMILY`, `UNSUPPORTED_EDIT`, `FIRMWARE_NOT_SUPPORTED`, `FIRMWARE_REFUSED`, `FIRMWARE_INVALID_PIN_MAP`, `FIRMWARE_INVALID_PARAMETER`, `EXPORT_REFUSED_SYNTHETIC` | 422 | no |
| `PROVIDER_QUOTA` | 429 | yes |
| `QUOTA_EXCEEDED` | 429 | no |
| `INTERNAL` | 500 | no |
| `VISION_PARSE_FAILED` | 502 | yes |
| `PROVIDER_AUTH`, `PROVIDER_ERROR`, `ENGINE_ERROR`, `ENGINE_CONTRACT_VIOLATION`, `SYNTHETIC_PARTS_IN_LIVE_PLAN` | 502 | no |
| `PROVIDER_UNAVAILABLE` | 503 | yes |
| `ENGINE_UNAVAILABLE` | 503 | no |

## Job events

`GET /api/jobs/{job_id}/events` streams Server-Sent Events. Each event is `id: <event_id>` plus one `data:` line holding this JSON object; `: keepalive` comments may appear between events.

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

| Field | Values |
|---|---|
| `stage` | `upload`, `understand`, `catalog_selection`, `assembly`, `validate`, `repair`, `render_ready`, `firmware`, `complete`, `failed` |
| `actor` | `vision`, `planner`, `engineer`, `validator`, `repair`, `firmware`, `system` |
| `status` | `running`, `ok`, `warning`, `failed` |

Semantics:

- `event_id` increases monotonically per job, starting at 1.
- Events describe the **actual** stage progression; never replay a pre-written success story.
- The stream ends after the terminal `complete` or `failed` event, or when a server time limit is reached. On reconnect, send the `Last-Event-ID` header (or `?last_event_id=`) to receive only later events; history is kept server-side for the job's lifetime.
- Clients that cannot use SSE poll `GET /api/jobs/{job_id}`.

## Status semantics

- `BuildPlan.status` and `verification.overall` are always equal: `verified`, `verified_with_warnings`, `needs_review`, `unbuildable`.
- `verified` only when every implemented mandatory rule passes and no blocking `FAIL` / `UNKNOWN` remains. It is not a real-world safety certification.
- A hard budget cannot pass while any required item is unpriced.
- `firmware.compile_status` is `passed` / `failed` only when a compile actually ran; otherwise `not_checked` or `not_supported`.

## Validation

`scripts/validate_contracts.py` (needs `jsonschema`, declared inline so `uv run` installs it) checks:

1. **Schema:** each file against the matching schema in this folder.
2. **Referential rules (§3.4)** that JSON Schema cannot express: unique `instance_id` / `connection_id`; `status == verification.overall`; parents, connection endpoints, finding/step/BOM `instance_ids` resolve; with a catalog, every `catalog_id`, mount and electrical port exists on the right `CatalogComponent`; BOM rows match instance catalog IDs, `quantity` equals referenced instances, every component is in exactly one row; `behavior.controller_catalog_id` is a plan component; no GPIO is allocated twice in `firmware.pin_map`.
3. **Rejections:** the §3.3 shape-only plan, a plan wired to a missing `driver-1` and other known-bad mutations must fail.

```bash
uv run scripts/validate_contracts.py                                   # all known fixtures + rejection checks
uv run scripts/validate_contracts.py --plan p.json --catalog c.json    # one plan against a catalog
uv run scripts/validate_contracts.py --intent i.json --component c.json --error e.json
```

Exit code `0` means every check passed. Not machine-checked: that each `pin_map` signal maps to a specific controller port, since signal names are profile-specific (B's wiring profiles own that rule).

Examples: [`examples/error-unsupported-project-family.json`](examples/error-unsupported-project-family.json) (valid) and [`examples/invalid/section-3.3-shape-only-plan.json`](examples/invalid/section-3.3-shape-only-plan.json) (must be rejected).
