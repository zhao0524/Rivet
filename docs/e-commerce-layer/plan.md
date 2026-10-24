# Plan: E-commerce layer (offers, vendors, ranking, buy links)

Status: proposed 2026-10-24. Owners: lanes A (API), B (engine), C (web), INT (acceptance).

## 1. Context

Rivet resolves a product into parts with verified SKUs, but each part has at most one
`purchase_url` in the catalog. There is no way to show several vendors, compare prices,
sort by rating or reliability, or discover offers for a SKU beyond the four hand-written
adapters. The goal: given a SKU/MPN, find every legitimate offer on the web, verify each
one against its page, rank and filter them, and give the user a link to check out for
themselves. No checkout, cart or affiliate handling.

Repo non-negotiable (README #2): never invent prices, stock or SKUs. Every offer field
must be backed by a fetched page and a timestamp; unknown is `null`, never 0.

## 2. What exists (reuse, do not rebuild)

| Need | Existing code |
|---|---|
| Evidence levels, host tiers, claim verification | `packages/engineering/rivet_engine/sourcing/evidence.py` (`tier_for_url`, `verify`, `verify_product`, `is_fresh`) |
| Vendor adapters (Adafruit, SparkFun, Mouser, DigiKey) and fan-out | `sourcing/adapters.py` (`lookup_all`, `LookupResult`) |
| JSON-LD / page-text extraction | `sourcing/extract.py` |
| Polite fetch (https, robots, rate limit, cache) and offline replay | `sourcing/fetch.py` (`PoliteFetcher`, `RecordedFetcher`), `sourcing/record.py` |
| Link health | `verify_links.py`, `link_checks.py`, `.github/workflows/supplier-links.yml` |
| Resolver protocol, factory, stub/engine/recorded variants | `services/api/rivet_api/resolution/{resolver,factory,engine_resolver,stub}.py` |
| Outcome gates, store | `resolution/gates.py`, `resolution/store.py` |
| Settings and env validation | `services/api/rivet_api/config.py` (`Settings.from_env`) |
| Provider error mapping | `adapters/vision_provider.py::map_provider_error` |
| Recorded pages + golden/adversarial set | `packages/engineering/tests/support/recorded/`, `fixtures/golden/verified_parts.json`, `scripts/golden_verified_parts.py` |
| Product card / resolve UI (fixtures only, not wired) | `apps/web/src/components/studio/panels/ProductCard.tsx`, `resolve/ResolveResultView.tsx`, `lib/resolve/*` |
| Purchase link rendering | `panels/BOMPanel.tsx` (`PurchaseLink`), `panels/helpers.ts` |

Gaps: `/api/resolve` is not in `contracts/api.md`; no vendor field, offer model, rating,
or ranking; BOM CSV has no SKU/vendor column; web does not call the resolve API.

## 3. Design

### 3.1 Offer record (new `contracts/offer.schema.json` + pydantic + TS)
`Offer`: `offer_id`, `sku`, `mpn`, `gtin` (nullable), `vendor` {`id`, `name`, `tier`
(manufacturer / authorized_distributor / marketplace / reseller / unknown), `domain`},
`url` (https), `price_amount` (decimal string | null), `currency`, `availability`
(`in_stock|out_of_stock|backorder|discontinued|unknown`), `min_order_qty`, `shipping`
(nullable), `rating` {`value`, `count`, `source`} | null, `match` {`kind`
(`exact_sku|exact_mpn|gtin|fuzzy`), `confidence`, `evidence_quote`}, `fetched_at`,
`evidence_level` (reuse existing levels), `link_status`, `reliability` {`score`, `factors[]`}.

Rules: a `verified` offer needs the SKU/MPN quoted on the fetched page; price needs
currency + `fetched_at`; ratings only from the vendor page (JSON-LD `aggregateRating`),
else `null`; no cross-currency conversion (matches `bom.py::unit_price`); `fuzzy` matches
are shown only under "possible matches", never in the ranked list.

### 3.2 Discovery pipeline (`rivet_engine/ecommerce/`)
1. Normalise identifiers (SKU, MPN, GTIN, manufacturer); cache key on the normalised tuple.
2. Tier 1, structured APIs: existing adapters, plus Octopart/Nexar, element14, Mouser,
   DigiKey (keys in `.env.local`, server-only).
3. Tier 2, web search: query SKU + MPN + "buy" variants through a `SearchProvider`
   (Brave / Tavily / Exa), take candidate URLs, drop denylisted/affiliate-spam domains.
4. Tier 3, page verification: `PoliteFetcher` + `extract.py` pull price/stock/rating;
   `verify_product` must find the SKU/MPN on the page, otherwise the candidate is dropped.
   Treat all page text as untrusted (existing prompt-injection adversarial case).
5. Dedupe by (vendor, canonical URL); group variants (pack size) and flag unit-price basis.
6. Score reliability, rank, return `OfferSet` with an explicit `not_found` outcome.

Reliability score (transparent, factors returned to the UI): vendor tier weight,
exactness of match, data freshness, link-check status, rating count/value (if present),
price-outlier penalty vs. median. Weights live in one JSON file, covered by tests.

Providers sit behind a protocol with `stub` (default), `recorded` (CI) and `live` modes,
chosen by `RIVET_OFFERS_PROVIDER` and validated in `Settings.from_env`, same pattern as
`RIVET_VISION_PROVIDER` / `RIVET_RESOLVER`. Live failures map to `ApiError`
(`PROVIDER_QUOTA` / `PROVIDER_UNAVAILABLE` / `PROVIDER_AUTH`).

### 3.3 API (extends `contracts/api.md`, documents `/api/resolve` too)
- `GET /api/parts/{catalog_id}/offers?sort=&filter=` and `POST /api/offers/search`
  (`{sku, mpn?, manufacturer?}`), returning a job when live discovery is needed.
- Sort: `price_asc|price_desc|rating|reliability|availability|newest`.
- Filter: `vendor_tier`, `in_stock`, `min_rating`, `max_price`, `currency`.
- Sorting/filtering is server-side and deterministic (stable tie-break on `offer_id`);
  the UI may re-sort locally over the returned set.
- BOM CSV gains optional `sku`, `vendor`, `offer_url` columns (non-breaking, appended).

### 3.4 Web
Offers panel on `PartInspector` and a "Where to buy" section in `BOMPanel`: vendor
cards with price, stock, rating, reliability badge (hover shows factors), freshness
("checked 2 h ago"), sort/filter bar, "Open vendor site" (`rel="noopener noreferrer"`,
new tab). Empty/not-found, stale, partial and loading states reuse `ProductCard` styling.
Honesty copy: prices are as of the check time and may change; Rivet does not sell parts.

## 4. Work split (3 agents, one lane each; edit only your lane)

| Agent | Lane / branch | Owns | Deliverables |
|---|---|---|---|
| 1 | B `feat/b-ecommerce-engine` | `packages/engineering/**`, `fixtures/**` | Offer models, identifier normalisation, `SearchProvider` + structured-API adapters, verification, dedupe, reliability scoring, recorded pages, golden/adversarial additions |
| 2 | A `feat/a-ecommerce-api` | `services/api/**`, `contracts/**` | Schemas, `Settings`/env, provider factory, routes, sort/filter, job + store, error mapping, `contracts/api.md`, CSV columns |
| 3 | C `feat/c-ecommerce-ui` | `apps/web/**` | Types, `http-source` + fixture-source methods, Offers panel, sort/filter UI, states, vitest + Playwright |

Order: (0) contracts first, Agent 2 publishes `offer.schema.json` + fixture `offers/*.json`
and merges it; then Agents 1 and 3 run in parallel against the fixtures; Agent 2 wires the
engine once Agent 1 lands; INT acceptance last. Update `docs/context.md` per lane at each
finish (repo rule). Commit tags `[A]`, `[B]`, `[C]`, `[INT]` with issue numbers.
Note: `docs/AGENTS.md` forbids AI attribution in commits/PRs, so omit it in this repo.

## 5. Test plan

Offline by default (CI env stays `RIVET_MODE=fixture`, no secrets); live tests opt-in via
`RIVET_LIVE_OFFERS_TEST=1`, modelled on `test_live_vision_provider.py`.

| # | Case | Expected |
|---|---|---|
| 1 | SKU exists at 3+ vendors | ranked offers, all verified with evidence quote |
| 2 | SKU not found anywhere | outcome `not_found`, no offers, no fabricated link |
| 3 | Real vendor page, SKU absent from page | candidate dropped |
| 4 | Page returns 200 with soft-404 / "product unavailable" | dropped or `unavailable`, never in-stock |
| 5 | Prompt injection in page text | ignored; adversarial golden case still `not_found` |
| 6 | Price missing | `price_amount=null`, sorts last in price sorts, not 0 |
| 7 | Mixed currencies | no conversion; filter by currency; separate groups |
| 8 | Pack-size variants (1 vs 3-pack) | unit-price basis flagged, not compared naively |
| 9 | Duplicate URLs / tracking params / redirect to same product | one offer |
| 10 | Rating absent / count 0 / rating 5.0 with 1 review | `null` / `null` / low reliability weight |
| 11 | Stale `fetched_at` (>30 d) | `stale` status, reliability penalty, shown with warning |
| 12 | Broken link per `link_checks` | demoted, labelled, not removed silently |
| 13 | robots.txt disallow, 403/429, timeout, TLS error | skipped, recorded in ledger, others still returned |
| 14 | Provider quota/auth/outage | mapped `ApiError`; partial results returned with notice |
| 15 | Counterfeit-looking marketplace, price far below median | outlier penalty, tier `marketplace`, warning |
| 16 | Discontinued part / only alternates in stock | `discontinued`, alternatives listed separately |
| 17 | Fuzzy-only match | only in "possible matches" |
| 18 | Sort/filter combos, ties, empty result after filter | deterministic order; empty-state message |
| 19 | Synthetic `demo.*` part | no live search; refused like `EXPORT_REFUSED_SYNTHETIC` |
| 20 | Non-https / `javascript:` URL | rejected at schema level |
| 21 | Unicode/whitespace/case variants of SKU, GTIN check digit | normalised; invalid GTIN rejected |
| 22 | Web: link opens with `noopener`, sort/filter UI, loading/empty/error | vitest + Playwright (offline fixtures) |

Per-lane runners: `pnpm test:engineering`, `pnpm test:api`, `pnpm test:web`, plus
`uv run scripts/validate_contracts.py` and the extended golden script.

## 6. MCP servers for agents (dev-time research and verification)

Not a runtime dependency: runtime uses plain HTTP clients behind the provider interface
so CI stays deterministic. Confirm each server exists and its current install command
before adding it to a project `.mcp.json` (none exists today).

- Firecrawl or Fetch MCP: scrape vendor pages to markdown to author recorded fixtures.
- Brave Search / Tavily / Exa MCP: prototype SKU queries and compare result quality.
- Playwright MCP (or the already-connected Claude in Chrome): inspect JS-rendered vendor pages.
- Context7: current docs for FastAPI, pydantic v2, Next.js, vendor APIs.
- Octopart/Nexar, element14, Mouser, DigiKey: REST APIs (check for official MCPs; otherwise
  wrap in the adapters). Keys go in `.env.local` only.

## 7. Verification of the implementation

1. Contracts validate: `uv run scripts/validate_contracts.py`.
2. `pnpm test` green offline; golden script prints "no fabricated SKU is verified".
3. Run `pnpm dev` with `RIVET_OFFERS_PROVIDER=recorded`, open `/studio`, resolve a part,
   confirm offers list, sorting, filters, and external links.
4. Opt-in live smoke on a known SKU with real keys; confirm every shown price traces to a
   fetched page and timestamp.

## 8. Open questions (default in bold)

- Search/crawl provider for tier 2: **Brave + Octopart/Nexar**, vs Tavily/Exa/SerpAPI.
- Currency scope: **USD only first**.
- Scope of vendors: **electronics distributors and makers' shops**; general marketplaces
  (Amazon/eBay) only if their terms permit.
- Affiliate links: **none**.
