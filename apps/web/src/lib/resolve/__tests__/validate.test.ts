import { describe, expect, it } from 'vitest';
import { RivetContractError } from '../../rivet/errors';
import { makeResolveFixtures } from '../fixtures';
import { parseResolution, resolveJobCheck } from '../validate';
import { checkResult } from '../verify';
import exactMatch from './api-samples/exact_match.json';
import partialMatch from './api-samples/partial_match.json';
import noMatch from './api-samples/no_match_with_alternatives.json';
import unsupported from './api-samples/unsupported.json';
import lowConfidence from './api-samples/low_confidence.json';
import jobComplete from './api-samples/job_complete.json';

/**
 * `api-samples/` are real responses from `GET /api/resolutions/{id}` and `GET /api/jobs/{id}`,
 * captured from `services/api` in fixture mode (stub resolver). If the API shape drifts, these
 * stop matching and this file fails.
 */
const SAMPLES = { exactMatch, partialMatch, noMatch, unsupported, lowConfidence };

describe('resolution validator against real API responses', () => {
  it.each(Object.entries(SAMPLES))('accepts the %s sample', (_, sample) => {
    expect(() => parseResolution(sample)).not.toThrow();
  });

  it('accepts page-text evidence, which the engine resolver emits for pages without JSON-LD', () => {
    const sample = structuredClone(exactMatch) as typeof exactMatch;
    for (const record of sample.ledger) record.evidence.extractor = 'page-text';
    const r = parseResolution(sample);
    expect(r.ledger.every((record) => record.evidence.extractor === 'page-text')).toBe(true);
    // page-text from a manufacturer or distributor page grades like jsonld; only llm-extract is capped.
    expect(checkResult(r, new Date(r.created_at)).outcome).toBe(r.outcome);
  });

  it('accepts a completed resolve job', () => {
    const issues: { path: string; message: string }[] = [];
    resolveJobCheck(jobComplete, '$', issues);
    expect(issues).toEqual([]);
  });

  it('agrees with the server outcome when the evidence is as fresh as when it was stored', () => {
    for (const sample of [exactMatch, partialMatch, noMatch, unsupported]) {
      const r = parseResolution(sample);
      expect(checkResult(r, new Date(r.created_at)).outcome).toBe(r.outcome);
    }
  });
});

describe('resolution validator rejects what it cannot trust', () => {
  const good = makeResolveFixtures(new Date('2026-10-24T18:00:00Z')).partial_match;

  it('rejects an unknown outcome or status', () => {
    expect(() => parseResolution({ ...good, outcome: 'probably' })).toThrow(RivetContractError);
    expect(() =>
      parseResolution({ ...good, parts: [{ ...good.parts[0], status: 'confirmed-ish' }] }),
    ).toThrow(/parts\[0\]\.status/);
  });

  it('rejects a claim citing evidence that is not in the ledger', () => {
    const parts = [{ ...good.parts[0], claims: [{ ...good.parts[0].claims[0], evidence_ids: ['ev-999'] }] }];
    expect(() => parseResolution({ ...good, parts })).toThrow(/"ev-999" is not in the ledger/);
  });

  it('rejects duplicate ledger ids', () => {
    expect(() => parseResolution({ ...good, ledger: [good.ledger[0], good.ledger[0]] })).toThrow(/duplicate/);
  });

  it('rejects a typical part without its separate label', () => {
    const typical_parts = [{ ...good.typical_parts[0], label: 'part' }];
    expect(() => parseResolution({ ...good, typical_parts })).toThrow(/typical_parts\[0\]\.label/);
  });

  it('rejects a missing provenance block', () => {
    const { provenance: _drop, ...rest } = good;
    expect(() => parseResolution(rest)).toThrow(/provenance/);
  });
});
