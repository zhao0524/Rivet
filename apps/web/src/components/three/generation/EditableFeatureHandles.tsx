'use client';

import { useState } from 'react';
import type { DesignPart } from '../../../lib/rivet/design-v2-types';

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

/** Inspector for a selected body: real dimensions, class, mass provenance, features, and a
 * targeted change request that is compiled into a typed geometry patch on the server. */
export function EditableFeatureHandles({ part, onRequestChange, busy }: { part: DesignPart | null; onRequestChange: (instruction: string, bodyIds: string[]) => void; busy?: boolean }) {
  const [text, setText] = useState('');
  if (!part) return <p className="rv-hint">Select a part in the 3D view to inspect it.</p>;
  const lb = part.local_bounds_mm as { min: number[]; max: number[] } | undefined;
  const size = lb ? lb.max.map((v, i) => v - lb.min[i]) : null;
  const mass = part.mass as { mass_g?: number | null; source?: string } | null | undefined;
  const features = (part.features as Array<{ id: string; type: string; status: string; note?: string | null }> | undefined) ?? [];
  const catalog = part.catalog as { recipe?: string; geometry_source?: string; mesh_source_verified?: boolean } | null | undefined;
  return (
    <section aria-label="Selected part" data-testid="part-inspector-v2" className="rv-details" style={{ padding: 10 }}>
      <h3 style={{ margin: 0 }}>{String(part.name ?? part.body_id)}</h3>
      <p className="rv-hint" style={{ margin: '2px 0 8px' }}>
        {part.kind === 'purchased' ? `Purchased: ${String(part.catalog_id)}` : part.kind === 'fabricated' ? `Fabricated (${String(part.manufacturing)})` : 'Visual only (not a buildable part)'}
      </p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', margin: 0 }}>
        {size ? (<><dt>Size</dt><dd data-testid="part-size">{size.map(fmt).join(' x ')} mm</dd></>) : null}
        <dt>Mass</dt><dd>{mass?.mass_g != null ? `${fmt(mass.mass_g)} g (${mass.source})` : 'unknown'}</dd>
        <dt>Geometry</dt><dd>{String(part.geometry_source ?? '')}{catalog ? ` (${catalog.recipe}; manufacturer CAD not verified)` : ''}</dd>
        <dt>Closed solid</dt><dd>{part.watertight ? 'yes' : 'no'}</dd>
      </dl>
      {features.length ? (
        <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
          {features.map((f) => <li key={f.id}>{f.type} {f.id}: {f.status}{f.note ? ` (${f.note})` : ''}</li>)}
        </ul>
      ) : null}
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) onRequestChange(text.trim(), [part.body_id]); }} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input className="rv-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Change the ${String(part.name ?? 'part').toLowerCase()}...`} aria-label="Change this part" disabled={busy} />
        <button type="submit" className="rv-btn" disabled={busy || !text.trim()}>Apply</button>
      </form>
    </section>
  );
}
