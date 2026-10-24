# Person 2 / Developer B: parallel work orders

These are implementation handoffs, not completed features. Original B0–B7 acceptance criteria remain authoritative. Use the common instructions plus exactly one task below as the prompt for each worker.

## Schedule and isolation

1. Complete P0 first and have the integrator merge it. It freezes internal Python interfaces and supplies offline test inputs.
2. Start P1–P6 simultaneously from that merged commit. Their implementation and test paths are disjoint; none requires another parallel task's implementation. Each tests against injected data/callables from P0.
3. After all six PRs merge, run P7 to connect the implementations and prove the complete engine.

Do not run workers in the same checkout. Give each a separate clone or worktree outside the parent checkout, for example `git worktree add ../rivet-b-p1 -b feat/b-p1-catalog origin/main`. Use a unique branch from the table. The only intentionally shared file is the repository status document: resolve its merge conflicts by preserving every task's status and log entries. Never overwrite it wholesale.

| Task | Original scope | Branch | Start after |
|---|---|---|---|
| P0 | B0 foundation | `feat/b-p0-foundation` | Now |
| P1 | B1 sourced catalog | `feat/b-p1-catalog` | P0 merged |
| P2 | B2 mechanics | `feat/b-p2-mechanics` | P0 merged |
| P3 | B3 wiring | `feat/b-p3-wiring` | P0 merged |
| P4 | B4 validators | `feat/b-p4-validation` | P0 merged |
| P5 | B6 exports | `feat/b-p5-exports` | P0 merged |
| P6 | B5 repair | `feat/b-p6-repair` | P0 merged |
| P7 | B0 composition, B7 integration | `feat/b-p7-integration` | P1–P6 merged |

## Common instructions — include with every task

You own Developer B only. Read `context.md` (currently moved to `docs/context.md` on main), `docs/agent-collaboration.md`, then `docs/implementation.md` sections 0–5, Developer B in section 6, and sections 7–13. Follow applicable AGENTS.md files. Verify `gh auth status` and `gh pr list` before work; the collaboration protocol requires stopping if authentication fails. Read any existing PR feedback.

Work autonomously within the assigned paths. Do not edit API, frontend, shared contracts/fixtures, root configuration, another task's files, or dependency lockfiles owned by another task. The required status-document updates are the explicit shared-file exception. Use the per-task branches authorized by this handoff instead of putting all work on `feat/b-engineering`. Do not merge your own PR or push to main.

Claim your P-task with owner `[B]` in the status document before coding. Retain original B rows; add P-task rows if absent. Only mark an original B row DONE when its full original check passes. Update your P-row, add a Done/log entry, refresh the header and repository state before every push. Preserve other workers' changes during rebases.

Freeze the canonical JSON contract: snake_case, schema_version 1.0, mm, Y-up, XYZ Euler degrees, decimal-string money, stable IDs. Unknown source data stays null/UNKNOWN. Keep synthetic data visibly synthetic. Runtime solve/verify/repair must be offline and deterministic; sourcing research happens during catalog development. No new wire fields without the existing three-developer agreement process.

After implementation, run your targeted tests and the entire existing engineering suite. Record exact commands/results and limitations. Rebase on current origin/main, resolve conflicts in your files/status entries, rerun checks if changes warrant it, and commit only owned files plus required status updates. Use normal `[B] ...` commit messages and PR titles with no tool/model attribution or generated trailers.

Push your task branch with `git push -u origin <assigned-branch>`. Open one PR to main using `gh pr create --base main --head <assigned-branch> --title '[B] <concrete change>' --body-file <temporary-file>`. Use actual multiline text in the file:

```text
**Lane:** B
**What changed:** <behavior and task ID>
**Tests run:** <exact commands and results>
**Touches contracts/ or fixtures/?** no
**Known gaps / follow-ups:** <honest limitations; dependencies>
```

Check reviews and CI; address actionable feedback, push fixes, and reply as required by the collaboration protocol. Finish by returning the branch, commit, PR URL, tests and remaining limitations. Never claim a stub or fixture-only path is a finished engine.

## P0 — Foundation and stable internal interfaces

**Prompt:** Implement the standalone Python 3.11+/Pydantic v2 package foundation. Own only `pyproject.toml`, package-local dependency lockfile, `rivet_engine/__init__.py`, `models.py`, `ports.py`, `tests/support/**`, `tests/test_models.py`, and `INTERNAL_API.md` under `packages/engineering/`.

