/**
 * The strict layer, client side (plan-verified-parts.md sections 3 and 5.1).
 *
 * The resolution states a status per claim. This module decides what the UI is allowed to
 * *show*, from the evidence records the claim cites in the ledger. It only ever downgrades: a
 * response that over-claims is rendered as the weaker, honest status, with a plain-language reason.
 *
 * Rules from section 5.1 (the same rules the API applies in `resolution/evidence.py`):
 * - `verified` needs a manufacturer or distributor host, and `matched_text` must contain the
 *   value as a whole token (case and spacing ignored; `AB-12` is not found in `AB-123`).
 * - `llm-extract` alone can never produce `verified`.
 * - Evidence older than its TTL downgrades the claim to `stale`.
 * Plus principle 4, fail closed: an unreadable date or a missing source is never rounded up.
 */

import type {
  ClaimResult,
  ClaimStatus,
  Evidence,
  PartResult,
  Resolution,
  ResolveOutcome,
} from './types';

const DAY_MS = 86_400_000;

/** Tiers that may produce `verified` (section 5.2). */
const VERIFIABLE_TIERS: readonly Evidence['source_host_tier'][] = ['manufacturer', 'distributor'];

export function isStale(evidence: Evidence, now: Date): boolean {
  const fetched = Date.parse(evidence.fetched_at);
  if (Number.isNaN(fetched)) return true; // unreadable date: fail closed
  return now.getTime() - fetched > evidence.ttl_days * DAY_MS;
}

const norm = (text: string) => text.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The value appears in the text as a whole token. Mirrors `_contains` in the API. */
export function textContainsValue(text: string, value: string): boolean {
  const v = norm(value);
  if (v === '') return false;
  return new RegExp(`(?<![0-9a-z])${escapeRegExp(v)}(?![0-9a-z])`).test(norm(text));
}

/** Whether this single record is strong enough to call a claim `verified`, ignoring freshness. */
export function supportsVerified(evidence: Evidence): boolean {
  return (
    VERIFIABLE_TIERS.includes(evidence.source_host_tier) &&
    evidence.extractor !== 'llm-extract' &&
    textContainsValue(evidence.matched_text, evidence.value)
  );
}

/** Fresh and strong enough to verify on its own. */
export function confirms(evidence: Evidence, now: Date): boolean {
  return supportsVerified(evidence) && !isStale(evidence, now);
}

/** Evidence by id, from the ledger. */
export type EvidenceIndex = ReadonlyMap<string, Evidence>;

export function indexLedger(resolution: Resolution): EvidenceIndex {
  return new Map(resolution.ledger.map((e) => [e.evidence_id, e.evidence]));
}

export function evidenceFor(ids: readonly string[], index: EvidenceIndex): Evidence[] {
  return ids.flatMap((id) => {
    const e = index.get(id);
    return e ? [e] : [];
  });
}

/** Every record any of these claims cites, in order, without repeats. */
export function claimsEvidence(claims: readonly ClaimResult[], index: EvidenceIndex): Evidence[] {
  return evidenceFor([...new Set(claims.flatMap((c) => c.evidence_ids))], index);
}

/** A part's or product's status is decided by its SKU claim; without one, by all its claims. */
function statusEvidence(claims: readonly ClaimResult[], index: EvidenceIndex): Evidence[] {
  const sku = claims.filter((c) => c.claim === 'sku');
  return claimsEvidence(sku.length > 0 ? sku : claims, index);
}

export interface Verdict {
  /** What the UI shows. Never stronger than `claimed`. */
  status: ClaimStatus;
  /** What the response said. */
  claimed: ClaimStatus;
  /** Plain-language explanation, set only when the claim was downgraded. */
  reason?: string;
}

function freshnessReason(evidence: Evidence[], now: Date): string {
  const newest = evidence.reduce((a, b) => (Date.parse(a.fetched_at) > Date.parse(b.fetched_at) ? a : b));
  const fetched = Date.parse(newest.fetched_at);
  if (Number.isNaN(fetched)) return 'Its source has no readable fetch date, so it is not treated as current.';
  const days = Math.max(0, Math.floor((now.getTime() - fetched) / DAY_MS));
  return `Its source was last checked ${days} days ago, past the ${newest.ttl_days}-day freshness window, so it is not treated as current.`;
}

/**
 * Decide what a claimed status may be shown as. `conflict`, `not_found`, `stale` and
 * `unavailable` already fail closed and pass through.
 */
