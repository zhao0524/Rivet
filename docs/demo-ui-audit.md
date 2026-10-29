# Demo UI audit

Audited October 24–25, 2026, against `main` at `a16f1ed`. Fixes are on
`fix/demo-ui-audit`, published as PR #109.
The previous feature-branch work and its stashes were preserved.

PR preparation rebased these fixes onto `main` at `ae9178f`, including the frontend
redesign merged in #108. The new landing layout, image handoff, navigation,
generation trace, structured live edits and printed-body downloads are preserved.
The screenshots below document the original audit, before that redesign.
The rebased branch passes **591 tests across 57 files, with 3 skipped**,
TypeScript checking and a production build. The browser suite passed 22 of 24 cases
on its first run; the two failures were stale text expectations. After correction,
both affected Buy/Review files passed all four cases on rerun, covering all 24
browser cases. CI is pending on the published PR.

The audit used Google Chrome through the official Chrome DevTools MCP server
(`chrome_devtools` 1.12.0). Evidence includes accessibility snapshots, screenshots,
console messages and network request statuses. The app ran at `localhost:3000`
with its API at `localhost:8000`.

## Findings and fixes

| ID | Screen and reproduction | Cause and change | Evidence |
| --- | --- | --- | --- |
| D01 | Submit `/design`; an empty workspace shows `404: Request failed`. | The API disabled its optional v2 routes because `numpy` was missing. Installed the engineering `geometry` extra in the local API environment and restarted. Failed generation now has a recovery screen with retry, the retained prompt and a projects link. An absent session endpoint has a readable explanation. | [Failure](demo-ui-audit-evidence/10-design-result-before.png), [failed requests](demo-ui-audit-evidence/10-design-result-before-network.txt), [working generation](demo-ui-audit-evidence/25-design-result-after.png) |
| D02 | Start a v2 design after restoring the API; one run completes while another reports job/event 404s. | Strict Mode started generation twice, including competing session-cookie handshakes. Guarded the initial request and shared the session handshake. A failed handshake can still be retried. The verified run made one generation POST and loaded its events and result with 200 responses. | [Before requests](demo-ui-audit-evidence/20-design-live-before-network.txt), [after requests](demo-ui-audit-evidence/25-design-result-after-network.txt) |
| D03 | `/design` looks like an unstyled form; its workspace does not follow the shared theme. | The v2 components referenced removed `rv-*` styles. Added a scoped stylesheet using existing theme tokens, responsive workspace layout, focus styles, a header on the form and a label for the revision input. | [Before](demo-ui-audit-evidence/08-design-before.png), [after](demo-ui-audit-evidence/24-design-start-after.png), [generated workspace](demo-ui-audit-evidence/25-design-result-after.png) |
| D04 | Home → Build it → Save and continue opens email/Google sign-in controls that never authenticate. | Removed the local pretend-account gate. Preview now continues directly to the saved draft in `/new`; it states that projects are stored in this browser. | [Removed screen](demo-ui-audit-evidence/29-signup-before.png), [new preview](demo-ui-audit-evidence/final-home-preview.png), [draft handoff](demo-ui-audit-evidence/final-home-handoff.txt) |
| D05 | Home animates a synthetic rover, but “See an example” opens a different sourced rover. | Both now use the sourced example. The animation explicitly says its fit needs review. The catalogue count is labelled as the example catalogue, not a promise about every generated build. | [Original home](demo-ui-audit-evidence/01-home-before.png); `AssemblyScroll.tsx` and `app/page.tsx` |
| D06 | Sandbox advertises 50 products, including 48 invented products without vendor data. | Removed invented entries from the public catalogue and lookup. The two sourced parts lists remain. Synthetic geometry remains available to tests; removed product URLs show the existing not-found screen. The newer catalogue work was not merged as part of this audit. | [Invented product](demo-ui-audit-evidence/05-sandbox-demo-before.png), [sourced catalogue](demo-ui-audit-evidence/22-sandbox-after.png) |
| D07 | The saved rover has two `UNKNOWN` motor-fit findings labelled “Won't work,” followed by “Looks good.” | Unknown checks now say “Needs verification.” The primary action says “Review parts and open checks” while findings remain. Their severity, evidence and count are preserved. | [Before](demo-ui-audit-evidence/02-review-before.png), [after](demo-ui-audit-evidence/23-review-after.png) |
| D08 | “Fix this” always fails on a saved example; “Change something” accepts an edit that cannot be validated. | Saved examples offer part inspection and a new-project action instead of submitting unsupported edits. Live builds retain the real edit path. The refusal link no longer promises a manual swap that Parts does not implement. | [Review after](demo-ui-audit-evidence/23-review-after.txt); regression coverage in `phase1.test.tsx` and `phase2.test.tsx` |
| D09 | Parts groups the motor battery and motor driver under Drive. | More specific power/control roles are matched before the generic word “motor.” | [Parts after](demo-ui-audit-evidence/final-parts.txt) |
| D10 | Buy lists the included chassis caster as a separate `$0.00` purchase under “No verified vendor.” | Explicit kit contents are shown in an “Included in kits” section and excluded from purchases only when the named kit is in this BOM. Parts says “Included in kit.” Arbitrary zero prices and missing prices are not treated as kit contents. | [Before](demo-ui-audit-evidence/11-buy-before.png), [after](demo-ui-audit-evidence/26-buy-after.png) |
| D11 | Buy claims “Out of stock right now” from an old snapshot and says the missing controller does not block assembly. | Stock wording now refers to the check date and explains that the part or a compatible replacement is needed. No replacement or current stock was invented. | [Buy after](demo-ui-audit-evidence/26-buy-after.txt) |
| D12 | A saved project can reference a missing build or revision. | Code inspection found readiness/loading did not consistently account for failed loads or revision mismatch. The shell now shows an explicit failure with retry and project navigation. A deliberately missing build was checked in Chrome after the fix. | [Recovery](demo-ui-audit-evidence/30-missing-build-after.png); regression in `phase1.test.tsx` |
| D13 | Restart the API after Clarify, then generate: the expired interpretation returns 404; Resume repeats the same rejected ID. | `INTENT_NOT_FOUND` and `INTENT_INPUT_MISMATCH` now offer “Review request,” clear the stale ID and return to Clarify. Ordinary transient failures retain Resume. | [Before](demo-ui-audit-evidence/21-generate-before.txt), [after](demo-ui-audit-evidence/31-expired-intent-after.png) |
| D14 | Finishing an example claims the rover is assembled; Share produces a link that only works in this browser. | The saved example ends with “Example complete.” The primary action exports the portable build file. “No parts were marked missing” replaces the unsupported assertion that every part was on hand. | [Done after](demo-ui-audit-evidence/final-done.png) |
| D15 | Clarify renders “Color: unknown” as a fact and repeats terminal punctuation in unknowns. | Unknown colour placeholders are omitted from facts. Unknown requirements remain visible with normalized punctuation. | `components/start/shared.ts`; interpretation snapshots retained in the local audit |

