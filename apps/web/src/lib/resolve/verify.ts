/**
 * The strict layer, client side (plan-verified-parts.md sections 3 and 5.1).
 *
 * The resolve response states a status per part. This module decides what the UI is allowed to
 * *show*, from the evidence attached to the claim. It only ever downgrades: a response that
 * over-claims is rendered as the weaker, honest status, with a plain-language reason.
 *
 * Rules from section 5.1:
 * - `verified` needs a manufacturer or distributor host, and `matched_text` must contain the value.
 * - `llm-extract` alone can never produce `verified`.
 * - Evidence older than its TTL downgrades the claim to `stale`.
 * Plus principle 4, fail closed: an unreadable date or a missing source is never rounded up.
 */

import type { Evidence, PartStatus, ResolveOutcome, ResolveResult, ResolvedPart } from './types';

const DAY_MS = 86_400_000;

/** Tiers that may produce `verified` (section 5.2). */
const VERIFIABLE_TIERS: readonly Evidence['source_host_tier'][] = ['manufacturer', 'distributor'];

export function isStale(evidence: Evidence, now: Date): boolean {
  const fetched = Date.parse(evidence.fetched_at);
  if (Number.isNaN(fetched)) return true; // unreadable date: fail closed
  return now.getTime() - fetched > evidence.ttl_days * DAY_MS;
}

/** Whether this single record is strong enough to call a claim `verified`, ignoring freshness. */
export function supportsVerified(evidence: Evidence): boolean {
  return (
    VERIFIABLE_TIERS.includes(evidence.source_host_tier) &&
    evidence.extractor !== 'llm-extract' &&
    evidence.matched_text.includes(evidence.value)
  );
}

export interface Verdict {
  /** What the UI shows. Never stronger than `claimed`. */
  status: PartStatus;
  /** What the response said. */
  claimed: PartStatus;
  /** Plain-language explanation, set only when the claim was downgraded. */
  reason?: string;
}

function freshnessReason(evidence: Evidence[], now: Date): string {
  const newest = evidence.reduce((a, b) => (Date.parse(a.fetched_at) > Date.parse(b.fetched_at) ? a : b));
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(newest.fetched_at)) / DAY_MS));
  return `Its source was last checked ${days} days ago, past the ${newest.ttl_days}-day freshness window, so it is not treated as current.`;
}

/** Decide what a claimed status may be shown as. `conflict`, `not_found` and `stale` already fail closed. */
export function checkClaim(claimed: PartStatus, evidence: Evidence[], now: Date): Verdict {
  if (claimed === 'verified') {
    const supporting = evidence.filter(supportsVerified);
    if (supporting.length === 0) {
      if (evidence.length === 0)
        return {
          status: 'not_found',
          claimed,
          reason: 'Reported as verified with no source attached, so it is shown as not found.',
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
    if (evidence.length === 0)
      return {
        status: 'not_found',
        claimed,
        reason: 'Reported as inferred with no source attached, so it is shown as not found.',
      };
    if (evidence.every((e) => isStale(e, now)))
      return { status: 'stale', claimed, reason: freshnessReason(evidence, now) };
    return { status: 'inferred', claimed };
  }

  return { status: claimed, claimed };
}

export function checkPart(part: ResolvedPart, now: Date): Verdict {
  return checkClaim(part.status, part.evidence, now);
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
   * Whether the product SKU itself is confirmed on a manufacturer or distributor page.
   * When false, no copy may say the product was found.
   */
  productConfirmed: boolean;
}

/**
 * Section 4: `exact_match` promises every part is verified or explicitly marked unavailable.
 * A part we must show as inferred, conflicting or out of date breaks that promise, so the
 * outcome drops to `partial_match` rather than the copy overstating the evidence.
 */
const EXACT_MATCH_ALLOWED: readonly PartStatus[] = ['verified', 'not_found'];

export function checkResult(result: ResolveResult, now: Date = new Date()): ResolveVerdict {
  const parts: PartVerdict[] = result.parts.map((p) => ({
    part_id: p.part_id,
    name: p.name,
    ...checkPart(p, now),
  }));
  const productConfirmed =
    result.product !== null && result.product.evidence.some((e) => supportsVerified(e) && !isStale(e, now));

  let outcome: ResolveOutcome = result.outcome;
  let outcomeReason: string | undefined;
  if (outcome === 'exact_match' && parts.some((p) => !EXACT_MATCH_ALLOWED.includes(p.status))) {
    outcome = 'partial_match';
    outcomeReason =
      'Reported as an exact match, but not every part is confirmed or explicitly unavailable, so it is shown as a partial match.';
  }

  return {
    outcome,
    claimedOutcome: result.outcome,
    outcomeReason,
    parts,
    downgrades: parts.filter((p) => p.status !== p.claimed),
    productConfirmed,
  };
}
