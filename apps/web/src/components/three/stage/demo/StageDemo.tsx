'use client';

import { useState } from 'react';
import { RivetStage } from '../RivetStage';
import { studioLightStageTheme } from '../theme';
import { DemoAssembly, type DemoPreset } from './DemoAssembly';

const PRESETS: DemoPreset[] = ['assembly', 'wide', 'tall', 'small', 'empty'];

/** Plain local harness for the stage; styling is intentionally minimal. */
export function StageDemo() {
  const [preset, setPreset] = useState<DemoPreset>('assembly');
  const [resetSignal, setResetSignal] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [active, setActive] = useState(true);
  const [light, setLight] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 480 }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, flexWrap: 'wrap', font: '13px system-ui, sans-serif' }}>
        {PRESETS.map((p) => (
          <button key={p} data-testid={`preset-${p}`} aria-pressed={preset === p} onClick={() => setPreset(p)}>
            {p}
          </button>
        ))}
        <button data-testid="reset" onClick={() => setResetSignal((n) => n + 1)}>
          reset camera
        </button>
        <button data-testid="grid" aria-pressed={showGrid} onClick={() => setShowGrid((v) => !v)}>
          grid
        </button>
        <button data-testid="active" aria-pressed={active} onClick={() => setActive((v) => !v)}>
          active
        </button>
        <button data-testid="theme" aria-pressed={light} onClick={() => setLight((v) => !v)}>
          light theme
        </button>
        <span data-testid="selected">selected: {selected ?? 'none'}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <RivetStage
          resetSignal={resetSignal}
          showGrid={showGrid}
          active={active}
          theme={light ? studioLightStageTheme : undefined}
          onBackgroundClick={() => setSelected(null)}
        >
          <DemoAssembly preset={preset} selected={selected} onSelect={setSelected} />
        </RivetStage>
      </div>
    </div>
  );
}
