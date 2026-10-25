# Plan: Showcase catalogue and the resolution-to-offers bridge

Status: proposed 2026-10-24, follows `plan.md`. Owners: lanes A (API), B (engine), C (web), INT.

## 1. Why

`plan.md` delivered offer discovery for a known SKU and it works live (Brave + page verification).
What does not work is the step before it: turning a product into its parts. Today that only
succeeds for an Adafruit/SparkFun item whose numeric SKU is handed to the resolver, and the
offers layer is wired to catalog parts, not to resolved parts. Two tasks close this:

- **Task 1, showcase catalogue.** ~50 real, buildable products (robots, rovers, wearables, IoT
  gadgets, audio and display builds) whose maker publishes a parts list where every part links
  to a vendor SKU page. We collect the data ahead of time with the polite fetcher, store it as
  fixtures, serve it over GET endpoints, and show it as a gallery on the landing page. A user
  who has no image picks a product, sees its parts with evidence, and gets live offers per part.
- **Task 2, the bridge.** Give the resolver web search (reusing the Brave provider) so a vision
  guess can reach a product page, and connect every resolved part to the offers endpoint.

Repo rule #2 still holds: no invented prices, stock or SKUs. A showcase part exists only
because a fetched page names it and a fetched vendor page quotes its SKU.

## 2. Where the products come from (probed 2026-10-24)