## Screen coverage

Every page route in `apps/web/src/app` was included. Dynamic routes were checked
with the saved sourced rover and a generated rover; this is not an exhaustive
test of every possible prompt or hardware configuration.

| Route | States checked |
| --- | --- |
| `/` | Navigation, sourced assembly, example entry, prompt preview and draft handoff; removed sign-in gate captured before removal |
| `/new` | Empty form, suggestion chips, carried draft |
| `/projects` | Saved project list and local persistence |
| `/studio` | Redirect to projects |
| `/p/[id]` | Resume redirect |
| `/p/[id]/clarify` | Interpretation, budget, size and skip defaults |
| `/p/[id]/generate` | Real API generation, expired interpretation, recovery and completion |
| `/p/[id]/review` | Saved/live builds, unknown checks, inspection links, missing project and missing build |
| `/p/[id]/parts` | All groups, selected part drawer, known and missing specs, included kit content |
| `/p/[id]/wiring` | 20 connections, firmware tab, simulation dialog and saved-example download limitation |
| `/p/[id]/buy` | Vendor groups, totals, stock caveat, included parts and cart links |
| `/p/[id]/build` | All 11 assembly steps, safety acknowledgements, firmware card and finish |
| `/p/[id]/done` | Summary, unresolved checks and build export action |
| `/sandbox` | Sourced catalogue, category filters and search |
| `/sandbox/[productId]` | Both sourced products, an invented product before removal and invalid-product recovery |
| `/design` | Initial form, missing-service failure, generation, three candidates, desktop and mobile layouts |

