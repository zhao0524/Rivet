'use client';

import { useState } from 'react';
import { RESOLVE_FIXTURES, isResolveOutcome } from '../../../lib/resolve/fixtures';
import { RESOLVE_OUTCOMES, type ResolveOutcome } from '../../../lib/resolve/types';
import { ResolveResultView } from './ResolveResultView';

const LABEL: Record<ResolveOutcome, string> = {
  exact_match: 'Exact match',
  partial_match: 'Partial match',
  no_match_with_alternatives: 'No match, with alternatives',
  unsupported: 'Not a product',
};

/** Fixture-mode only: renders a saved example per outcome until the resolve API exists. */
export function ResolveDialogBody({ initialOutcome }: { initialOutcome: ResolveOutcome }) {
  const [outcome, setOutcome] = useState<ResolveOutcome>(initialOutcome);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p role="status" data-testid="resolve-saved-banner" className="rv-muted" style={{ margin: 0 }}>
        Saved example, not a live lookup. Nothing here was checked against a real product page.
      </p>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>Example outcome</span>
        <select
          data-testid="resolve-fixture-select"
          value={outcome}
          onChange={(e) => isResolveOutcome(e.target.value) && setOutcome(e.target.value)}
        >
          {RESOLVE_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {LABEL[o]}
            </option>
          ))}
        </select>
      </label>
      <ResolveResultView result={RESOLVE_FIXTURES[outcome]} />
    </div>
  );
}
