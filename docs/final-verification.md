# Integration verification receipt

2026-10-24 · `feat/complete-repo-fixes`. These are branch results, not claims that the
main-only gates or a physical rover demonstration have passed.

| Check | Executed result |
|---|---|
| Engine pytest | 647 passed (including the sourcing module newly merged on main); 4 obsolete not-implemented entry-point cases skipped |
| API pytest with real engine on PYTHONPATH | 572 passed; 2 opt-in paid-provider tests skipped |
| Web unit tests | 497 passed across 52 files |
| Web typecheck / production build | Passed |
| Contract/fixture validation | Passed, including image-feature rejection cases |
| Offline browser | 20 passed; product-resolution fixtures, intake, product card/BOM, simulation, saved examples, assembly and 4 viewport sizes |
| Real-engine browser | Passed (20.2 s): upload, interpretation confirmation, complete assembly, downloads and revision edit; WebGL required |
| Saved sourced example | Capture checker passes: 17 parts, 15 BOM rows, 11 steps, 110.80 USD; `needs_review`, 0 FAIL |
| Firmware | Generated ESP32 project compiled with pinned platform/library; RAM 23,072 bytes (7.0%), flash 313,625 bytes (23.9%); no flashing or physical testing |
| Supplier links | 17/17 checked purchase URLs passed HTTP/SKU checks; 2 kit entries have no purchase URL; existing out-of-stock fact preserved |
| Environment loader | 3 tests pass: priority, encrypted fallback/web key exclusion, no shell execution |
| One-command development | API and studio started on custom ports; Ctrl-C stopped both and released ports; existing web env preserved |
| Final offline verifier | 22/23 PASS, 0 FAIL, 1 SKIP (network checks intentionally offline), 4 MANUAL; firmware compile passed |

## Reproduce

From the repository root, use the setup in README, then:

```bash
python3 scripts/validate_contracts.py
python3 scripts/capture_saved_example.py --check
python3 -m unittest discover -s scripts/tests -v
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web e2e
pnpm --filter web e2e:acceptance
python3 scripts/final_verification.py --offline --artifacts /tmp/rivet-final-check
```

Run each Python project's pytest with its dependencies installed; expose
`packages/engineering` on PYTHONPATH for the API integration cases. The firmware checker
requires PlatformIO on PATH. CI uploads browser evidence, and the scheduled supplier
workflow uploads a report without altering prices, stock or catalog verification dates.

## Gates that remain open

- #39/#40: branch software evidence is available; merge and repeat on main before marking a main-only integration gate complete. Design handoff and shared schemas require review.
- #41: offline example and actual firmware compilation are proven. Physical motor/chassis fit remains UNKNOWN; this is a `needs_review` build, not a verified physical kit.
- #62: no configured live-provider key was available here. Mock/fixture tests do not prove image understanding. Run the opt-in live image test with an authorized credential.
- #42: a human must rehearse the pitch/demo, confirm team roles, submission links and video, and record real authenticated grounding if required. Grounding is currently disabled/unavailable honestly.
- #72: rover prerequisites are covered; new product-resolution issues #84–#87 and their PRs are separate work. Do not close the expanded epic from this PR.

The final verifier prints PASS/FAIL/SKIP/MANUAL per checklist item. Missing tools,
credentials or human actions stay SKIP/MANUAL; a zero exit code alone is not a completed gate.
