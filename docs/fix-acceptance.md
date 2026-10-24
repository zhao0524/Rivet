# Fix acceptance ledger

Branch: `feat/complete-repo-fixes`. Baseline: `ffecab1` (current main merged before final validation); recovered from `27266c1` (includes #77, #78 and the proposed product-resolution roadmap #88).
The approved continuation covers the 21 issues open during planning. New roadmap issues #81–#87 remain separate; this change completes their rover-flow prerequisites.

## Recovery

Original worktrees are unchanged. Staged/unstaged patches and relevant untracked files were copied outside the repository before recovery. #65 uses the committed state: its staged patch reversed the implementation. Existing #79/#80 are now merged on main and preserved; no original branch or PR was deleted. New main #90/#91 result UI and resolution routes are preserved alongside interpretation.

## Acceptance matrix

| Issues | Work | Status / evidence |
|---|---|---|
| #27, #28 | Shared fixtures and CI | Present on baseline; contract checks pass; #28 completed upstream |
| #33 | Contract conformance | Recovered; engine suite 647 passed, 4 unrelated skips |
| #35, #36, #37, #58 | Design artifacts and token handoff | Delivered: design docs, CSS tokens, four viewport screenshots; review pending |
| #62, #63 | Provider proof and one-command setup | Provider configuration documented; env-loader tests pass; live key absent |
| #65 | Estelle states | Recovered and tested; browser confirms disabled controls |
| #66, #67 | Interpretation confirmation and bounded image features | Confirmed interpretation UI, explicit closest-rover recovery, bounded traits and provenance; API/UI tests pass |
| #68 | Supplier-link checks and freshness | 17 live checks pass; read-only UI metadata and scheduled evidence workflow delivered |
| #69, #70 | Product cards, complete assembly and viewport | Product cards wired; every BOM instance covered; four viewport browser checks pass |
| #71, #72 | Full real-engine acceptance flow | Real-engine browser flow wired into CI; expanded #72 roadmap remains open |
| #39, #40, #41, #42 | Gates, saved example, firmware and rehearsal | Run software checks; main-only/manual gates remain pending |

## Evidence rules

PASS requires actual execution on the reported commit. SKIP and MANUAL never satisfy a gate. Fixture/mock vision is disclosed as fallback; unknown motor/chassis fit remains blocking. Review shared schema/API changes across lanes before merging. No gate requiring merged main is closed by branch-only evidence.