export function checkClaim(claimed: ClaimStatus, evidence: Evidence[], now: Date): Verdict {
  if (claimed === 'verified') {
    const supporting = evidence.filter(supportsVerified);
    if (supporting.length === 0) {
      if (evidence.length === 0)
        return {
          status: 'not_found',
          claimed,
          reason: 'Reported as verified with no source attached, so it is shown as not found.',
        };
      if (evidence.every((e) => !textContainsValue(e.matched_text, e.value)))
        return {
          status: 'not_found',
          claimed,
          reason: 'The attached pages do not contain this value, so it is shown as not found.',
        };
      return {
        status: 'inferred',
        claimed,
        reason:
          'No manufacturer or distributor page confirms this, so it is shown as inferred rather than verified.',
      };
    }
    if (supporting.every((e) => isStale(e, now)))
      return { status: 'stale', claimed, reason: freshnessReason(supporting, now) };
    return { status: 'verified', claimed };
  }

  if (claimed === 'inferred') {
    const backing = evidence.filter((e) => textContainsValue(e.matched_text, e.value));
    if (backing.length === 0)
      return {
        status: 'not_found',
        claimed,
        reason:
          evidence.length === 0
            ? 'Reported as inferred with no source attached, so it is shown as not found.'
            : 'The attached pages do not contain this value, so it is shown as not found.',
      };
    if (backing.every((e) => isStale(e, now)))
      return { status: 'stale', claimed, reason: freshnessReason(backing, now) };
    return { status: 'inferred', claimed };
  }

  return { status: claimed, claimed };
}

export function checkPart(part: PartResult, index: EvidenceIndex, now: Date): Verdict {
  return checkClaim(part.status, statusEvidence(part.claims, index), now);
}

export interface PartVerdict extends Verdict {
  part_id: string;
  name: string;
}

export interface ResolveVerdict {
  /** The outcome the UI may use. Never stronger than `claimedOutcome`. */
  outcome: ResolveOutcome;
  claimedOutcome: ResolveOutcome;
  /** Set when the outcome itself was downgraded. */
  outcomeReason?: string;
  /** Parts with their shown status, in response order. */
  parts: PartVerdict[];
  /** Only the parts whose shown status is weaker than the claim. */
  downgrades: PartVerdict[];
  /**
   * Whether the product SKU itself is confirmed on a fresh manufacturer or distributor page.
   * When false, no copy may say the product was found.
   */
  productConfirmed: boolean;
  /** Alternatives and typical parts the evidence confirms; the rest are hidden. */
  alternatives: Resolution['alternatives'];
  typical: Resolution['typical_parts'];
  /** How many alternatives or typical parts were hidden because their sources do not confirm them. */
  hiddenSuggestions: number;
}

/**
 * Section 4: `exact_match` promises every part is verified or explicitly marked unavailable.
 * A part we must show as inferred, conflicting, missing or out of date breaks that promise, so
 * the outcome drops to `partial_match` rather than the copy overstating the evidence.
 */
const EXACT_MATCH_ALLOWED: readonly ClaimStatus[] = ['verified', 'unavailable'];

export function checkResult(resolution: Resolution, now: Date = new Date()): ResolveVerdict {
  const index = indexLedger(resolution);
  const parts: PartVerdict[] = resolution.parts.map((p) => ({
    part_id: p.part_id,
    name: p.name,
    ...checkPart(p, index, now),
  }));
  const product = resolution.product;
  const productConfirmed =
    product !== null &&
    product.status === 'verified' &&
    statusEvidence(product.claims, index).some((e) => confirms(e, now));

  let outcome: ResolveOutcome = resolution.outcome;
  let outcomeReason: string | undefined;
  if (outcome === 'exact_match' && (parts.length === 0 || parts.some((p) => !EXACT_MATCH_ALLOWED.includes(p.status)))) {
    outcome = 'partial_match';
    outcomeReason =
      'Reported as an exact match, but not every part is confirmed or explicitly unavailable, so it is shown as a partial match.';
  }
  if ((outcome === 'exact_match' || outcome === 'partial_match') && !productConfirmed) {
    outcome = 'no_match_with_alternatives';
    outcomeReason = 'Reported as found, but no current manufacturer or distributor page confirms the product number.';
  }

  const confirmed = (ids: string[]) => evidenceFor(ids, index).some((e) => confirms(e, now));
  const alternatives = resolution.alternatives.filter((a) => a.status === 'verified' && confirmed(a.evidence_ids));
  const typical = resolution.typical_parts.filter((t) => confirmed(t.evidence_ids));

  return {
    outcome,
    claimedOutcome: resolution.outcome,
    outcomeReason,
    parts,
    downgrades: parts.filter((p) => p.status !== p.claimed),
    productConfirmed,
    alternatives,
    typical,
    hiddenSuggestions:
      resolution.alternatives.length - alternatives.length + (resolution.typical_parts.length - typical.length),
  };
}