Screenshots and selected snapshots are in
[`demo-ui-audit-evidence/`](demo-ui-audit-evidence/). The full local capture set is
under the macOS temporary directory's `rivet-ui-audit/`; the MCP client and JSON-RPC
transcript are under `/tmp/rivet-ui-audit/`.

## Verification

- Full web suite: **51 files passed; 536 tests passed, 3 skipped**.
- Production Next.js build: **passed**, including TypeScript checking and all routes.
- Focused tests cover session concurrency/retry, unknown fit, fixture actions,
  missing builds, expired interpretations, kit inclusion and draft persistence.
- Chrome verified successful v2 generation with one generation POST, a 200 event
  stream and a 200 result. No console errors were found on the final normal
  Review, Parts, Wiring, Build, Done, Buy, Sandbox and design checks.
- The generated workspace also renders at 390 × 844 with a 390 px document width
  and no horizontal overflow: [mobile capture](demo-ui-audit-evidence/final-design-mobile-workspace.png).
- Deliberately missing builds and expired interpretations still return 404,
  as they should; the UI recovers instead of remaining blank or retrying forever.
- Development-only messages included Next's sticky-header auto-scroll warning
  and an unused preload warning. Unit tests emit existing jsdom canvas/Three.js
  warnings. These are not being described as a warning-free run.

Commands, run from the repository root:

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter web test
NODE_OPTIONS=--no-experimental-webstorage RIVET_NEXT_DIST_DIR=.next-audit pnpm --filter web build
```

The web-storage flag is needed by this machine's Node 26 test environment; it
does not change app behaviour. The separate build directory avoids overwriting
the running development server.

The local v2 runtime repair was:

```sh
services/api/.venv/bin/python -m pip install -e './packages/engineering[geometry]'
```

Restart the API after installing this optional dependency. No credentials were
changed. v1 was exercised through the live API; the v2 result explicitly reported
`fixture` provenance. Its successful geometry generation is not evidence that
live freeform providers were tested.

## Remaining demo limitations

| Priority / lane | Remaining issue | What resolves it |
| --- | --- | --- |
| High · B | Two motor-to-chassis fit checks remain `UNKNOWN`. | Cited compatibility evidence, a documented test fit, or a supported chassis/motor combination. Keep these visible during the demo. |
| High · A/C | Saved examples cannot apply edits or supply a compiled firmware package. | Use a live generated build for edits/downloads. Example UI now explains the boundary before an action fails. No board was flashed in this audit. |
| Medium · C/INT | Main contains only two sourced sandbox products; other catalogue work is separate. | Review and integrate that catalogue work with its own evidence. Do not pad the demo with invented products. |
| Medium · A/INT | v2 ran with fixture providers; live custom image/text design quality was not validated here. | Configure the intended v2 providers and rehearse that exact request. Current provenance stays visible. |
| Medium · C/A | Projects are local to a browser; account authentication and portable project URLs are not implemented. | Build real persistence/authentication if needed. Fake sign-in and local-only Share were removed; build export works without an account. |
| Data · B | Some prices/specs/dimensions/stock are old or unknown. | Refresh the underlying sources. Unknowns remain unknown; an illustrative mesh is not measured CAD or proof of physical fit. |

The saved example is suitable for a walkthrough of review, parts, wiring and
assembly. It is not presented as a physically verified or purchase-ready robot.
