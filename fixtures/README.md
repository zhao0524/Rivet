# Shared fixtures

Integrator-owned, versioned inputs that every lane tests against (docs/implementation.md §3.7,
Appendix A). All hardware data here is **synthetic**: `demo.*` parts are placeholders, not real
products, and must never be presented as buildable, purchasable or wired hardware.

| File | Contents |
|---|---|
| `intent/rover_obstacle_v1.json` | Appendix A `IntentSpec` (exact copy) |
| `catalog/seed-components.json` | Appendix A.1 synthetic seed catalog (exact copy) |
| `plans/rover_obstacle_v1.json` | Appendix A.2 synthetic starter rover `BuildPlan` (exact copy) |
| `plans/rover_failing_driver_v1.json` | Baseline plus one SYNTHETIC TEST-ONLY driver-to-motor wire with no sourced current ratings; verification must report `electrical.motor_driver_current` as blocking `UNKNOWN`/`FAIL` |
| `sim/obstacle-scenario.json` | One start pose, one box ahead, and the exact state transitions the web simulation engine produces for the baseline plan |
| `images/rover-reference.png` | Original illustration of the synthetic rover (see below) |

Rules:

- Every file must pass `uv run scripts/validate_contracts.py` (schemas in `contracts/` plus the
  §3.4 referential rules and the shared-fixture checks).
- The Appendix A copies must stay byte-for-byte equal in content to `docs/implementation.md`;
  change the doc and the fixture together.
- Lanes read these files in place. The only mirrors are runtime copies that ship inside a
  package (`services/api/rivet_api/data/fixtures/`, `apps/web/src/lib/rivet/fixtures/synthetic-*`);
  tests in each lane fail if a mirror drifts.
- If the simulation engine's behavior changes, regenerate the expected transitions from the
  engine and review the diff; do not hand-edit timings.

## Image provenance and license

`images/rover-reference.png` is drawn from geometric primitives by
`scripts/generate_rover_reference.py` (no photos, renders or third-party artwork). It is an
original work of the Rivet project, licensed under the same terms as this repository, and
depicts no real product. Regenerate with `uv run --with pillow scripts/generate_rover_reference.py`.
