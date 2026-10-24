/**
 * One saved example per outcome (plan-verified-parts.md section 4), in the exact shape
 * `GET /api/resolutions/{id}` returns. Hosts are `example.com`: nothing here was ever fetched.
 *
 * Dates are relative to `now` so the examples do not silently go stale, and so the deliberately
 * out-of-date part stays out of date. `makeResolveFixtures(now)` keeps tests deterministic.
 */

import type {
  ClaimResult,
  ClaimStatus,
  Evidence,
  Extractor,
  LedgerEntry,
  ProductGuess,
  Resolution,
  ResolutionCounts,
  ResolveOutcome,
  SourceHostTier,
  Support,
} from './types';

const DAY_MS = 86_400_000;

/** Placeholder digest: these pages were never fetched, so there is no real content to hash. */
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const MAKER = 'https://example.com/saved-example/maker';
const SHOP = 'https://example.com/saved-example/shop';
const TEARDOWN = 'https://example.com/saved-example/teardown';

const TTL_DAYS = 14;

export const SAVED_EXAMPLE_BANNER =
  'Saved example: this result comes from built-in sample data, not from live sources. Do not rely on it.';

interface EvidenceOptions {
  extractor?: Extractor;
  /** How long before `now` the page was fetched. Over `ttl_days` makes the claim out of date. */
  fetchedDaysAgo?: number;
  /** What the server concluded, recorded in the ledger. The UI re-checks it anyway. */
  support?: Support;
  reason?: string;
}

interface Source {
  value: string;
  url: string;
  tier: SourceHostTier;
  matched: string;
  options?: EvidenceOptions;
}

const src = (value: string, url: string, tier: SourceHostTier, matched: string, options?: EvidenceOptions): Source => ({
  value,
  url,
  tier,
  matched,
  options,
});

