'use client';

import Link from 'next/link';
import { CHECK_FAMILY_LABEL, plainCheck, safeHttpUrl } from '../../../lib/flow/derive';
import type { VerificationFinding } from '../../../lib/rivet/types';
import { Icon } from '../../system/Icon';
import { MoreDetails } from '../phase1/shared';

export type BlockerKind = 'safety' | 'wont-work' | 'needs-part';

export interface Blocker {
  /** Stable key: rule id plus affected instances (a rule can fire once per part). */
  key: string;
  kind: BlockerKind;
  finding: VerificationFinding;
}

export interface FixAttempt {
  status: 'pending' | 'failed';
  /** Why the fix did not apply, straight from the engine or the data source. */
  message: string | null;
  /** Rule id of the engine's refusal, when it sent one (e.g. `fixture.edits_require_live_engine`). */
  ruleId?: string | null;
}

/** Plain reason for a refused fix. Only the offline case is known well enough to rephrase. */
export function plainFixFailure(attempt: FixAttempt): string | null {
  const offline = /edits_require_live_engine/.test(attempt.ruleId ?? '') || /fixture mode|live api/i.test(attempt.message ?? '');
  return offline ? "Changes need Rivet's live engine, which isn't connected right now." : null;
}

export interface BlockerCardProps {
  blocker: Blocker;
  /** instance_id → readable part name. */
  partNames: ReadonlyMap<string, string>;
  /** instance_id → everyday nickname ("left motor"), for the plain headline. */
  nicknames?: ReadonlyMap<string, string>;
  attempt: FixAttempt | null;
  /** Another card's fix is in flight: this card's button waits. */
  busy: boolean;
  onFix: (blocker: Blocker) => void;
  /** Where "Look at this part in Parts" goes (Parts with the first affected part preselected). */
  partsHref: string;
}

const BADGE: Record<BlockerKind, { className: string; text: string }> = {
  safety: { className: 'ui-badge ui-badge--danger', text: 'Safety' },
  'wont-work': { className: 'ui-badge ui-badge--warn', text: "Won't work" },
  'needs-part': { className: 'ui-badge ui-badge--accent', text: 'Needs a part' },
};

/** One blocking check with one fix button; a failed fix stays visible with its reason. */
export function BlockerCard({ blocker, partNames, nicknames, attempt, busy, onFix, partsHref }: BlockerCardProps) {
  const { finding, kind } = blocker;
  const badge = BADGE[kind];
  const links = finding.evidence_urls.map(safeHttpUrl).filter((u): u is string => u !== null);
  const pending = attempt?.status === 'pending';
  const failed = attempt?.status === 'failed';
  const plain = plainCheck(finding, nicknames);
  const plainWhy = failed && attempt ? plainFixFailure(attempt) : null;

  return (
    <li className="ui-card p1-blocker" data-testid="review-blocker" data-rule={finding.rule_id} data-kind={kind}>
      <div className="p1-blocker__head">
        <h3 className="ui-h3">{plain.title}</h3>
        <div className="p1-blocker__badges">
          <span className={badge.className}>
            {kind === 'safety' ? <Icon name="alert" size={12} /> : null}
            {badge.text}
          </span>
        </div>
      </div>
      {plain.explain ? <p className="p1-blocker__msg">{plain.explain}</p> : null}
      <p className="ui-small ui-muted" style={{ margin: 0 }} data-testid="review-blocker-detail">
        <strong style={{ fontWeight: 600 }}>What the check found:</strong> {finding.message}
      </p>
      {finding.affected_instance_ids.length > 0 ? (
        <ul className="p1-blocker__parts" aria-label="Parts involved">
          {finding.affected_instance_ids.map((id) => (
            <li key={id} className="ui-chip">
              {partNames.get(id) ?? id}
            </li>
          ))}
        </ul>
      ) : null}
      {links.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
          <span className="ui-small ui-muted">Sources:</span>
          <ul className="p1-links" aria-label="Sources">
            {links.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {new URL(url).hostname.replace(/^www\./, '')}
                  <Icon name="external" size={12} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <MoreDetails>
        {CHECK_FAMILY_LABEL[plain.family]} check <span className="ui-mono">{finding.rule_id}</span>, result{' '}
        <span className="ui-mono">{finding.result}</span>
      </MoreDetails>
      {failed ? (
        <div className="ui-notice p1-blocker__why" role="status" aria-live="polite" data-testid="review-fix-failed">
          <p>
            <strong>Couldn&apos;t fix this automatically.</strong>{' '}
            {plainWhy ?? attempt.message ?? "Rivet's engine didn't say why."}
          </p>
          {plainWhy && attempt.message ? <p className="ui-small ui-muted">Details: {attempt.message}</p> : null}
          <p>
            <Link href={partsHref} className="ui-btn ui-btn--link" data-testid="review-swap-manually">
              Look at this part in Parts
            </Link>
          </p>
        </div>
      ) : null}
      <div className="p1-blocker__foot">
        {pending ? (
          <span className="ui-small ui-muted p1-pending" aria-live="polite">
            <span className="ui-spinner" aria-hidden="true" />
            Checking the fix…
          </span>
        ) : null}
        <button
          type="button"
          className="ui-btn ui-btn--secondary"
          onClick={() => onFix(blocker)}
          disabled={pending || busy}
          data-testid="review-fix"
        >
          {failed ? 'Try the fix again' : 'Fix this'}
        </button>
      </div>
    </li>
  );
}
