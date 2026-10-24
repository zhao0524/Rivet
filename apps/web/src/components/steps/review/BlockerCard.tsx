'use client';

import Link from 'next/link';
import { ruleTitle, safeHttpUrl } from '../../../lib/flow/derive';
import type { VerificationFinding } from '../../../lib/rivet/types';
import { Icon } from '../../system/Icon';

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
}

export interface BlockerCardProps {
  blocker: Blocker;
  /** instance_id → readable part name. */
  partNames: ReadonlyMap<string, string>;
  attempt: FixAttempt | null;
  /** Another card's fix is in flight: this card's button waits. */
  busy: boolean;
  onFix: (blocker: Blocker) => void;
  /** Where "Swap it manually in Parts" goes (Parts with the first affected part preselected). */
  partsHref: string;
}

const BADGE: Record<BlockerKind, { className: string; text: string }> = {
  safety: { className: 'ui-badge ui-badge--danger', text: 'Safety' },
  'wont-work': { className: 'ui-badge ui-badge--warn', text: "Won't work" },
  'needs-part': { className: 'ui-badge ui-badge--accent', text: 'Needs a part' },
};

/** One blocking check with one fix button; a failed fix stays visible with its reason. */
export function BlockerCard({ blocker, partNames, attempt, busy, onFix, partsHref }: BlockerCardProps) {
  const { finding, kind } = blocker;
  const badge = BADGE[kind];
  const links = finding.evidence_urls.map(safeHttpUrl).filter((u): u is string => u !== null);
  const pending = attempt?.status === 'pending';
  const failed = attempt?.status === 'failed';

  return (
    <li className="ui-card p1-blocker" data-testid="review-blocker" data-rule={finding.rule_id} data-kind={kind}>
      <div className="p1-blocker__head">
        <h3 className="ui-h3">{ruleTitle(finding.rule_id)}</h3>
        <div className="p1-blocker__badges">
          <span className={badge.className}>
            {kind === 'safety' ? <Icon name="alert" size={12} /> : null}
            {badge.text}
          </span>
        </div>
      </div>
      <p className="p1-blocker__msg">{finding.message}</p>
      {finding.affected_instance_ids.length > 0 ? (
        <ul className="p1-blocker__parts" aria-label="Affected parts">
          {finding.affected_instance_ids.map((id) => (
            <li key={id} className="ui-chip">
              {partNames.get(id) ?? id}
            </li>
          ))}
        </ul>
      ) : null}
      {links.length > 0 ? (
        <ul className="p1-links" aria-label="Evidence">
          {links.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {new URL(url).hostname.replace(/^www\./, '')}
                <Icon name="external" size={12} />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? (
        <div className="ui-notice p1-blocker__why" role="status" aria-live="polite" data-testid="review-fix-failed">
          <p>
            <strong>Couldn&apos;t fix this automatically.</strong> {attempt.message ?? 'The engine did not say why.'}
          </p>
          <p>
            <Link href={partsHref} className="ui-btn ui-btn--link" data-testid="review-swap-manually">
              Swap it manually in Parts
            </Link>
          </p>
        </div>
      ) : null}
      <div className="p1-blocker__foot">
        {pending ? (
          <span className="ui-small ui-muted p1-pending" aria-live="polite">
            <span className="ui-spinner" aria-hidden="true" />
            Asking the engine…
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