/** Builds one resolution: records go into the ledger once and claims cite them by id. */
function builder(now: Date) {
  const ledger: LedgerEntry[] = [];
  const record = (subject: string, claim: string, s: Source): string => {
    const { extractor = 'jsonld', fetchedDaysAgo = 1, support, reason } = s.options ?? {};
    const evidence: Evidence = {
      claim,
      value: s.value,
      source_url: s.url,
      source_host_tier: s.tier,
      fetched_at: new Date(now.getTime() - fetchedDaysAgo * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      content_sha256: SHA,
      extractor,
      matched_text: s.matched,
      ttl_days: TTL_DAYS,
    };
    const evidence_id = `ev-${String(ledger.length + 1).padStart(3, '0')}`;
    ledger.push({
      evidence_id,
      subject,
      support: support ?? (s.tier === 'teardown' ? 'inferred' : 'verified'),
      reason: reason ?? (s.tier === 'teardown' ? 'teardown source' : 'trusted source contains the value'),
      evidence,
    });
    return evidence_id;
  };
  const claim = (
    subject: string,
    name: string,
    status: ClaimStatus,
    sources: Source[],
    extra: Partial<ClaimResult> = {},
  ): ClaimResult => ({
    claim: name,
    status,
    value: status === 'verified' || status === 'inferred' ? sources[0]?.value ?? null : null,
    conflicting_values: status === 'conflict' ? sources.map((s) => s.value).sort() : [],
    evidence_ids: sources.map((s) => record(subject, name, s)),
    note: null,
    ...extra,
  });
  return { ledger, record, claim };
}

const counts = (statuses: ClaimStatus[], dropped = 0): ResolutionCounts => ({
  parts_total: statuses.length,
  verified: statuses.filter((s) => s === 'verified').length,
  inferred: statuses.filter((s) => s === 'inferred').length,
  not_found: statuses.filter((s) => s === 'not_found').length,
  stale: statuses.filter((s) => s === 'stale').length,
  conflict: statuses.filter((s) => s === 'conflict').length,
  unavailable: statuses.filter((s) => s === 'unavailable').length,
  dropped_claims: dropped,
});

const DRONE_GUESS: ProductGuess = {
  brand: 'Example Aero',
  model_guess: 'Scout Mini',
  category: 'drone',
  visible_features: ['four propellers', 'gimbal camera'],
  confidence: 'medium',
  verdict: 'supported',
  unsupported_reason: null,
};

function base(id: string, now: Date, outcome: ResolveOutcome, headline: string, userText: string) {
  return {
    schema_version: '1.0' as const,
    resolution_id: id,
    created_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    outcome,
    headline,
    input: { kind: 'text', image_asset_id: null, user_text: userText },
    conflicts: [] as string[],
    unsupported_reason: null,
    provenance: {
      vision_mode: 'fixture',
      resolver: 'saved-example',
      resolver_mode: 'fixture',
      saved_example: true,
      banner: SAVED_EXAMPLE_BANNER,
    },
  };
}

const PRODUCT_SKU = src('EA-SCOUT-MINI', `${MAKER}/scout-mini`, 'manufacturer', 'SKU: EA-SCOUT-MINI');

export function makeResolveFixtures(now: Date): Record<ResolveOutcome, Resolution> {
  /** Section 4: every part is verified or explicitly marked unavailable. */
  const exactMatch = (() => {
    const { ledger, claim } = builder(now);
    const product = {
      brand: 'Example Aero',
      name: 'Scout Mini quadcopter',
      sku: 'EA-SCOUT-MINI',
      status: 'verified' as const,
      claims: [claim('product', 'sku', 'verified', [PRODUCT_SKU])],
    };
    const parts = [
      {
        part_id: 'motor',
        name: 'Brushless motor',
        sku: 'EA-M1103',
        status: 'verified' as const,
        claims: [
          claim('part:motor', 'sku', 'verified', [src('EA-M1103', `${SHOP}/m1103`, 'distributor', 'MPN EA-M1103')]),
          claim('part:motor', 'material', 'verified', [
            src('Aluminium', `${SHOP}/m1103`, 'distributor', 'Bell material: Aluminium', { extractor: 'datasheet' }),
          ]),
        ],
        note: null,
      },
      {
        part_id: 'battery',
        name: 'Battery pack',
        sku: 'EA-LP2S-850',
        status: 'verified' as const,
        claims: [
          claim('part:battery', 'sku', 'verified', [
            src('EA-LP2S-850', `${MAKER}/battery`, 'manufacturer', 'EA-LP2S-850 2S 850 mAh', { extractor: 'datasheet' }),
          ]),
        ],
        note: null,
      },
      {
        part_id: 'frame',
        name: 'Frame',
        sku: 'EA-FR-MINI',
        status: 'verified' as const,
        claims: [
          claim('part:frame', 'sku', 'verified', [src('EA-FR-MINI', `${MAKER}/frame`, 'manufacturer', 'Part EA-FR-MINI')]),
          claim('part:frame', 'material', 'verified', [
            src('Carbon fibre', `${MAKER}/frame`, 'manufacturer', 'Frame material: Carbon fibre', { extractor: 'datasheet' }),
          ]),
        ],
        note: null,
      },
      {
        part_id: 'gps',
        name: 'GPS module',
        sku: null,
        status: 'unavailable' as const,
        claims: [],
        note: 'Sold only as part of the flight controller',
      },
    ];
    const r: Resolution = {
      ...base(
        'res-000000000001',
        now,
        'exact_match',
        'We found this product: Scout Mini quadcopter (SKU EA-SCOUT-MINI). Here are its parts, each with its source.',
        'Example Aero Scout Mini drone',
      ),
      guess: DRONE_GUESS,
      product,
      parts,
      alternatives: [],
      typical_parts: [],
      counts: counts(parts.map((p) => p.status)),
      ledger,
    };
    return r;
  })();

  const partialMatch = (() => {
    const { ledger, claim, record } = builder(now);
    const product = {
      brand: 'Example Aero',
      name: 'Scout Mini quadcopter',
      sku: 'EA-SCOUT-MINI',
      status: 'verified' as const,
      claims: [claim('product', 'sku', 'verified', [PRODUCT_SKU])],
    };
    const parts = [
      {
        part_id: 'motor',
        name: 'Brushless motor',
        sku: 'EA-M1103',
        status: 'verified' as const,
        claims: [claim('part:motor', 'sku', 'verified', [src('EA-M1103', `${SHOP}/m1103`, 'distributor', 'MPN EA-M1103')])],
        note: null,
      },
      {
        part_id: 'frame',
        name: 'Frame',
        sku: 'EA-FR-MINI',
        status: 'inferred' as const,
        claims: [
          claim(
            'part:frame',
            'sku',
            'inferred',
            [src('EA-FR-MINI', `${TEARDOWN}/scout-mini`, 'teardown', 'frame plate marked EA-FR-MINI')],
            { note: 'teardown source' },
          ),
        ],
        note: null,
      },
      {
        part_id: 'esc',
        name: 'Speed controller',
        sku: null,
        status: 'conflict' as const,
        claims: [
          claim(
            'part:esc',
            'sku',
            'conflict',
            [
              src('EA-ESC-4A', `${SHOP}/esc`, 'distributor', 'MPN EA-ESC-4A'),
              src('EA-ESC-5A', `${MAKER}/esc`, 'manufacturer', 'Part EA-ESC-5A'),
            ],
            { note: 'Sources disagree; no value is chosen' },
          ),
        ],
        note: 'Sources disagree; no value is chosen',
      },
      {
        // Deliberately over-claimed: the response says verified, but the page was fetched long
        // past its TTL, so `verify.ts` must show this as out of date.
        part_id: 'props',
        name: 'Propeller set',
        sku: 'EA-PROP-3B',
        status: 'verified' as const,
        claims: [
          claim('part:props', 'sku', 'verified', [
            src('EA-PROP-3B', `${SHOP}/prop-3b`, 'distributor', 'MPN EA-PROP-3B', { fetchedDaysAgo: 40 }),
          ]),
        ],
        note: null,
      },
      {
        part_id: 'camera',
        name: 'Camera',
        sku: null,
        status: 'not_found' as const,
        claims: [
          claim(
            'part:camera',
            'sku',
            'not_found',
            [
              src('EA-CAM-12', `${SHOP}/cameras`, 'distributor', 'Camera modules for small drones', {
                support: 'rejected',
                reason: 'the fetched text does not contain the claimed value',
              }),
            ],
            { note: 'the fetched text does not contain the claimed value' },
          ),
        ],
        note: null,
      },
      { part_id: 'radio', name: 'Radio receiver', sku: null, status: 'not_found' as const, claims: [], note: null },
    ];
    const typical = {
      label: 'typical_for_category' as const,
      name: 'Camera',
      rationale: '2 of 3 comparable drones with a published parts list use a 12 MP fixed-focus module.',
      sku: 'EA-CAM-12',
      evidence_ids: [
        record(
          'typical:Camera',
          'sku',
          src('EA-CAM-12', `${SHOP}/cam-12`, 'distributor', 'MPN EA-CAM-12 12 MP fixed focus', { extractor: 'datasheet' }),
        ),
      ],
    };
    const r: Resolution = {
      ...base(
        'res-000000000002',
        now,
        'partial_match',
        'We found Scout Mini quadcopter (SKU EA-SCOUT-MINI) but could not confirm 4 of 6 parts. Here is what we do know, and what similar products use for the rest.',
        'Example Aero Scout Mini drone',
      ),
      guess: DRONE_GUESS,
      product,
      parts,
      alternatives: [],
      typical_parts: [typical],
      conflicts: ['part esc: sources disagree'],
      counts: counts(parts.map((p) => p.status)),
      ledger,
    };
    return r;
  })();

  const noMatch = (() => {
    const { ledger, record } = builder(now);
    const r: Resolution = {
      ...base(
        'res-000000000003',
        now,
        'no_match_with_alternatives',
        'We could not find this exact product. These are the closest products we can verify, and what similar products use for each part.',
        'Zorblax Q9 drone',
      ),
      guess: { ...DRONE_GUESS, brand: null, model_guess: null, visible_features: ['four propellers'] },
      product: null,
      parts: [],
      alternatives: [
        {
          brand: 'Example Aero',
          name: 'Scout Mini quadcopter',
          sku: 'EA-SCOUT-MINI',
          reason: 'Same category (drone) with every part sourced',
          status: 'verified',
          evidence_ids: [record('alternative:EA-SCOUT-MINI', 'sku', PRODUCT_SKU)],
        },
        {
          brand: 'Sample Fly',
          name: 'Pocket 4 drone',
          sku: 'SF-POCKET-4',
          reason: 'Same category and size class',
          status: 'verified',
          evidence_ids: [
            record('alternative:SF-POCKET-4', 'sku', src('SF-POCKET-4', `${SHOP}/pocket-4`, 'distributor', 'SKU SF-POCKET-4')),
          ],
        },
      ],
      typical_parts: [
        {
          label: 'typical_for_category',
          name: 'Brushless motor',
          rationale: '2 of 2 verified comparable drones use brushless motors in the 1103 size range.',
          sku: 'EA-M1103',
          evidence_ids: [
            record(
              'typical:Brushless motor',
              'sku',
              src('EA-M1103', `${SHOP}/m1103`, 'distributor', 'EA-M1103 1103 brushless', { extractor: 'datasheet' }),
            ),
          ],
        },
        {
          label: 'typical_for_category',
          name: 'Battery pack',
          rationale: '2 of 2 verified comparable drones use a 2S lithium polymer pack.',
          sku: 'EA-LP2S-850',
          evidence_ids: [
            record(
              'typical:Battery pack',
              'sku',
              src('EA-LP2S-850', `${MAKER}/battery`, 'manufacturer', 'EA-LP2S-850 2S 850 mAh', { extractor: 'datasheet' }),
            ),
          ],
        },
      ],
      counts: counts([]),
      ledger,
    };
    return r;
  })();

  const unsupported: Resolution = {
    ...base(
      'res-000000000004',
      now,
      'unsupported',
      'This is not a product Rivet can reason about. The image shows a landscape, not a manufactured product.',
      'a sunset landscape',
    ),
    guess: {
      brand: null,
      model_guess: null,
      category: 'not_a_product',
      visible_features: ['mountains', 'sky'],
      confidence: 'medium',
      verdict: 'unsupported',
      unsupported_reason: 'The image shows a landscape, not a manufactured product.',
    },
    product: null,
    parts: [],
    alternatives: [],
    typical_parts: [],
    counts: counts([]),
    unsupported_reason: 'The image shows a landscape, not a manufactured product.',
    ledger: [],
  };

  return {
    exact_match: exactMatch,
    partial_match: partialMatch,
    no_match_with_alternatives: noMatch,
    unsupported,
  };
}

export const RESOLVE_FIXTURES: Record<ResolveOutcome, Resolution> = makeResolveFixtures(new Date());

export function isResolveOutcome(value: unknown): value is ResolveOutcome {
  return typeof value === 'string' && value in RESOLVE_FIXTURES;
}
