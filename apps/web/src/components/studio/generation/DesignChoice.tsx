'use client';

import type { DesignBundle, SavedDesign } from '../../../lib/rivet/design-v2-types';

/** Critic recommendation versus the user's selection, plus the immutable revision history. */
export function DesignChoice({ bundle, revisions, onRestore, busy }: { bundle: DesignBundle; revisions: SavedDesign[]; onRestore: (revision: number) => void; busy?: boolean }) {
  const rec = bundle.recommendation;
  const differs = rec?.candidate_id && rec.candidate_id !== bundle.selected_candidate_id;
  return (
    <section aria-label="Choice and history" data-testid="design-choice" className="rv-details" style={{ padding: 10 }}>
      <p style={{ margin: 0 }}>
        <strong>Selected:</strong> {bundle.selected_candidate_id ?? 'none'}
        {differs ? <span className="rv-hint"> (Rivet recommended {rec?.candidate_id})</span> : null}
      </p>
      {rec?.rationale ? <p className="rv-hint" style={{ margin: '4px 0' }}>{rec.rationale}</p> : null}
      <p className="rv-hint" style={{ margin: '4px 0' }}>
        Revision {bundle.revision}{bundle.parent_revision ? ` (from ${bundle.parent_revision})` : ''}
        {bundle.provenance.cached ? ` · cached replay of ${bundle.provenance.replay_of}` : ''} · {bundle.provenance.generation_mode === 'live' ? 'live providers' : 'fixture providers (offline author)'}
      </p>
      {revisions.length > 1 ? (
        <ol style={{ margin: '6px 0 0', paddingLeft: 18 }} data-testid="revision-history">
          {revisions.map((r) => (
            <li key={r.revision}>
              r{r.revision}: {r.status}
              {r.revision !== bundle.revision ? (
                <button type="button" className="rv-btn rv-btn--small rv-btn--ghost" disabled={busy} onClick={() => onRestore(r.revision)} style={{ marginLeft: 6 }}>Restore</button>
              ) : <span className="rv-hint"> (current)</span>}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
