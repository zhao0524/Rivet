# Studio panels (C09)

Neutral, props-only panels: `PartInspector`, `BOMPanel`, `VerificationPanel`, `ProjectRevisionPicker`.
No store or API imports; the integration layer passes `plan`, `catalog`, selection and callbacks.
`types.ts` mirrors the v1 wire contracts until `src/lib/contracts.ts` exists; swap the import then.

Tests: `__tests__/panels.test.tsx` (Vitest + jsdom + @testing-library/react). Run with the web
app's Vitest once `apps/web/package.json` exists, e.g. `pnpm --dir apps/web test`.