Model the complete canonical IntentSpec, CatalogComponent and BuildPlan, including nullable evidence and enum semantics. Validate wire shape with Pydantic and existing shared JSON schemas when available. Provide typed Python-only intermediate result types and callable protocols; these must not introduce wire fields. Document exact function signatures, error behavior, argument types and result types for catalog loading, placement, wiring, validation, BOM/assembly, serialization and repair. Keep public imports safe while modules are absent. Unimplemented entry points must reject explicitly, never return fake success.

Freeze these boundaries for P1–P6: catalog is passed explicitly; mechanics returns placed instances; wiring returns connections and pin map plus findings; validators accept a candidate and catalog and return a report; export builders accept candidate/catalog and return canonical sections; repair accepts a candidate, catalog and injected rebuild/verify callables. Repair must not import unmerged implementations. P7 supplies composition. Give each function an unambiguous name/signature in INTERNAL_API.md before parallel work starts.

Package exact private Appendix A inputs under tests/support if shared fixtures are absent. Include clearly labeled synthetic adversarial data for voltage/current/pin/mount cases and reusable factories; do not modify shared fixtures or disguise synthetic entries as real products. Tests prove null preservation, all status enums, JSON round-trip and malformed field rejection. Referential validation belongs to P4.

**Done:** clean standalone install and offline model tests pass; all six downstream tasks can code against documented interfaces and common immutable test inputs. B0 remains partial until P7 implements public behavior.

## P1 — Catalog and evidence

**Prompt:** Implement real-part catalog loading and sourcing. Own only `rivet_engine/catalog.py`, `rivet_engine/data/components.json`, `rivet_engine/data/catalog_sources.md`, and `tests/test_catalog.py`. Follow P0 interfaces; do not edit models or shared test factories.

Research manufacturer/vendor primary sources for one coherent rover stack, targeting 12–25 identifiable entries per B1. Record exact variants, source URLs, access dates, per-rating evidence and pack semantics using canonical evidence fields/notes and the source ledger. Verify product links before marking them verified; preserve unknown prices, dimensions, stall current and availability. Do not substitute chip specifications for breakout specifications. Keep demo.* identities synthetic and distinct. Make lookup/loading deterministic and offline, reject duplicate IDs and malformed data. Cross-part compatibility is checked by P4, not asserted from catalog presence.

**Tests:** real identities and source metadata exist; unknowns survive round-trip; duplicate IDs and malformed entries rejected; load uses no network. Full B1 is DONE only when its sourcing check passes.

## P2 — Mechanical placement

**Prompt:** Own only `rivet_engine/mounts.py`, `rivet_engine/data/templates/rover_2wd.json`, and `tests/test_mounts.py`. Implement P0's placement interface using explicitly supplied catalog data. Use private P0 fixtures instead of waiting for P1.

Compute child world transforms as parent × parent mount × inverse(child mount). Include rotated parents and nonzero child mount offsets. Generate chassis, distinct motors/wheels, caster, controller, driver, sensor and power instances from the template, using stable IDs. Enforce allowed mates, missing-anchor rejection and documented sensor-height bounds. Preserve approximated geometry evidence. Supply conservative transformed bounds helpers for P4; do not own validators. Do not assume fixture mount names match future real products; make template mappings explicit and report unsupported mappings.

**Tests:** repeatable poses/IDs, rotation and inverse transforms, valid references, duplicate physical occurrences, impossible mates, height boundaries and rotated AABBs. P7 handles final sourced template integration.

## P3 — Wiring and pin allocation

**Prompt:** Own only `rivet_engine/wiring.py`, `rivet_engine/data/wiring_profiles/**`, and `tests/test_wiring.py`. Implement P0's wiring interface on supplied instances/catalog and test against private fixtures.

Allocate pins deterministically for an exact documented board; include evidence for reserved/boot pins and peripheral restrictions. Produce driver PWM/direction/enable, both motor channels, logic/motor supplies, common ground, and correct sensor bus wiring. Every endpoint must resolve to an actual documented port. Return findings for missing pins, absent evidence, unsupported profiles or incomplete wiring; never invent a GPIO. Profiles must reference exact catalog IDs and be data-driven so P7 can connect sourced parts. Firmware pin_map must correspond to actual allocated connections. Compilation remains A's responsibility and must never be marked passed here.

**Tests:** all endpoints resolve; no forbidden pin/conflict; exhausted pins, incompatible logic, common-ground completeness, sensor bus assignments and reproducibility. Missing current evidence remains UNKNOWN.

## P4 — Deterministic validation

**Prompt:** Own only `rivet_engine/validators/**` and `tests/test_constraints.py`. Implement P0's verification interface without importing P2/P3 implementations; use typed candidate/catalog inputs and private fixtures. This package owns report aggregation and public verification behavior consumed by P7.

