/**
 * Product resolution result (plan-verified-parts.md sections 4 and 5.1), in the exact shape
 * `GET /api/resolutions/{resolution_id}` returns (`services/api/rivet_api/resolution/models.py`).
 * Evidence lives once in the `ledger`; claims point at it by `evidence_id`.
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

export const EXTRACTORS = ['jsonld', 'datasheet', 'page-text', 'llm-extract'] as const;
export type Extractor = (typeof EXTRACTORS)[number];

/** Section 5.1 evidence record. */
export interface Evidence {
  claim: string;
  value: string;
  source_url: string;
  source_host_tier: SourceHostTier;
  /** ISO 8601 timestamp. */
  fetched_at: string;
  content_sha256: string;
  extractor: Extractor;
  matched_text: string;
  ttl_days: number;
}

/**
 * verified: confirmed at a manufacturer or distributor page. inferred: teardown source or a model
 * extraction. stale: only out-of-date sources. unavailable: a source says the part is not sold.
 */
export const CLAIM_STATUSES = ['verified', 'inferred', 'conflict', 'not_found', 'stale', 'unavailable'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** What the server concluded about one ledger record. The UI re-checks it from the evidence. */
export const SUPPORTS = ['verified', 'inferred', 'stale', 'rejected'] as const;
export type Support = (typeof SUPPORTS)[number];

export interface LedgerEntry {
  evidence_id: string;
  /** `product`, `part:<id>`, `alternative:<sku>` or `typical:<name>`. */
  subject: string;
  support: Support;
  reason: string;
  evidence: Evidence;
}

export interface ClaimResult {
  claim: string;
  status: ClaimStatus;
  value: string | null;
  conflicting_values: string[];
  evidence_ids: string[];
  note: string | null;
}

export interface ProductResult {
  brand: string;
  name: string;
  sku: string | null;
  status: ClaimStatus;
  claims: ClaimResult[];
}

export interface PartResult {
  part_id: string;
  name: string;
  sku: string | null;
  status: ClaimStatus;
  claims: ClaimResult[];
  note: string | null;
}

/** Closest verifiable product when the exact one was not found. */
export interface AlternativeResult {
  brand: string;
  name: string;
  sku: string;
  reason: string;
  status: ClaimStatus;
  evidence_ids: string[];
}

/** "What similar products use". Typical for the category, never the user's product. */
export interface TypicalPartResult {
  label: 'typical_for_category';
  name: string;
  /** Plain-language reason, e.g. "3 of 4 comparable drones use ...". */
  rationale: string;
  sku: string | null;
  evidence_ids: string[];
}

export interface ResolutionCounts {
  parts_total: number;
  verified: number;
  inferred: number;
  not_found: number;
  stale: number;
  conflict: number;
  unavailable: number;
  dropped_claims: number;
}

export interface ResolutionProvenance {
  vision_mode: string;
  resolver: string;
  resolver_mode: string;
  /** True whenever any step used built-in sample data; `banner` then says so. */
  saved_example: boolean;
  banner: string | null;
}

/** What the vision step proposed. A guess, never a claim. */
export interface ProductGuess {
  brand: string | null;
  model_guess: string | null;
  category: string;
  visible_features: string[];
  confidence: string;
  verdict: 'supported' | 'unsupported';
  unsupported_reason: string | null;
}

export interface Resolution {
  schema_version: '1.0';
  resolution_id: string;
  created_at: string;
  outcome: ResolveOutcome;
  /** The server's sentence for the outcome. The UI writes its own from the checked evidence. */
  headline: string;
  input: { kind: string; image_asset_id: string | null; user_text: string | null };
  guess: ProductGuess;
  product: ProductResult | null;
  parts: PartResult[];
  alternatives: AlternativeResult[];
  typical_parts: TypicalPartResult[];
  conflicts: string[];
  counts: ResolutionCounts;
  unsupported_reason: string | null;
  ledger: LedgerEntry[];
  provenance: ResolutionProvenance;
}

/** `POST /api/resolve` body: the same input rules as generate, without build requirements. */
export interface ResolveRequest {
  input: {
    kind: 'image' | 'text' | 'image_and_text';
    image_asset_id: string | null;
    user_text: string | null;
  };
}

/** `GET /api/jobs/{job_id}` for a resolve job. Stages: upload, identify, verify, decompose, complete, failed. */
export interface ResolveJob {
  job_id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  stage: string | null;
  progress: number | null;
  error?: { code: string; message: string; retryable?: boolean; details?: Record<string, unknown> | null } | null;
  resolution_id?: string | null;
}

export interface ResolveStartResponse {
  job_id: string;
  status: string;
  resolution_id: string | null;
}
