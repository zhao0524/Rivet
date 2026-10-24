import { describe, expect, it } from 'vitest';
import { RESOLVE_FIXTURES, makeResolveFixtures } from '../fixtures';
import { RESOLVE_OUTCOMES } from '../types';
import { parseResolution } from '../validate';
import { checkResult, claimsEvidence, indexLedger, isStale } from '../verify';

const NOW = new Date('2026-10-24T18:00:00Z');
const FIXTURES = makeResolveFixtures(NOW);

describe('resolve fixtures', () => {
  it('has one fixture per outcome, each in the endpoint shape', () => {
    for (const o of RESOLVE_OUTCOMES) {
      expect(FIXTURES[o].outcome).toBe(o);
      expect(() => parseResolution(FIXTURES[o])).not.toThrow();
    }
  });

  it('labels every example as a saved example', () => {
    for (const r of Object.values(FIXTURES)) {
      expect(r.provenance.saved_example).toBe(true);
      expect(r.provenance.banner).toContain('Saved example');
    }
  });

  it('never marks a part verified without a manufacturer or distributor source', () => {
    for (const r of Object.values(FIXTURES)) {
      const index = indexLedger(r);
      for (const p of r.parts.filter((x) => x.status === 'verified'))
        expect(
          claimsEvidence(p.claims, index).some((e) => ['manufacturer', 'distributor'].includes(e.source_host_tier)),
        ).toBe(true);
    }
  });

  it('parts without evidence are not found or explicitly unavailable', () => {
    for (const r of Object.values(FIXTURES))
      for (const p of r.parts.filter((x) => x.claims.length === 0)) expect(['not_found', 'unavailable']).toContain(p.status);
  });

  it('dates are relative to now, so the examples do not go stale with the calendar', () => {
    const live = makeResolveFixtures(new Date());
    const now = new Date();
    for (const e of live.exact_match.ledger) expect(isStale(e.evidence, now)).toBe(false);
    // The app-level fixtures are built from the real clock and must pass the same check.
    expect(checkResult(RESOLVE_FIXTURES.exact_match).outcome).toBe('exact_match');
  });

  it('the exact match example survives the evidence gate unchanged', () => {
    const v = checkResult(FIXTURES.exact_match, NOW);
    expect(v.outcome).toBe('exact_match');
    expect(v.productConfirmed).toBe(true);
    expect(v.downgrades).toHaveLength(0);
    for (const p of v.parts) expect(['verified', 'unavailable']).toContain(p.status);
  });

  it('the partial match example carries one deliberately over-claimed part', () => {
    const v = checkResult(FIXTURES.partial_match, NOW);
    expect(v.outcome).toBe('partial_match');
    expect(v.downgrades.map((d) => [d.part_id, d.claimed, d.status])).toEqual([['props', 'verified', 'stale']]);
  });

  it('the no-match and unsupported examples claim no product', () => {
    expect(FIXTURES.no_match_with_alternatives.product).toBeNull();
    expect(FIXTURES.unsupported.product).toBeNull();
    expect(FIXTURES.unsupported.parts).toHaveLength(0);
    expect(FIXTURES.unsupported.unsupported_reason).toBeTruthy();
  });
});
