/**
 * One saved example per outcome (plan-verified-parts.md section 4), in the shape the resolve
 * endpoint will return. Hosts are `example.com`: nothing here was ever fetched.
 *
 * Dates are relative to `now` so the examples do not silently go stale, and so the deliberately
 * out-of-date part stays out of date. `makeResolveFixtures(now)` keeps tests deterministic.
 */

import type { Evidence, ResolveOutcome, ResolveResult, SourceHostTier } from './types';

const DAY_MS = 86_400_000;

/** Placeholder digest: these pages were never fetched, so there is no real content to hash. */
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const MAKER = 'https://example.com/saved-example/maker';
const SHOP = 'https://example.com/saved-example/shop';
const TEARDOWN = 'https://example.com/saved-example/teardown';

const TTL_DAYS = 14;

interface EvidenceOptions {
  extractor?: Evidence['extractor'];
  /** How long before `now` the page was fetched. Over `ttl_days` makes the claim out of date. */
  fetchedDaysAgo?: number;
}

function makeEvidence(now: Date) {
  return function ev(
    claim: string,
    value: string,
    url: string,
    tier: SourceHostTier,
    matched: string,
    { extractor = 'jsonld', fetchedDaysAgo = 1 }: EvidenceOptions = {},
  ): Evidence {
    return {
      claim,
      value,
      source_url: url,
      source_host_tier: tier,
      fetched_at: new Date(now.getTime() - fetchedDaysAgo * DAY_MS).toISOString(),
      content_sha256: SHA,
      extractor,
      matched_text: matched,
      ttl_days: TTL_DAYS,
    };
  };
}

