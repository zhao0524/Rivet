'use client';

import { useState } from 'react';
import type { RivetDataSource } from '../../../lib/rivet/data-source';
import type { UploadedImageAsset } from '../../../lib/rivet/types';
import { RESOLVE_FIXTURES, isResolveOutcome } from '../../../lib/resolve/fixtures';
import { isResolveSource } from '../../../lib/resolve/run';
import { RESOLVE_OUTCOMES, type ResolveOutcome } from '../../../lib/resolve/types';
import { ResolveLivePanel } from './ResolveLivePanel';
import { ResolveResultView } from './ResolveResultView';

const LABEL: Record<ResolveOutcome, string> = {
  exact_match: 'Exact match',
  partial_match: 'Partial match',
  no_match_with_alternatives: 'No match, with alternatives',
  unsupported: 'Not a product',
};

export interface ResolveDialogBodyProps {
  initialOutcome: ResolveOutcome;
  dataSource: RivetDataSource;
  uploadImage: (file: File, options?: { signal?: AbortSignal }) => Promise<UploadedImageAsset>;
}

/**
 * Live API: a real lookup through `POST /api/resolve`. Fixture mode: a saved example per outcome,
 * labelled as such, because there is nothing to look up against.
 */
export function ResolveDialogBody({ initialOutcome, dataSource, uploadImage }: ResolveDialogBodyProps) {
  const [outcome, setOutcome] = useState<ResolveOutcome>(initialOutcome);
  if (dataSource.mode === 'http' && isResolveSource(dataSource)) {
    return <ResolveLivePanel source={dataSource} uploadImage={uploadImage} />;
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p role="status" data-testid="resolve-saved-banner" className="rv-muted" style={{ margin: 0 }}>
        Saved example, not a live lookup. Nothing here was checked against a real product page. Switch to the live
        API to identify your own product.
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