| Source | Parts linked to SKU pages? | Notes |
|---|---|---|
| Adafruit Learn guides (`learn.adafruit.com/<guide>`) | Yes: product cards link `adafruit.com/product/<n>` | Thousands of finished builds with an image; the richest source. Guide content is CC BY-SA (attribute). |
| SparkFun tutorials (`learn.sparkfun.com/tutorials/<slug>`) | Yes: links to `sparkfun.com/products/<n>` | CC BY-SA 4.0. |
| SparkFun kit product pages | Yes (Inventor's Kit 23/23) | Kits, not products; use only when the kit *is* the product (e.g. a robot kit). |
| Pololu product pages (Romi, Zumo, 3pi+) | Links present (24 `/product/` links on Romi) but mixed with "related"; needs a parser | Pololu images are copyrighted: store the URL and credit, do not commit the binary. |
| Open-source robots with a BOM page (JetBot, DonkeyCar, Otto DIY, OpenCat, TurtleBot) | Partly: some parts link to Amazon/AliExpress only | Keep when the majority of parts link to allowlisted vendors; unlinked parts are listed as unsourced. |
| Adafruit kit product pages | No (plain-text parts list) | Not usable for automatic verification. |

Selection rule: a product enters the catalogue only if its source page names at least four
parts and **every linked part verifies** (vendor page fetched, SKU quoted, price/stock read from
the page or `null`). Parts named without a link stay visible under "not sourced"; a product
with more unsourced than sourced parts is rejected. Duplicates of the same guide (overview vs
parts page) count once.

## 3. Design

### 3.1 Contract (`contracts/showcase-product.schema.json`, INT)

`ShowcaseProduct`: `product_id` (slug), `name`, `category` (`rover | robot | drone | wearable |
iot | audio | display | tool | other`), `summary`, `image { url, credit, license }`, `source {
url, host_tier, title, fetched_at, content_sha256 }`, `parts[]` with `part_id`, `name`,
`quantity`, `sku`, `mpn`, `manufacturer`, `vendor` (same shape as `offer.schema.json`), `url`,
`price_amount`, `currency`, `availability`, `fetched_at`, `source_sha256`, `evidence_level`,
`evidence_quote` (SKU quote from the part page), `bom_quote` (text from the source page naming
the part); `unsourced_parts[] { name, quantity, note }`; `totals { parts_total, parts_verified,
price_total_amount | null, currency }`; `status` (`complete | partial`); `generated_at`;
`synthetic: false` always (no synthetic showcase products). A `ShowcaseIndex` lists
`{ product_id, name, category, image, parts_total, parts_verified, status }` for the gallery.

### 3.2 Data (`fixtures/showcase/`, INT, produced by the engine)

- `manifest.json`: the human-curated candidate list (`product_id`, `name`, `category`,
  `source_url`, optional `image_url` override, `notes`). The research step writes this.
- `products/<product_id>.json`: one `ShowcaseProduct` per accepted product.
- `index.json`: the `ShowcaseIndex`.
- `recorded/`: every fetched page (source pages and part pages) with an `index.json` in the
  `tests/support/recorded` format, so ingestion and tests replay offline.
- `offers/<normalized_key>.json`: pre-collected `OfferSet` per unique part from **direct
  vendors only** (the part's own vendor page plus Adafruit/SparkFun/Pololu/Digi-Key URL
  adapters; no Brave). Brave discovery runs on demand when a user opens a part and the API
  provider is `live`; the pre-collected set is the cache seed.
- `rejected.json`: candidates that failed the gate, with the reason, so the curation is auditable.

### 3.3 Engine (`rivet_engine/showcase/`, lane B)

- `sources.py`: parts-list extractors per host: Adafruit Learn (product cards), SparkFun
  tutorials and kit pages (reuse `included_items`), Pololu product pages (the "what's included"
  block only), generic BOM pages (table/list rows that link to allowlisted vendor product URLs).
  Each returns `(name, quantity, link, bom_quote)`; everything else is unsourced.
- `ingest.py`: `ingest(manifest_entry, fetcher, now) -> ShowcaseProduct | Rejection`: fetch the
  source page, extract parts, fetch each linked part page, read SKU/price/stock/rating with
  `ecommerce.extract_offer`, verify with `ecommerce.verify_offer.decide`, apply the gate.
- `pololu` adapter in `sourcing/adapters.py` (`pololu.com/product/<n>`), and `pololu.com` in
  the ecommerce vendor registry if missing.
- `python -m rivet_engine.showcase build --manifest fixtures/showcase/manifest.json --out
  fixtures/showcase [--record] [--offers]`: live run writes products, index, recorded pages,
  rejected list and (with `--offers`) the direct-vendor offer sets. `--replay` rebuilds from
  `recorded/` offline and must reproduce the committed JSON byte for byte (CI check).
- Tests: extractors on recorded pages; gate rejects a product with an unverifiable part; replay
  equals committed fixtures; every product validates against the schema.

### 3.4 API (lane A)

- `GET /api/showcase/products` → `ShowcaseIndex` (optional `?category=`).
- `GET /api/showcase/products/{product_id}` → `ShowcaseProduct`; `404 SHOWCASE_NOT_FOUND`.
- `GET /api/showcase/products/{product_id}/parts/{part_id}/offers` with the offers sort/filter
  params → `OfferSet`: the pre-collected set when present (served as `provider_mode:
  "recorded"`), merged with live discovery when `RIVET_OFFERS_PROVIDER=live` (202 job as in
  `api.md`). Never 422: showcase parts are real.
- Runtime mirror of `fixtures/showcase/{index,products,offers}` with a drift test, like
  `data/fixtures/offers`.
- **Bridge (Task 2):** `EngineResolver.resolve` gains a search step: when `lookup_all` finds
  nothing for the identifiers, query the engine's `BraveSearchProvider` with `"{brand} {name}"`
  (and `model_guess`), fetch candidates through the SSRF-guarded polite fetcher, and accept a
  product page only when `verify_product` confirms the SKU and brand on it. The chosen page
  then goes through `decompose` as before. Resolution parts carry `sku`, `manufacturer` and
  `purchase_url`, so the existing `POST /api/offers/search` serves offers for them; a
  convenience `GET /api/resolutions/{id}/parts/{part_id}/offers` wraps it.

### 3.5 Web (lane C)

- Landing page gains a "Pick a product" gallery (image, name, category, "N parts, all
  sourced"), filterable by category, as the no-image entry point. Selecting one opens
  `/studio?showcase=<product_id>`.
- Showcase view: product image with credit and license, summary, source link, parts table
  (name, quantity, vendor, price as of date, availability, evidence popover with both quotes),
  unsourced parts listed honestly, and per-part offers using the existing `OffersPanel`
  (pre-collected set immediately, "Search more vendors" triggers live discovery when the API
  is live, with the job progress state).
- Resolve dialog (Task 2): per verified part, a "Where to buy" expander backed by
  `POST /api/offers/search`.
- `FixtureSource` serves the showcase fixtures and offers offline; `HttpSource` calls the
  endpoints. Vitest + a Playwright spec over the gallery → product → part → offers path.

## 4. Work split and order

| Step | Owner | Depends on |
|---|---|---|
| 0. Contract, fixture layout, plan | INT | — |
| 1. Research: `manifest.json` with ~70 candidates across categories (target 50 accepted) | research agent (web) | 0 |
| 2. Engine: extractors, ingest, Pololu adapter, CLI, tests on a few recorded samples | B | 0 |
| 3. API: showcase routes, mirror, drift test, bridge in the resolver | A | 0 (runs against hand-made samples until 5) |
| 4. Web: gallery, showcase view, per-part offers, resolve-dialog offers | C | 0 (fixtures from 5 when ready) |
| 5. Live ingestion run: `build --record --offers` over the manifest; review `rejected.json`; commit fixtures | INT | 1, 2 |
| 6. Integration: mirrors, tests across lanes, `context.md`, PR update | INT | 3, 4, 5 |

Brave budget: Task 1 uses no Brave requests (direct vendors only). Task 2 and on-demand
discovery use the key at runtime; results are cached by normalised key.

## 5. Acceptance

1. `fixtures/showcase/index.json` lists ≥ 50 products; every product file validates and every
   part has an https vendor URL, a SKU quote and a `fetched_at`.
2. `python -m rivet_engine.showcase build --replay` reproduces the committed fixtures offline.
3. `GET /api/showcase/products/{id}/parts/{part_id}/offers` returns a pre-collected set in
   stub/recorded mode and a live-merged set with `RIVET_OFFERS_PROVIDER=live`.
4. Landing page gallery → product → part → offers works in fixture mode (Playwright) and against
   the live API.
5. Bridge: with the OpenAI and Brave keys, uploading a photo of a showcase product reaches a
   verified product page through search when the vision guess carries no SKU; the resolve
   dialog shows offers for at least one verified part. Recorded as a log line with the product,
   query terms and the page that verified.
6. Nothing in the catalogue is synthetic; images carry credit and license; `pnpm test`,
   `pytest` and `validate_contracts.py` stay green offline.
