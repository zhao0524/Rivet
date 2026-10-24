# Plan: From an image to a verified SKU and a traced parts list

Status: proposed 2026-10-24. Epic: #72. Owners: lanes A (API), B (engine), C (web), INT (acceptance).

## 1. Goal

A user uploads a photo of a product (a drone, for example). Rivet works out what it is, finds the real
SKU, and traces every part that makes it up, down to materials where they are published. Every claim is backed by a
source the user can open. When the product or a part cannot be found, Rivet says so in plain words and shows
what comparable products typically use. It never fills a gap with a guess presented as fact.

This layer must be strict. A wrong "verified" is worse than a clear "not found".

## 2. What is wrong today

Captured with Playwright against `main` @ `d961d9d` (UI simplification 1 to 3 merged), API in fixture mode with the OpenAI vision provider:

| # | Finding | Evidence |
|---|---------|----------|
| 1 | Uploading an image opens a **Synthetic starter rover (NOT SOURCED)** whatever the image shows. The image is not used to identify anything. | Upload `reference-rover-top.png`: result is the fixed demo plan, parts `chassis-1`, `motor-left-1`, and so on. |
| 2 | **No product identification.** The vision step only maps the picture to a rover intent. There is no "what product is this" and no SKU. | `services/api/rivet_api/adapters/vision.py`, `docs/e2e-review-2026-10-24.md` |
| 3 | **No automatic SKU or link verification.** Catalog URLs and prices are typed in by hand. Nothing fetches a page to confirm a SKU exists. | #68 |
| 4 | **Only one product family exists** (indoor rover). Drones and arms are "Coming later". Anything else is mapped to a rover or rejected. | landing page, `packages/engineering` |
| 5 | **No decomposition.** There is no way to say what an arbitrary product is made of, or to cite materials. | none |
| 6 | **No fallback story.** An unknown product gets a generic error, not "this SKU is not in our sources, here is what similar products use". | none |
| 7 | Cost shows "Unknown, 9 of 9 parts have no price yet" on the fixture plan, which is honest but is the only state the user ever sees on a fresh run. | `04-result.png` |

