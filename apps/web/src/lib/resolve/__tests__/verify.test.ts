import { describe, expect, it } from 'vitest';
import { checkClaim, checkResult, isStale, supportsVerified, textContainsValue } from '../verify';
import type { ClaimStatus, Evidence, LedgerEntry, PartResult, Resolution } from '../types';
import { makeResolveFixtures } from '../fixtures';

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

describe('textContainsValue (mirrors the API whole-token rule)', () => {
  it('ignores case and spacing', () => {
    expect(textContainsValue('mpn   ea-m1103', 'EA-M1103')).toBe(true);
  });
  it('does not find a value inside a longer part number', () => {
    expect(textContainsValue('MPN EA-M11034', 'EA-M1103')).toBe(false);
    expect(textContainsValue('MPN XEA-M1103', 'EA-M1103')).toBe(false);
  });
  it('treats regex characters in the value literally', () => {
    expect(textContainsValue('Part A.B', 'A.B')).toBe(true);
    expect(textContainsValue('Part AxB', 'A.B')).toBe(false);
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
    expect(v).toEqual({ status: 'verified', claimed: 'verified' });
  });

  it('shows a verified claim with only a teardown source as inferred', () => {
    const v = checkClaim('verified', [ev({ source_host_tier: 'teardown' })], NOW);
    expect(v.status).toBe('inferred');
    expect(v.reason).toContain('No manufacturer or distributor page');
  });

  it('shows a verified claim whose pages lack the value as not found (a fabricated SKU)', () => {
    const v = checkClaim('verified', [ev({ matched_text: 'Page about something else' })], NOW);
    expect(v.status).toBe('not_found');
    expect(v.reason).toContain('do not contain');
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

  it('shows an inferred claim with no backing as not found, and a stale one as out of date', () => {
    expect(checkClaim('inferred', [], NOW).status).toBe('not_found');
    expect(checkClaim('inferred', [ev({ source_host_tier: 'teardown', matched_text: 'nothing' })], NOW).status).toBe(
      'not_found',
    );
    expect(checkClaim('inferred', [staleEv({ source_host_tier: 'teardown' })], NOW).status).toBe('stale');
  });

  it('never upgrades a claim, however good the evidence', () => {
    for (const claimed of ['not_found', 'conflict', 'stale', 'unavailable'] satisfies ClaimStatus[]) {
      expect(checkClaim(claimed, [ev(), ev()], NOW)).toEqual({ status: claimed, claimed });
    }
  });
});

/** A minimal resolution whose evidence sits in the ledger, the way the API stores it. */
function resolution(
  parts: { part: Omit<PartResult, 'claims'>; evidence: Evidence[] }[],
  over: Partial<Resolution> = {},
  productEvidence: Evidence[] = [ev({ value: 'EA-SCOUT-MINI', matched_text: 'SKU: EA-SCOUT-MINI' })],
): Resolution {
  const ledger: LedgerEntry[] = [];
  const cite = (subject: string, list: Evidence[]) =>
    list.map((e) => {
      const evidence_id = `ev-${ledger.length + 1}`;
      ledger.push({ evidence_id, subject, support: 'verified', reason: '', evidence: e });
      return evidence_id;
    });
  const claim = (subject: string, status: ClaimStatus, list: Evidence[]) => ({
    claim: 'sku',
    status,
    value: list[0]?.value ?? null,
    conflicting_values: [],
    evidence_ids: cite(subject, list),
    note: null,
  });
  const base = makeResolveFixtures(NOW).exact_match;
  return {
    ...base,
    product: {
      brand: 'Example Aero',
      name: 'Scout Mini',
      sku: 'EA-SCOUT-MINI',
      status: 'verified',
      claims: [claim('product', 'verified', productEvidence)],
    },
    parts: parts.map(({ part, evidence }) => ({
      ...part,
      claims: evidence.length > 0 ? [claim(`part:${part.part_id}`, part.status, evidence)] : [],
    })),
    ledger,
    ...over,
  };
}

const part = (part_id: string, status: ClaimStatus) => ({ part_id, name: part_id, sku: null, status, note: null });

describe('checkResult', () => {
  it('leaves an honest exact match alone (verified and explicitly unavailable parts)', () => {
    const v = checkResult(
      resolution([
        { part: part('motor', 'verified'), evidence: [ev()] },
        { part: part('gps', 'unavailable'), evidence: [] },
      ]),
      NOW,
    );
    expect(v.outcome).toBe('exact_match');
    expect(v.downgrades).toHaveLength(0);
    expect(v.outcomeReason).toBeUndefined();
    expect(v.productConfirmed).toBe(true);
  });

  it('drops an exact match to a partial match when a part is not confirmed or unavailable', () => {
    const v = checkResult(resolution([{ part: part('gps', 'not_found'), evidence: [] }]), NOW);
    expect(v.claimedOutcome).toBe('exact_match');
    expect(v.outcome).toBe('partial_match');
    expect(v.outcomeReason).toContain('shown as a partial match');
  });

  it('never calls zero parts an exact match', () => {
    expect(checkResult(resolution([]), NOW).outcome).toBe('partial_match');
  });

  it('reports every part whose claim was downgraded', () => {
    const v = checkResult(
      resolution(
        [
          { part: part('motor', 'verified'), evidence: [ev()] },
          { part: part('props', 'verified'), evidence: [staleEv()] },
          { part: part('frame', 'verified'), evidence: [] },
        ],
        { outcome: 'partial_match' },
      ),
      NOW,
    );
    expect(v.downgrades.map((d) => [d.part_id, d.status])).toEqual([
      ['props', 'stale'],
      ['frame', 'not_found'],
    ]);
  });

  it('does not confirm the product when its SKU evidence is weak or out of date, and drops the outcome', () => {
    const weak = checkResult(resolution([], {}, [ev({ value: 'S', matched_text: 'S', extractor: 'llm-extract' })]), NOW);
    expect(weak.productConfirmed).toBe(false);
    expect(weak.outcome).toBe('no_match_with_alternatives');
    expect(weak.outcomeReason).toContain('no current manufacturer or distributor page');
    const old = checkResult(resolution([], {}, [staleEv({ value: 'S', matched_text: 'S' })]), NOW);
    expect(old.productConfirmed).toBe(false);
  });

  it('does not confirm a product the server itself did not verify', () => {
    const r = resolution([{ part: part('motor', 'verified'), evidence: [ev()] }]);
    expect(checkResult({ ...r, product: { ...r.product!, status: 'not_found' } }, NOW).productConfirmed).toBe(false);
  });

  it('does not confirm a product that is absent', () => {
    expect(checkResult(resolution([], { outcome: 'no_match_with_alternatives', product: null }), NOW).productConfirmed).toBe(
      false,
    );
  });

  it('hides alternatives and typical parts whose sources do not confirm them', () => {
    const r = makeResolveFixtures(NOW).no_match_with_alternatives;
    const weakId = r.alternatives[1].evidence_ids[0];
    const ledger = r.ledger.map((e) =>
      e.evidence_id === weakId ? { ...e, evidence: { ...e.evidence, source_host_tier: 'community' as const } } : e,
    );
    const v = checkResult({ ...r, ledger, typical_parts: [{ ...r.typical_parts[0], evidence_ids: [] }] }, NOW);
    expect(v.alternatives.map((a) => a.sku)).toEqual(['EA-SCOUT-MINI']);
    expect(v.typical).toHaveLength(0);
    expect(v.hiddenSuggestions).toBe(2);
  });
});
