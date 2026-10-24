# Studio panels (C09)

Neutral, props-only panels: `PartInspector`, `BOMPanel`, `VerificationPanel`, `ProjectRevisionPicker`,
`OffersPanel`. No store or API imports; the integration layer passes `plan`, `catalog`, selection,
callbacks and (for offers) an already-loaded `OffersState`.
`types.ts` mirrors the v1 wire contracts until `src/lib/contracts.ts` exists; swap the import then.

## Offers (e-commerce layer)

`OffersPanel` renders one `OffersState` (`idle | loading | ready | refused | error`) built from a
validated `OfferSet` (`src/lib/offers`). Sort and filters are applied locally with
`lib/offers/sort.ts`; sections are ranked offers, "Possible matches" (fuzzy, never ranked with
offers), "Alternatives" and a collapsible "Sources checked" ledger. Subcomponents: `OfferCard`
(vendor, tier, price with pack basis, availability, rating, freshness, `stale` / `demoted` label
and reason, "Open vendor site" with `target="_blank" rel="noopener noreferrer"`), `OffersToolbar`,
`ReliabilityBadge` (hover / focus tooltip listing the factors) and `WhereToBuy` (compact rows for
`BOMPanel`'s optional `offers` prop). `PartInspector` takes an optional `offers` prop and renders
the panel inside its sourcing section.

Honesty rules the panel enforces: a `stub` or `synthetic` set (or any set from the fixture source)
shows a "Not a live lookup" / "SYNTHETIC TEST-ONLY offers" banner; unknown price, stock or rating
is stated as such, never 0 or "free"; not-found shows no link; every panel ends with the copy that
prices are as of the check time and may have changed and that Rivet does not sell parts.

Loading happens outside the panels: `src/components/studio/offers/usePartOffers.ts` calls the data
source's `getPartOffers` and `Inspector.tsx` passes the results down.

Tests: `__tests__/panels.test.tsx`, `__tests__/offers-panel.test.tsx` (Vitest + jsdom +
@testing-library/react). Run with the web app's Vitest, e.g. `pnpm --dir apps/web test`.
