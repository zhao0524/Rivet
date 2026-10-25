'use client';

import { useState } from 'react';
import type { DesignCandidate } from '../../../lib/rivet/design-v2-types';

const VIEWS = ['perspective', 'front', 'left', 'top'] as const;

function badgeTone(value: string | undefined): 'ok' | 'warn' | 'bad' {
  if (!value) return 'warn';
  if (['valid', 'pass', 'verified', 'verified_with_warnings', 'supported', 'concept_only'].includes(value)) return 'ok';
  if (['invalid', 'unbuildable', 'issues'].includes(value)) return 'bad';
  return 'warn';
}

/** Side-by-side candidates with matching-angle renders, scores and claim statuses. */
export function CandidateCompare({ candidates, selectedId, recommendedId, onChoose, onInspect }: {
  candidates: DesignCandidate[];
  selectedId: string | null;
  recommendedId?: string | null;
  onChoose: (c: DesignCandidate) => void;
  onInspect?: (c: DesignCandidate) => void;
}) {
  const [view, setView] = useState<(typeof VIEWS)[number]>('perspective');
  return (
    <section aria-label="Design candidates" data-testid="candidate-compare">
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }} role="group" aria-label="Render angle">
        {VIEWS.map((v) => (
          <button key={v} type="button" className="rv-chip" aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {candidates.map((c) => {
          const shot = c.shots.find((s) => s.view === view);
          const claims = c.claims;
          return (
            <article key={c.id} data-testid={`candidate-${c.id}`} data-selected={c.id === selectedId} className="rv-details"
              style={{ padding: 8, outline: c.id === selectedId ? '2px solid var(--rv-accent, #3b82f6)' : undefined }}>
              <header style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                <strong>{c.id}</strong>
                {c.id === recommendedId ? <span className="rv-badge rv-badge--ok" data-testid="recommended-badge">Recommended</span> : null}
              </header>
              <p className="rv-hint" style={{ margin: '2px 0 6px' }}>{c.strategy.replace(/_/g, ' ')}</p>
              {c.status === 'failed' ? (
                <p role="alert" style={{ color: 'var(--rv-danger-text)' }}>Failed: {String((c.error as { message?: string } | null)?.message ?? 'unknown error')}</p>
              ) : (
                <>
                  {shot ? <img src={shot.image_url} alt={`${c.id} ${view} render of the generated geometry`} width={150} height={150} style={{ width: '100%', height: 'auto', borderRadius: 6, background: '#eef1f5' }} /> : null}
                  <p style={{ margin: '6px 0 2px' }} title="Model or metric score; subjective, not an engineering result">
                    Visual {c.visual ? `${c.visual.overall.toFixed(1)}/10` : 'n/a'} <span className="rv-hint">(subjective)</span>
                  </p>
                  {claims ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      <span className={`rv-badge rv-badge--${badgeTone(claims.geometric_validity)}`}>geometry {claims.geometric_validity}</span>
                      <span className={`rv-badge rv-badge--${badgeTone(claims.electrical)}`}>electrical {claims.electrical.replace(/_/g, ' ')}</span>
                      <span className={`rv-badge rv-badge--${badgeTone(claims.buildability)}`} data-testid={`buildability-${c.id}`}>{claims.buildability.replace(/_/g, ' ')}</span>
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    <button type="button" className={`rv-btn rv-btn--small${c.id === selectedId ? '' : ' rv-btn--primary'}`} disabled={c.id === selectedId} data-testid={`choose-${c.id}`} onClick={() => onChoose(c)}>
                      {c.id === selectedId ? 'Selected' : 'Choose'}
                    </button>
                    {onInspect ? <button type="button" className="rv-btn rv-btn--small" onClick={() => onInspect(c)}>Findings</button> : null}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
