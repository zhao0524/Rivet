# Product resolution (C8)

The web side of `docs/plan-verified-parts.md`: what the user sees after Rivet tries to identify
their product and trace its parts. Issue #86, under epic #72.

**There is no resolve endpoint yet.** Everything here renders from saved examples, labelled as
such in the UI. Nothing in this folder fetches a page or checks a real product.

| File | Purpose |
|---|---|
| `types.ts` | The response shape: `ResolveResult`, `Evidence` (plan §5.1), `PartStatus`, source tiers (§5.2). |
| `verify.ts` | The strict layer, client side. Decides what the UI is *allowed to show* from the evidence attached to a claim. |
| `fixtures.ts` | One saved example per outcome, in the endpoint shape. `makeResolveFixtures(now)` for deterministic tests. |

Rendered by `src/components/studio/resolve/` (`ResolveResultView`, and `ResolveDialogBody` for the
fixture picker).

## The four outcomes (plan §4)

| Outcome | Headline the UI shows |
|---|---|
| `exact_match` | "We found this product: &lt;brand&gt; &lt;name&gt;" |
| `partial_match` | "We found the product but could not confirm N of M parts" |
| `no_match_with_alternatives` | "We could not find this exact product" |
| `unsupported` | "This is not something Rivet can break into parts", plus what to upload instead |

Per part: **Verified**, **Inferred**, **Not found**, **Sources disagree** (`conflict`) or
**Out of date** (`stale`). Typical-for-category suggestions live in a separate
"What similar products use" section and are never presented as the user's parts.

## Why `verify.ts` exists

The response states a status per part. The UI does not take it at face value, because plan §5.1
says these rules are enforced in code and §6 says no copy may imply certainty the evidence does
not support. `checkResult()` re-derives the status from the evidence and **only ever downgrades**:

- `verified` needs a `manufacturer` or `distributor` host, an extractor other than `llm-extract`,
  and `matched_text` that contains the claimed value. Otherwise it is shown as `inferred`, or
  `not_found` when there is no evidence at all.
- Evidence past its `ttl_days` downgrades the claim to `stale` ("Out of date").
- An unreadable `fetched_at` counts as stale, not fresh (§3 principle 4, fail closed).
- `conflict`, `not_found` and `stale` are passed through; a claim is never strengthened, however
  good the attached evidence looks.
- `exact_match` promises every part is verified or explicitly unavailable, so a part shown as
  inferred, conflicting or out of date drops the whole outcome to `partial_match`.
- If the product's own SKU is not confirmed, the headline says what we *think* it is, never that
  we found it.

Every downgrade is surfaced, not hidden: the part row explains itself and the header counts how
many parts claimed more than their sources support. This is what should happen if the endpoint, or
a model behind it, over-claims.

These are the same rules lane B enforces in `rivet_engine.sourcing` (issue #81). Checking them
again here is deliberate, not duplication: the browser is the last place a claim can be stopped,
and the UI should not depend on the endpoint having been careful.

## Wiring the real endpoint

`ResolveResultView` takes a plain `ResolveResult`, so swapping fixtures for the API is a data
change, not a UI change:

```tsx
// today, fixture mode only
<ResolveResultView result={RESOLVE_FIXTURES[outcome]} />
// once POST /api/resolve exists (lane A, issue #87)
<ResolveResultView result={await source.resolve(assetId)} />
```

Open points for that change:

- Validate the response against `types.ts` at the boundary, the way `src/lib/rivet/**` validates
  build plans. Fixtures are typed at the source, a live payload is not.
- Drop the fixture picker and the "saved example" banner in live mode, and keep the banner
  whenever a saved example is shown instead (plan §6: offline or blocked fetch must say so).
- `now` is injectable on `ResolveResultView` for tests; live code should leave it unset so
  freshness is judged against the real clock.

## Where it shows up

Fixture mode only, since there is nothing live to show: the header **Product match** button, or
`/studio?resolve=<outcome>` to open one outcome directly. Both open the `Product match` dialog
behind a banner that says it is a saved example and not a live lookup.

## Tests

- `__tests__/verify.test.ts` — the gate rules, including the adversarial cases (fabricated claim,
  teardown-only source, `llm-extract`, expired TTL, unreadable date).
- `__tests__/fixtures.test.ts` — each example is internally honest and does not go stale with the
  calendar.
- `src/components/studio/resolve/__tests__/resolve-result.test.tsx` — the §4 copy, the source
  popover, the downgrade behaviour and the three empty states.
- `e2e/resolve.spec.ts` — one Playwright test per outcome, plus the over-claim case and opening
  from the header.