export function makeResolveFixtures(now: Date): Record<ResolveOutcome, ResolveResult> {
  const ev = makeEvidence(now);
  const productEvidence = () => [
    ev('sku', 'EA-SCOUT-MINI', `${MAKER}/scout-mini`, 'manufacturer', 'SKU: EA-SCOUT-MINI'),
  ];

  /** Section 4: every part is verified or explicitly marked unavailable. */
  const exactMatch: ResolveResult = {
    outcome: 'exact_match',
    product: {
      brand: 'Example Aero',
      name: 'Scout Mini quadcopter',
      sku: 'EA-SCOUT-MINI',
      evidence: productEvidence(),
    },
    parts: [
      {
        part_id: 'motor',
        name: 'Brushless motor',
        status: 'verified',
        sku: 'EA-M1103',
        material: 'Aluminium bell',
        evidence: [ev('sku', 'EA-M1103', `${SHOP}/m1103`, 'distributor', 'MPN EA-M1103')],
      },
      {
        part_id: 'battery',
        name: 'Battery pack',
        status: 'verified',
        sku: 'EA-LP2S-850',
        evidence: [
          ev('sku', 'EA-LP2S-850', `${MAKER}/battery`, 'manufacturer', 'EA-LP2S-850 2S 850 mAh', {
            extractor: 'datasheet',
          }),
        ],
      },
      {
        part_id: 'frame',
        name: 'Frame',
        status: 'verified',
        sku: 'EA-FR-MINI',
        material: 'Carbon fibre',
        evidence: [
          ev('material', 'Carbon fibre', `${MAKER}/frame`, 'manufacturer', 'Frame material: Carbon fibre', {
            extractor: 'datasheet',
          }),
        ],
      },
      {
        part_id: 'gps',
        name: 'GPS module',
        status: 'not_found',
        evidence: [],
        note: 'The maker does not publish this part. Marked unavailable, not guessed.',
      },
    ],
    alternatives: [],
    typical: [],
  };

  const partialMatch: ResolveResult = {
    outcome: 'partial_match',
    product: {
      brand: 'Example Aero',
      name: 'Scout Mini quadcopter',
      sku: 'EA-SCOUT-MINI',
      evidence: productEvidence(),
    },
    parts: [
      {
        part_id: 'motor',
        name: 'Brushless motor',
        status: 'verified',
        sku: 'EA-M1103',
        evidence: [ev('sku', 'EA-M1103', `${SHOP}/m1103`, 'distributor', 'MPN EA-M1103')],
      },
      {
        part_id: 'frame',
        name: 'Frame',
        status: 'inferred',
        material: 'Carbon fibre (per teardown)',
        evidence: [
          ev('material', 'Carbon fibre', `${TEARDOWN}/scout-mini`, 'teardown', 'frame: carbon fibre plate', {
            extractor: 'llm-extract',
          }),
        ],
        note: 'Taken from a teardown, not from the maker.',
      },
      {
        part_id: 'esc',
        name: 'Speed controller',
        status: 'conflict',
        evidence: [
          ev('sku', 'EA-ESC-4A', `${SHOP}/esc`, 'distributor', 'EA-ESC-4A'),
          ev('sku', 'EA-ESC-5A', `${MAKER}/esc`, 'manufacturer', 'EA-ESC-5A'),
        ],
        note: 'Two sources disagree. Both are shown; neither is chosen.',
      },
      {
        // Deliberately over-claimed: the response says verified, but the page was fetched long
        // past its TTL, so `verify.ts` must show this as out of date.
        part_id: 'props',
        name: 'Propeller set',
        status: 'verified',
        sku: 'EA-PROP-3B',
        evidence: [
          ev('sku', 'EA-PROP-3B', `${SHOP}/prop-3b`, 'distributor', 'MPN EA-PROP-3B', { fetchedDaysAgo: 40 }),
        ],
      },
      { part_id: 'camera', name: 'Camera', status: 'not_found', evidence: [], note: 'No source lists this part.' },
      { part_id: 'radio', name: 'Radio receiver', status: 'not_found', evidence: [] },
    ],
    alternatives: [],
    typical: [
      {
        role: 'Camera',
        suggestion: '12 MP fixed-focus module on a 3-axis gimbal',
        rationale: '2 of 3 comparable drones with a published parts list use this class of camera.',
        evidence: [
          ev('typical', 'camera', `${TEARDOWN}/comparables`, 'teardown', 'camera: 12 MP module', {
            extractor: 'datasheet',
          }),
        ],
      },
    ],
  };

  const noMatch: ResolveResult = {
    outcome: 'no_match_with_alternatives',
    product: null,
    parts: [],
    alternatives: [
      {
        brand: 'Example Aero',
        name: 'Scout Mini quadcopter',
        sku: 'EA-SCOUT-MINI',
        evidence: productEvidence(),
      },
      {
        brand: 'Sample Fly',
        name: 'Pocket 4 drone',
        sku: 'SF-POCKET-4',
        evidence: [ev('sku', 'SF-POCKET-4', `${SHOP}/pocket-4`, 'distributor', 'SKU SF-POCKET-4')],
      },
    ],
    typical: [
      {
        role: 'Motors',
        suggestion: 'Brushless motors in the 1103 size class',
        rationale: '2 of 2 verified comparable drones use brushless motors in this size range.',
        evidence: [
          ev('typical', 'motor', `${SHOP}/m1103`, 'distributor', 'EA-M1103 1103 brushless', {
            extractor: 'datasheet',
          }),
        ],
      },
      {
        role: 'Battery',
        suggestion: '2S lithium polymer pack',
        rationale: '2 of 2 verified comparable drones use a 2S pack.',
        evidence: [
          ev('typical', 'battery', `${MAKER}/battery`, 'manufacturer', '2S 850 mAh', { extractor: 'datasheet' }),
        ],
      },
    ],
  };

  const unsupported: ResolveResult = {
    outcome: 'unsupported',
    product: null,
    parts: [],
    alternatives: [],
    typical: [],
    unsupported_reason: 'The image shows a landscape, not a manufactured product.',
  };

  return {
    exact_match: exactMatch,
    partial_match: partialMatch,
    no_match_with_alternatives: noMatch,
    unsupported,
  };
}

export const RESOLVE_FIXTURES: Record<ResolveOutcome, ResolveResult> = makeResolveFixtures(new Date());

export function isResolveOutcome(value: unknown): value is ResolveOutcome {
  return typeof value === 'string' && value in RESOLVE_FIXTURES;
}
