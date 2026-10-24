# Product resolution (C8)

The web side of `docs/plan-verified-parts.md`: what the user sees after Rivet tries to identify
their product and trace its parts. Issue #86, under epic #72. The API side is lane A's
`POST /api/resolve` (`services/api/rivet_api/resolution/`, PR #91).

| File | Purpose |
|---|---|
| `types.ts` | The exact `GET /api/resolutions/{id}` shape: `Resolution`, `Evidence` (plan §5.1), the evidence `ledger`, `ClaimStatus`, source tiers (§5.2), plus the resolve request and job. |
| `validate.ts` | Runtime validation at the boundary (shape, plus every cited `evidence_id` exists in the ledger once). A payload that fails is rejected, never rendered. |
| `verify.ts` | The strict layer, client side. Decides what the UI is *allowed to show* from the ledger evidence each claim cites. |
| `run.ts` | One live lookup: `POST /api/resolve`, poll `GET /api/jobs/{id}`, then fetch and validate the resolution. |
| `fixtures.ts` | One saved example per outcome, in the endpoint shape. `makeResolveFixtures(now)` for deterministic tests. |
| `__tests__/api-samples/` | Real API responses captured from `services/api` in fixture mode. The validator tests run against them, so API drift fails the web tests. |

`HttpSource` (`src/lib/rivet/http-source.ts`) adds `resolveProduct`, `getResolveJob` and
`getResolution`. Rendered by `src/components/studio/resolve/`: `ResolveResultView` (the result),
`ResolveLivePanel` (photo and/or description, job progress, errors) and `ResolveDialogBody`
(live panel in live mode, saved-example picker in fixture mode).

## Where it shows up

The header **Product match** button opens the `Product match` dialog.

- **Live API** (`NEXT_PUBLIC_RIVET_USE_FIXTURES=false`, or the developer data source switch): upload
  a photo, describe the product, or both, then **Identify product**. The panel shows the stage the
  job reports (reading the image, working out what it is, looking at trusted sources, tracing its
  parts) and then the checked result. A failed job shows the server's own error code and message,
  and nothing else. If the server used sample data at any step, its `provenance.banner` is shown
  above the result.
- **Fixture mode**: there is nothing to look up against, so the dialog shows one saved example per
  outcome behind a "Saved example, not a live lookup" banner. `/studio?resolve=<outcome>` opens one
  directly.

## The four outcomes (plan §4)

| Outcome | Headline the UI shows |
|---|---|
| `exact_match` | "We found this product: &lt;name&gt;" |
| `partial_match` | "We found the product but could not confirm N of M parts" (N counts every part that is not verified or explicitly not sold separately; inferred parts are not confirmed) |
| `no_match_with_alternatives` | "We could not find this exact product" |
| `unsupported` | "This is not something Rivet can break into parts" for a non-product, or "We could not tell which product this is" for a low-confidence reading; then what to upload instead |

Per part: **Verified**, **Inferred**, **Not found**, **Sources disagree** (`conflict`, with both
values), **Out of date** (`stale`) or **Not sold separately** (`unavailable`). Other claims such as
material are listed with their own status. Typical-for-category suggestions live in a separate
"What similar products use" section and are never presented as the user's parts. "Every source we
checked" lists the whole ledger, including rejected records and why.

## Why `verify.ts` exists

The server already gates every claim, but the UI does not take a status at face value: plan §5.1
says these rules are enforced in code and §6 says no copy may imply certainty the evidence does not
support. `checkResult()` re-derives each status from the ledger evidence and **only ever
downgrades**, with the same rules as the API (`resolution/evidence.py`):

- `verified` needs a `manufacturer` or `distributor` host, an extractor other than `llm-extract`,
  and `matched_text` that contains the value as a whole token (case and spacing ignored). Otherwise
  it is shown as `inferred`, or `not_found` when no attached page contains the value.
- Evidence past its `ttl_days` downgrades the claim to `stale`; an unreadable `fetched_at` counts as
  stale (§3 principle 4, fail closed).
- `conflict`, `not_found`, `stale` and `unavailable` pass through; nothing is ever strengthened.
- `exact_match` promises every part is verified or explicitly unavailable (and that there is at
  least one part), so anything else drops it to `partial_match`.
- If the product's own SKU is not confirmed on a fresh trusted page, the outcome drops to
  `no_match_with_alternatives` and the headline says "This may be …, but we could not confirm it".
- Alternatives and typical parts without a confirming source are hidden, and the UI says how many.

Every downgrade is surfaced: the part row explains itself and the header counts how many parts
claimed more than their sources support.

These are the same rules lane B enforces in `rivet_engine.sourcing` (issue #81) and lane A in
`resolution/evidence.py`. Checking them again here is deliberate, not duplication: the browser is
the last place a claim can be stopped, and the UI should not depend on the endpoint having been
careful.

## Tests

- `__tests__/verify.test.ts`: the gate rules, including fabricated SKUs, teardown-only sources,
  `llm-extract`, expired TTL, unreadable dates and hidden suggestions.
- `__tests__/validate.test.ts`: the validator accepts every captured API response and rejects
  unknown statuses, dangling or duplicate evidence ids, unlabelled typical parts and missing
  provenance; the client gate agrees with the server on fresh evidence.
- `__tests__/run.test.ts`: the lookup flow, failed jobs, timeouts and cancellation.
- `__tests__/fixtures.test.ts`: each example is in the endpoint shape and internally honest.
- `src/lib/rivet/__tests__/http-source-resolve.test.ts`: the three resolve routes and error mapping.
- `src/components/studio/resolve/__tests__/`: the §4 copy, popover, ledger, downgrades and empty
  states (`resolve-result`), and the live form (`resolve-live`).
- `e2e/resolve.spec.ts`: one Playwright test per outcome, the over-claim case, opening from the
  header, and three live-mode flows (success, failed job, refused request) against captured API
  responses.
