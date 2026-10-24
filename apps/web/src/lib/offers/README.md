# Offers (e-commerce layer, lane C)

Web side of `docs/e-commerce-layer/plan.md`: where a verified part can be bought. The wire
contract is `contracts/offer.schema.json` and the "Offers" section of `contracts/api.md`;
reference fixtures are `fixtures/offers/*.json`.

| File | Purpose |
|---|---|
| `types.ts` | `OfferSet`, `Offer`, `Vendor`, `Rating`, `Match`, `Reliability`, `Pack`, `Shipping`, `LedgerEntry`, `OfferQuery`, plus `OfferSort`, `OfferFilters`, `OfferListParams` and the search request / 202 shapes. |
| `validate.ts` | `parseOfferSet(unknown)` in the style of `lib/rivet/validate.ts`. Rejects non-`https://` or `javascript:` URLs, price `"0"`, rating `count: 0`, a price without a currency, a non-fuzzy match without an evidence quote, a verified fuzzy match and any fuzzy entry inside `offers`. |
| `sort.ts` | Local re-sort and filter with the api.md semantics: unknown price / rating last in both directions, `offer_id` tie-break, per-unit comparison only when `pack.unit_price_basis === "per_pack"`, no currency conversion, `max_price` only within one currency. `offerParamsToQuery` builds the `?sort=&vendor_tier=...` string (repeatable `vendor_tier`). |
| `format.ts` | `formatPrice` ("Price not stated" for null), `formatPack` ("3-pack, price per pack (4.00 each)"), `formatRating` ("4.6 (128)" or "No rating on vendor page"), `formatFreshness` ("checked 2 h ago", injectable `now`), reliability level thresholds and factor labels, tier / availability labels, `statusLabel` for `stale` / `demoted` with the reason, and the honesty copy constants. |
| `identifiers.ts` | `normalizedKey` / `buildOfferQuery` (schema `normalized_key`), `isSyntheticCatalogId` (`demo.*`). |
| `fixtures/` | Byte-for-byte copies of `fixtures/offers/*.json` with a typed index; `__tests__/fixtures-drift.test.ts` fails when they diverge from the shared files. |

## Data sources

`RivetDataSource` (`lib/rivet/data-source.ts`) gained `getPartOffers(catalogId, params?)`,
`searchOffers(body)` and `getOfferSet(id)`.

- `FixtureSource` answers from the fixture index by `query.catalog_id` or `normalized_key`
  and never touches the network. An unknown part gets the not-found shape with the query
  substituted. A `demo.*` part rejects with a `RivetError` mirroring the API's
  `422 EXPORT_REFUSED_SYNTHETIC` (kind `unsupported`); the refused `OfferSet` travels in
  `details.offer_set`.
- `HttpSource` builds the query string, validates every body with `parseOfferSet`, maps
  error envelopes through `errors.ts`, and for a `202` from `POST /api/offers/search`
  follows the job with the existing `subscribeToJob` (SSE, then polling) and fetches
  `GET /api/offers/{offer_set_id}` named by the finished job.

## UI

`src/components/studio/panels/OffersPanel.tsx` (+ `OfferCard`, `OffersToolbar`,
`ReliabilityBadge`, `WhereToBuy`) renders an `OffersState` (idle / loading / ready /
refused / error). `src/components/studio/offers/usePartOffers.ts` loads one set per
catalog id through the active data source; `Inspector.tsx` shows the panel under the
selected part's product card and passes the per-row map to `BOMPanel`'s "Where to buy"
cell in inspect mode.

A set with `provider_mode: "stub"` or `synthetic: true`, or any set served by the fixture
source, carries a "Not a live lookup" / "SYNTHETIC TEST-ONLY offers" banner. Every panel
ends with: prices and stock are as of the check time and may have changed; Rivet does not
sell parts.

## Seeing it locally

Fixture mode (`NEXT_PUBLIC_RIVET_USE_FIXTURES=true`): the synthetic seed plan only has
`demo.*` parts, so selecting any part shows the refused state. To exercise the other
fixtures open `/studio?offers=synthetic-multivendor` (or `adafruit-3801`,
`sparkfun-rob-13301`, `not-found-9999999`, `refused-synthetic-demo-part`), or press
"Offers example" in the header. Against the live API, select a sourced part and the panel
calls `GET /api/parts/{catalog_id}/offers`.

## Tests

- `__tests__/validate.test.ts`, `sort.test.ts`, `format.test.ts`, `fixtures-drift.test.ts`
- `src/lib/rivet/__tests__/offers-source.test.ts` (fixture and HTTP sources, 202 handling)
- `src/components/studio/panels/__tests__/offers-panel.test.tsx`,
  `src/components/studio/offers/__tests__/use-part-offers.test.tsx`
- `e2e/offers.spec.ts` (Playwright, offline fixtures)
