'use client';

import { useState } from 'react';
import type { DesignReference } from '../../../lib/rivet/design-v2-types';

/** Reference image (upload or generated concept) against a render of the actual geometry. */
export function VisualDiff({ references, shots }: { references: DesignReference[]; shots: Array<{ view: string; image_url: string }> }) {
  const [split, setSplit] = useState(50);
  const [refId, setRefId] = useState(references[0]?.id ?? '');
  const ref = references.find((r) => r.id === refId) ?? references[0];
  const shot = shots.find((s) => s.view === (ref?.view === 'perspective' ? 'perspective' : ref?.view)) ?? shots.find((s) => s.view === 'perspective');
  if (!ref || !shot) return <p className="rv-hint">No reference image to compare with.</p>;
  return (
    <figure data-testid="visual-diff" style={{ margin: 0 }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 8, background: '#eef1f5' }}>
        <img src={shot.image_url} alt="Render of the generated geometry" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        <img src={ref.image_url} alt={`Reference (${ref.source})`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', clipPath: `inset(0 ${100 - split}% 0 0)` }} />
      </div>
      <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Reference / render split" style={{ width: '100%' }} />
      <figcaption className="rv-hint">
        Left: {ref.source === 'upload' ? 'your reference' : ref.source === 'generated' ? 'generated reference art (not geometry)' : 'render'} ({ref.view}). Right: render of the generated 3D model ({shot.view}).
        {references.length > 1 ? (
          <select value={refId} onChange={(e) => setRefId(e.target.value)} style={{ marginLeft: 6 }}>
            {references.map((r) => <option key={r.id} value={r.id}>{r.view} ({r.source})</option>)}
          </select>
        ) : null}
      </figcaption>
    </figure>
  );
}