What works and stays: the API real-SKU guard (#45), `link_status`, the "AI proposes, deterministic code validates" rule, the 3D viewer (the blank-canvas bug #70 no longer reproduces on `main`).

## 3. Design principles (the strict layer)

1. **AI proposes, deterministic code verifies.** Models may read the image and extract fields from pages. Only code decides what counts as verified.
2. **No evidence, no claim.** Every SKU, URL, price, material and part relationship carries an evidence record. A claim without one is dropped, not softened.
3. **Three honest outcomes, never a silent fourth.** Verified, inferred (labelled), or not found. "Typical for this category" is a fourth, separate label and is never shown as the user's product.
4. **Fail closed.** If the fetch fails, the page does not contain the SKU, or two sources disagree, the part is `not_found` or `conflict`. It is never rounded up.
5. **Reproducible.** Each resolution stores the sources fetched, the time, and a content hash. The same inputs and cache state give the same answer.
6. **Polite scraping.** Prefer official APIs and structured data (JSON-LD, GTIN, datasheets). Respect robots.txt and terms, rate limit, identify the client, cache with a TTL.

## 4. User-facing outcomes

For a resolved product the user sees exactly one of:

| Outcome | Meaning | What the UI says |
|---------|---------|------------------|
| `exact_match` | Product SKU found at a trusted source, and every part either verified or explicitly marked unavailable. | "We found this product: DJI Mini 4 (SKU …). Here are its parts, each with its source." |
| `partial_match` | Product found, some parts could not be confirmed. | "We found the product but could not confirm 3 of 14 parts. Here is what we do know, and what similar products use for the rest." |
| `no_match_with_alternatives` | No SKU found. | "We could not find this exact product. These products are the closest we can verify, and this is what most competitors use for each part." |
| `unsupported` | Not a product Rivet can reason about (a person, a landscape, a drawing). | A plain explanation and what to upload instead. |

Each part is labelled `verified`, `inferred` (teardown or community source, shown with the link) or `not_found`. Typical-for-category suggestions are shown in a separate section titled "What similar products use".

## 5. Pipeline

```
image
  1. Understand      vision model → candidate product: brand, model guess, category, visible features (+ confidence)   [A]
  2. Identify        search + distributor/manufacturer lookup → candidate SKUs with GTIN/MPN                          [B]
  3. Verify product  deterministic: page at an allowlisted host contains the SKU/MPN string, title agrees on brand     [B]
  4. Decompose       fetch official BOM, spec sheet, manual, exploded view or teardown → part list with evidence       [B]
  5. Verify parts    each part: SKU/MPN, purchase link, price, stock, material when published; same checks as step 3   [B]
  6. Fall back       for gaps: nearest verified products + category reference architecture, labelled as typical       [B]
  7. Assemble        existing engine: assembly order, wiring, 3D where a model exists                                  [B, C]
  8. Present         outcome + per-part evidence + alternatives                                                       [C]
```

Step 1 and the orchestration (jobs, polling, storage, gates) are lane A. The resolver and verification code is a pure-Python package in lane B so it can be tested without the network, with recorded pages as fixtures.

### 5.1 Evidence record (the contract everything hangs on)

```json
{
  "claim": "sku",
  "value": "DJI-MINI4-FMC",
  "source_url": "https://…",
  "source_host_tier": "manufacturer | distributor | teardown | community",
  "fetched_at": "2026-10-24T18:00:00Z",
  "content_sha256": "…",
  "extractor": "jsonld | datasheet | llm-extract",
  "matched_text": "SKU: DJI-MINI4-FMC",
  "ttl_days": 14
}
```

Rules enforced in code: `verified` needs a `manufacturer` or `distributor` host and `matched_text` that contains the value; `llm-extract` alone can never produce `verified`; evidence older than its TTL downgrades the claim to `stale`.

### 5.2 Source tiers

| Tier | Examples | Can produce `verified` |
|------|----------|------------------------|
| manufacturer | official product, spec, manual and datasheet pages | yes |
| distributor | Digi-Key, Mouser, SparkFun, Adafruit APIs and pages | yes |
| teardown | iFixit, open-source BOM and firmware repositories | no, `inferred` only |
| community / web search | forums, reviews, search snippets | no, used to find candidates only |

The host allowlist lives in the repo and is changed by PR, not by the model.

### 5.3 Fallback: industry-standard parts

When a part or product is missing, Rivet suggests from a **reference architecture per category** (for a drone: flight controller, ESCs, motors, props, battery, frame, camera, radio, GPS). Each reference entry is itself sourced (real SKUs, with evidence), and the "most likely options" are chosen by deterministic rules (same category and compatible spec ranges, ranked by how many verified products use them). The UI states why: "3 of 4 comparable drones use a brushless motor in this size range."

## 6. Strictness gates (acceptance)

- A fabricated SKU (not on any allowlisted page) is never marked `verified`. Test with injected fake SKUs.
- A page that returns 200 but does not contain the SKU is `not_found`.
- A model hallucinating a part cannot reach the stored plan (the extractor output is re-checked against the fetched text).
- Two sources disagree on a price, SKU or material: `conflict`, shown to the user, never averaged.
- Offline or blocked fetch: the whole resolution says so. It does not fall back to fixtures without the "saved example" banner.
- No outcome copy implies certainty the evidence does not support. Copy is reviewed against the table in section 4.
- Golden set of at least 10 products, including 3 that do not exist and 3 with partial coverage, runs in CI against recorded pages.

## 7. Work breakdown (issues)

| Lane | Issue | Scope |
|------|-------|-------|
| B | Evidence schema and verification core | `rivet_engine.sourcing`: Evidence, tiers, allowlist, verifier, TTL, conflict rules, pure and fixture-tested |
| B | Source adapters | Distributor and manufacturer adapters, JSON-LD and datasheet extraction, robots and rate limiting, response cache, recorded fixtures |
| B | Product decomposition | Official BOM, manual and teardown ingestion into parts with materials; category reference architectures; fallback ranking |
| A | Product resolution endpoint and jobs | `POST /api/resolve` (image or text), job polling, evidence ledger storage, outcome gates, typed errors, live-mode rules |
| A | Vision: identify the product | Structured product guess (brand, model, category, features, confidence) with a strict schema, replacing "map to a rover" |
| C | Result UI | Four outcomes in plain language, per-part evidence popover, alternatives section, honest empty states; fits the simplified studio |
| INT | Golden set and acceptance | Recorded pages, adversarial cases, CI job, end-to-end Playwright script from this plan |

The pre-existing issues #62 (vision provider), #66 (what the model understood), #67 (image affects build), #68 (link verification), #69 (parts and assembly) and #71 (acceptance) feed into this and are linked from the new issues rather than duplicated.

## 8. Order and dependencies

1. B: evidence schema (everything depends on it). A and C start against a fixture response with the same shape in parallel.
2. B: adapters and decomposition. A: resolution endpoint. A: product identification.
3. C: result UI against the live endpoint.
4. INT: golden set once adapters have fixtures, then the full end-to-end run.

## 9. Open questions

- Which distributor APIs do we have keys for? Only keyed APIs go in the first release; pages are fetched without keys.
- Search provider for step 2 (a search API key is needed for web-search-assisted identification).
- Materials: published for some parts (datasheets), rarely for finished products. The plan shows materials only where a source states them.
- Legal review of scraping each host before the allowlist grows.
