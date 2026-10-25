'use client';

import type { LayerMode, LayerState } from './GeneratedAssembly';

const LABELS: Array<[keyof LayerState, string]> = [
  ['fabricated', 'Fabricated'],
  ['purchased', 'Purchased'],
  ['concept_visual', 'Visual only'],
  ['internal', 'Inside parts'],
];
const NEXT: Record<LayerMode, LayerMode> = { visible: 'ghost', ghost: 'hidden', hidden: 'visible' };

/** Show / ghost / hide each body class, plus the explode amount. */
export function DesignLayers({ layers, onChange, explode, onExplode }: { layers: LayerState; onChange: (l: LayerState) => void; explode: number; onExplode: (v: number) => void }) {
  return (
    <div data-testid="design-layers" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {LABELS.map(([key, label]) => (
        <button key={key} type="button" className="rv-chip" data-testid={`layer-${key}`} data-mode={layers[key]} aria-pressed={layers[key] !== 'hidden'}
          onClick={() => onChange({ ...layers, [key]: NEXT[layers[key]] })} title="Click to cycle: visible, ghost, hidden">
          {label}: {layers[key]}
        </button>
      ))}
      <label className="rv-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Explode
        <input type="range" min={0} max={1} step={0.05} value={explode} data-testid="design-explode" onChange={(e) => onExplode(Number(e.target.value))} />
      </label>
    </div>
  );
}
