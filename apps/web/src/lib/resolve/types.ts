/**
 * Product resolution result (plan-verified-parts.md sections 4 and 5.1).
 * The API does not exist yet; these types and the fixtures in `fixtures.ts` define the shape
 * the result UI renders. Nothing here is a live lookup.
 */

export const RESOLVE_OUTCOMES = [
  'exact_match',
  'partial_match',
  'no_match_with_alternatives',
  'unsupported',
] as const;
export type ResolveOutcome = (typeof RESOLVE_OUTCOMES)[number];

export const SOURCE_HOST_TIERS = ['manufacturer', 'distributor', 'teardown', 'community'] as const;
export type SourceHostTier = (typeof SOURCE_HOST_TIERS)[number];

/** Section 5.1 evidence record. */
export interface Evidence {
  claim: string;
  value: string;
  source_url: string;
  source_host_tier: SourceHostTier;
  /** ISO 8601 timestamp. */
  fetched_at: string;
  content_sha256: string;
  extractor: 'jsonld' | 'datasheet' | 'llm-extract';
  matched_text: string;
  ttl_days: number;
}

/** verified: confirmed at a trusted host. inferred: teardown or community source. */
export type PartStatus = 'verified' | 'inferred' | 'not_found' | 'conflict' | 'stale';

export interface ResolvedPart {
  part_id: string;
  name: string;
  status: PartStatus;
  /** SKU or MPN when known. */
  sku?: string;
  /** Only present where a source states it. */
  material?: string;
  evidence: Evidence[];
  note?: string;
}

export interface ResolvedProduct {
  brand: string;
  name: string;
  sku: string;
  evidence: Evidence[];
}

/** Closest verifiable product when the exact one was not found. */
export interface AlternativeProduct {
  brand: string;
  name: string;
  sku: string;
  evidence: Evidence[];
}

/** "What similar products use". Typical for the category, never the user's product. */
export interface TypicalPart {
  role: string;
  suggestion: string;
  /** Plain-language reason, e.g. "3 of 4 comparable drones use ...". */
  rationale: string;
  evidence: Evidence[];
}

export interface ResolveResult {
  outcome: ResolveOutcome;
  product: ResolvedProduct | null;
  parts: ResolvedPart[];
  alternatives: AlternativeProduct[];
  typical: TypicalPart[];
  /** Only for `unsupported`. */
  unsupported_reason?: string;
}
