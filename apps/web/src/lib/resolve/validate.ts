/**
 * Runtime validation for the resolve endpoints, at the boundary like `lib/rivet/validate.ts`
 * does for build plans. A payload that does not match is rejected, never rendered.
 */
import {
  arrayOf,
  bool,
  int,
  literal,
  nonEmptyStr,
  nullable,
  num,
  object,
  oneOf,
  optional,
  parseOrThrow,
  plainObject,
  str,
  type Check,
} from '../rivet/validate';
import {
  CLAIM_STATUSES,
  EXTRACTORS,
  RESOLVE_OUTCOMES,
  SOURCE_HOST_TIERS,
  SUPPORTS,
  type AlternativeResult,
  type ClaimResult,
  type Evidence,
  type LedgerEntry,
  type PartResult,
  type ProductGuess,
  type ProductResult,
  type Resolution,
  type ResolveJob,
  type ResolveStartResponse,
  type TypicalPartResult,
} from './types';

const strArray = arrayOf(str);
const claimStatus = oneOf(CLAIM_STATUSES);

export const evidenceCheck: Check<Evidence> = object<Evidence>({
  claim: nonEmptyStr,
  value: nonEmptyStr,
  source_url: nonEmptyStr,
  source_host_tier: oneOf(SOURCE_HOST_TIERS),
  fetched_at: str,
  content_sha256: str,
  extractor: oneOf(EXTRACTORS),
  matched_text: str,
  ttl_days: int,
});

const ledgerEntryCheck = object<LedgerEntry>({
  evidence_id: nonEmptyStr,
  subject: str,
  support: oneOf(SUPPORTS),
  reason: str,
  evidence: evidenceCheck,
});

const claimCheck = object<ClaimResult>({
  claim: nonEmptyStr,
  status: claimStatus,
  value: nullable(str),
  conflicting_values: strArray,
  evidence_ids: strArray,
  note: nullable(str),
});

const productCheck = object<ProductResult>({
  brand: str,
  name: str,
  sku: nullable(str),
  status: claimStatus,
  claims: arrayOf(claimCheck),
});

const partCheck = object<PartResult>({
  part_id: nonEmptyStr,
  name: str,
  sku: nullable(str),
  status: claimStatus,
  claims: arrayOf(claimCheck),
  note: nullable(str),
});

const alternativeCheck = object<AlternativeResult>({
  brand: str,
  name: str,
  sku: nonEmptyStr,
  reason: str,
  status: claimStatus,
  evidence_ids: strArray,
});

const typicalCheck = object<TypicalPartResult>({
  label: literal('typical_for_category'),
  name: nonEmptyStr,
  rationale: str,
  sku: nullable(str),
  evidence_ids: strArray,
});

const guessCheck = object<ProductGuess>({
  brand: nullable(str),
  model_guess: nullable(str),
  category: str,
  visible_features: strArray,
  confidence: str,
  verdict: oneOf(['supported', 'unsupported'] as const),
  unsupported_reason: nullable(str),
});

const resolutionShape = object<Resolution>({
  schema_version: literal('1.0'),
  resolution_id: nonEmptyStr,
  created_at: str,
  outcome: oneOf(RESOLVE_OUTCOMES),
  headline: str,
  input: object({ kind: str, image_asset_id: nullable(str), user_text: nullable(str) }),
  guess: guessCheck,
  product: nullable(productCheck),
  parts: arrayOf(partCheck),
  alternatives: arrayOf(alternativeCheck),
  typical_parts: arrayOf(typicalCheck),
  conflicts: strArray,
  counts: object({
    parts_total: int,
    verified: int,
    inferred: int,
    not_found: int,
    stale: int,
    conflict: int,
    unavailable: int,
    dropped_claims: int,
  }),
  unsupported_reason: nullable(str),
  ledger: arrayOf(ledgerEntryCheck),
  provenance: object({
    vision_mode: str,
    resolver: str,
    resolver_mode: str,
    saved_example: bool,
    banner: nullable(str),
  }),
});

/** Shape, plus the references the schema cannot express: every cited evidence id is in the ledger once. */
export const resolutionCheck: Check<Resolution> = (v, p, issues) => {
  const before = issues.length;
  const r = resolutionShape(v, p, issues);
  if (issues.length > before) return r;
  const ids = new Set<string>();
  r.ledger.forEach((e, i) => {
    if (ids.has(e.evidence_id)) issues.push({ path: `${p}.ledger[${i}].evidence_id`, message: `duplicate "${e.evidence_id}"` });
    ids.add(e.evidence_id);
  });
  const cite = (list: string[], path: string) =>
    list.forEach((id, i) => {
      if (!ids.has(id)) issues.push({ path: `${path}[${i}]`, message: `"${id}" is not in the ledger` });
    });
  r.product?.claims.forEach((c, i) => cite(c.evidence_ids, `${p}.product.claims[${i}].evidence_ids`));
  r.parts.forEach((part, j) =>
    part.claims.forEach((c, i) => cite(c.evidence_ids, `${p}.parts[${j}].claims[${i}].evidence_ids`)),
  );
  r.alternatives.forEach((a, i) => cite(a.evidence_ids, `${p}.alternatives[${i}].evidence_ids`));
  r.typical_parts.forEach((t, i) => cite(t.evidence_ids, `${p}.typical_parts[${i}].evidence_ids`));
  return r;
};

export const resolveStartResponseCheck: Check<ResolveStartResponse> = object<ResolveStartResponse>({
  job_id: nonEmptyStr,
  status: str,
  resolution_id: nullable(str),
});

export const resolveJobCheck: Check<ResolveJob> = object<ResolveJob>({
  job_id: nonEmptyStr,
  status: oneOf(['queued', 'running', 'complete', 'failed'] as const),
  stage: nullable(str),
  progress: optional(nullable(num)) as Check<number | null>,
  error: optional(
    nullable(
      object({
        code: nonEmptyStr,
        message: str,
        retryable: optional(bool),
        details: optional(nullable(plainObject)),
      }),
    ),
  ),
  resolution_id: optional(nullable(str)),
});

export const parseResolution = (v: unknown) => parseOrThrow(resolutionCheck, v, 'resolution');
