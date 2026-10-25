'use client';

import type { DesignEvent } from '../../../lib/rivet/design-v2-types';

const ICON: Record<string, string> = { ok: '●', warning: '▲', failed: '✕', running: '○', cancelled: '■' };
const QUIET = new Set(['body_ready']);

/** Stage tape of a generation: real events, with thumbnails of concept/view/render images. */
export function GenerationTimeline({ events }: { events: DesignEvent[] }) {
  const visible = events.filter((e) => !QUIET.has(e.stage));
  const bodies = events.filter((e) => e.stage === 'body_ready').length;
  return (
    <ol data-testid="generation-timeline" aria-label="Generation stages" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {bodies ? <li className="rv-hint" data-testid="bodies-built">{bodies} bodies built so far</li> : null}
      {visible.map((e) => {
        const images = e.references.filter((r) => /^(concept|view_|shot_perspective|reference)/.test(r.type));
        return (
          <li key={e.event_id} data-stage={e.stage} data-status={e.status} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span aria-hidden style={{ color: e.status === 'failed' ? 'var(--rv-danger-text)' : e.status === 'warning' ? 'var(--rv-warn-text)' : 'inherit' }}>{ICON[e.status] ?? '○'}</span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontWeight: 600 }}>{e.stage.replace(/_/g, ' ')}</strong>
              {e.candidate_id ? <span className="rv-hint"> · {e.candidate_id}</span> : null}
              <div className="rv-hint" style={{ overflowWrap: 'anywhere' }}>{e.message}</div>
              {images.length ? (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {images.slice(0, 4).map((r) => <img key={r.id} src={r.url} alt={r.type.replace(/_/g, ' ')} width={56} height={56} style={{ borderRadius: 4, objectFit: 'cover', background: '#eef1f5' }} />)}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
