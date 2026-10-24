import { describe, expect, it } from 'vitest';
import { checkClaim, checkResult, isStale, supportsVerified } from '../verify';
import type { Evidence, PartStatus, ResolveResult } from '../types';

const NOW = new Date('2026-10-24T18:00:00Z');
const DAY_MS = 86_400_000;

function ev(over: Partial<Evidence> = {}): Evidence {
  return {
    claim: 'sku',
    value: 'EA-M1103',
    source_url: 'https://example.com/shop/m1103',
    source_host_tier: 'distributor',
    fetched_at: new Date(NOW.getTime() - DAY_MS).toISOString(),
    content_sha256: 'x',
    extractor: 'jsonld',
    matched_text: 'MPN EA-M1103',
    ttl_days: 14,
    ...over,
  };
}

const staleEv = (over: Partial<Evidence> = {}) =>
  ev({ fetched_at: new Date(NOW.getTime() - 40 * DAY_MS).toISOString(), ...over });

describe('isStale', () => {
  it('is false inside the TTL and true past it', () => {
    expect(isStale(ev(), NOW)).toBe(false);
    expect(isStale(staleEv(), NOW)).toBe(true);
  });
  it('treats an unreadable date as stale rather than fresh', () => {
    expect(isStale(ev({ fetched_at: 'not a date' }), NOW)).toBe(true);
  });
});

describe('supportsVerified (plan section 5.1)', () => {
  it('accepts a manufacturer or distributor page whose matched text contains the value', () => {
    expect(supportsVerified(ev())).toBe(true);
    expect(supportsVerified(ev({ source_host_tier: 'manufacturer', extractor: 'datasheet' }))).toBe(true);
  });
  it('rejects teardown and community tiers', () => {
    expect(supportsVerified(ev({ source_host_tier: 'teardown' }))).toBe(false);
    expect(supportsVerified(ev({ source_host_tier: 'community' }))).toBe(false);
  });
  it('rejects llm-extract on its own', () => {
    expect(supportsVerified(ev({ extractor: 'llm-extract' }))).toBe(false);
  });
  it('rejects evidence whose matched text does not contain the value', () => {
    expect(supportsVerified(ev({ matched_text: 'some other part' }))).toBe(false);
  });
});

describe('checkClaim', () => {
  it('keeps a verified claim that its evidence supports', () => {
    const v = checkClaim('verified', [ev()], NOW);
    expect(v.status).toBe('verified');
    expect(v.reason).toBeUndefined();
  });

  it('shows a verified claim with only a teardown source as inferred', () => {
    const v = checkClaim('verified', [ev({ source_host_tier: 'teardown', extractor: 'llm-extract' })], NOW);
    expect(v.status).toBe('inferred');
    expect(v.claimed).toBe('verified');
    expect(v.reason).toContain('No manufacturer or distributor page');
  });

  it('shows a verified claim with no evidence at all as not found', () => {
    expect(checkClaim('verified', [], NOW).status).toBe('not_found');
  });

  it('shows a verified claim whose only confirming source is past its TTL as out of date', () => {
    const v = checkClaim('verified', [staleEv()], NOW);
    expect(v.status).toBe('stale');
    expect(v.reason).toContain('40 days ago');
    expect(v.reason).toContain('14-day');
  });

  it('keeps verified when one confirming source is still fresh', () => {
    expect(checkClaim('verified', [staleEv(), ev()], NOW).status).toBe('verified');
  });

  it('shows an inferred claim with no evidence as not found, and a stale one as out of date', () => {
    expect(checkClaim('inferred', [], NOW).status).toBe('not_found');
    expect(checkClaim('inferred', [staleEv({ source_host_tier: 'teardown' })], NOW).status).toBe('stale');
  });

  it('never upgrades a claim, however good the evidence', () => {
    for (const claimed of ['not_found', 'conflict', 'stale'] satisfies PartStatus[]) {
      const v = checkClaim(claimed, [ev(), ev()], NOW);
      expect(v.status).toBe(claimed);
      expect(v.reason).toBeUndefined();
    }
  });
});

function result(over: Partial<ResolveResult> = {}): ResolveResult {
  return {
    outcome: 'exact_match',
    product: { brand: 'Example Aero', name: 'Scout Mini', sku: 'EA-SCOUT-MINI', evidence: [ev({ value: 'EA-SCOUT-MINI', matched_text: 'SKU: EA-SCOUT-MINI' })] },
    parts: [],
    alternatives: [],
    typical: [],
    ...over,
  };
}

describe('checkResult', () => {
  it('leaves an honest exact match alone', () => {
    const v = checkResult(
      result({
        parts: [
          { part_id: 'motor', name: 'Motor', status: 'verified', evidence: [ev()] },
          { part_id: 'gps', name: 'GPS', status: 'not_found', evidence: [] },
        ],
      }),
      NOW,
    );
    expect(v.outcome).toBe('exact_match');
    expect(v.downgrades).toHaveLength(0);
    expect(v.outcomeReason).toBeUndefined();
    expect(v.productConfirmed).toBe(true);
  });

  it('drops an exact match to a partial match when a part is not confirmed or unavailable', () => {
    const v = checkResult(
      result({ parts: [{ part_id: 'esc', name: 'ESC', status: 'conflict', evidence: [ev(), ev()] }] }),
      NOW,
    );
    expect(v.claimedOutcome).toBe('exact_match');
    expect(v.outcome).toBe('partial_match');
    expect(v.outcomeReason).toContain('shown as a partial match');
  });

  it('reports every part whose claim was downgraded', () => {
    const v = checkResult(
      result({
        outcome: 'partial_match',
        parts: [
          { part_id: 'motor', name: 'Motor', status: 'verified', evidence: [ev()] },
          { part_id: 'props', name: 'Props', status: 'verified', evidence: [staleEv()] },
          { part_id: 'frame', name: 'Frame', status: 'verified', evidence: [] },
        ],
      }),
      NOW,
    );
    expect(v.downgrades.map((d) => [d.part_id, d.status])).toEqual([
      ['props', 'stale'],
      ['frame', 'not_found'],
    ]);
  });

  it('does not confirm the product when its SKU evidence is weak or out of date', () => {
    const weak = result({ product: { brand: 'B', name: 'N', sku: 'S', evidence: [ev({ extractor: 'llm-extract' })] } });
    expect(checkResult(weak, NOW).productConfirmed).toBe(false);
    const old = result({ product: { brand: 'B', name: 'N', sku: 'S', evidence: [staleEv({ value: 'S', matched_text: 'S' })] } });
    expect(checkResult(old, NOW).productConfirmed).toBe(false);
  });

  it('does not confirm a product that is absent', () => {
    expect(checkResult(result({ outcome: 'no_match_with_alternatives', product: null }), NOW).productConfirmed).toBe(
      false,
    );
  });
});