Implement referential integrity including duplicate IDs, parents/cycles, mounts, ports, BOM quantities and assembly references; supported families/behaviors; mount/clearance/conservative rotated bounds; logic, GPIO, bus and required wiring; power ranges and stall/peak-current capacity; completeness/accessories; Decimal budget and currency compatibility; firmware profile support. Every finding has all canonical fields and source URLs when available. Missing evidence cannot PASS. Aggregate known mandatory failures as unbuildable, blocking unknowns as needs_review, advisory issues as verified_with_warnings only when mandatory checks pass. Use shared schemas when available without changing them.

**Tests:** every B5 required failure case, malformed missing-driver connection, missing price versus impossible budget, unsupported behavior, current mismatch/unknown, invalid mount, duplicate IDs, advisory aggregation and deterministic finding order. Verify the shared failing-driver fixture when available; otherwise use an honestly synthetic private equivalent.

## P5 — BOM, assembly and serialization

**Prompt:** Own only `rivet_engine/bom.py`, `assembly.py`, `serialize.py`, `tests/test_bom.py`, `tests/test_assembly.py`, and `tests/test_serialize.py`. Follow P0 interfaces; operate on provided candidates/catalog rather than importing an unmerged configurator.

Group BOM rows by catalog ID with exact instance quantities; account for documented packs without inventing wire fields. Compute known subtotal with Decimal, distinguish incomplete/not_available/complete, and reject or explicitly report mixed currencies. Reflect verified product/manufacturer-only/missing link states truthfully. Produce topological structural assembly order followed by wiring/check steps, with valid IDs and no energizing instruction before wiring verification. Reject cyclic dependencies. Serialize canonical JSON deterministically, preserving nulls and identity/revision and avoiding extra fields. Derived simulation configuration remains P7's responsibility.

**Tests:** duplicate part instances, unknown/all-unknown prices, pack semantics, mixed currencies, link statuses, all step references, dependency cycles, deterministic JSON round-trip and unchanged input.

## P6 — Bounded repair

**Prompt:** Own only `rivet_engine/repair.py` and `tests/test_repair.py`. Implement the P0 repair interface using injected rebuild and verify callbacks. Tests supply those callbacks; do not wait for P2–P4 and do not implement duplicate validators.

Try deterministic, source-backed compatible substitutions or allowed layout corrections in stable order. Rebuild affected mounts/netlist/exports through the callback and rerun verification after every attempt. Cap at three rounds, detect repeated candidates, preserve input immutability and return the best truthful candidate or explicit rejection. Never make missing evidence disappear, mutate catalog records, choose an unverified cheap replacement or promote an unchecked candidate. Internal repair metadata must not leak as extra BuildPlan fields.

**Tests:** successful documented substitution, layout correction, rejection/no alternative, cycles, three-round bound, stable choice ordering, callback revalidation and non-mutation. An honestly rejected repair satisfies B5 only with evidence and tests.

## P7 — Composition, edits and standalone demo

**Prompt:** After P1–P6 merge, own only `rivet_engine/configurator.py`, `rivet_engine/demo.py`, `rivet_engine/__init__.py`, `tests/test_integration.py`, `tests/test_edits.py`, and package-local `README.md`. P0 hands __init__.py ownership to this task. Reconcile any needed changes in another task's modules through that task's owner/PR rather than editing their files silently.

Implement public solve(intent: dict) -> dict, apply_edit(plan: dict, operation: dict) -> dict, verify(plan: dict, catalog: dict) -> dict and get_catalog() -> list[dict]. Compose real catalog selection, placement, wiring, exports, all validators and bounded repair. Generate runtime UTC timestamps, stable selections and versioned provenance; reject unsupported intent or edits with documented structured limitations. Edits preserve build_id, increment revision, never mutate input, rebuild dependent data and rerun gates. Use bounded sensor-height adjustment and at least one legal catalog-backed edit.

Derive simulation wheel radius/base with mm-to-m conversion and shared behavior parameters. Label heuristic speed/range and geometry assumptions. Firmware readiness requires supported exact profiles and valid pin maps; never imply compilation occurred. Provide demo command from B7, handling shared fixture absence with a documented explicit private sample path, not silent substitution.

**Done:** run clean standalone install, entire offline pytest suite, valid and failing demo runs, shared schema checks when present, nonmutation/edit consistency and repeatability ignoring intentional timestamps. Verify BOM/steps/netlist match every instance in the sourced plan. Record remaining evidence unknowns and integration limits. Mark B0–B7 DONE only for checks actually satisfied. Push this task branch and open its own PR; leave merging to the integrator.
