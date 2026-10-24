'use client';

import type { AssemblyMode } from '../three/assembly';
import { DEFAULT_VIEW, type CameraView } from '../three/stage';

export const CAMERA_PRESETS: ReadonlyArray<{ id: string; label: string; view: CameraView }> = [
  { id: 'hero', label: 'Hero 3/4', view: DEFAULT_VIEW },
  { id: 'front', label: 'Front', view: { azimuthDeg: 0, elevationDeg: 14 } },
  { id: 'side', label: 'Side', view: { azimuthDeg: 90, elevationDeg: 14 } },
  { id: 'top', label: 'Top', view: { azimuthDeg: 0, elevationDeg: 82 } },
];

export interface ToolbarProps {
  assemblyMode: AssemblyMode;
  explodeAmount: number;
  onAssemblyModeChange: (mode: AssemblyMode) => void;
  onExplodeAmountChange: (amount: number) => void;
  selectedInstanceId: string | null;
  isolatedInstanceId: string | null;
  hiddenCount: number;
  isSelectedHidden: boolean;
  onFitCamera: () => void;
  onSelectCameraPreset: (view: CameraView) => void;
  onToggleIsolateSelected: () => void;
  onExitIsolation: () => void;
  onToggleHideSelected: () => void;
  onShowAllHidden: () => void;
  showWiring: boolean;
  onToggleWiring: () => void;
  showMounts: boolean;
  onToggleMounts: () => void;
  wireframe: boolean;
  onToggleWireframe: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  showDebug: boolean;
  onToggleDebug: () => void;
  themeMode: 'dark' | 'light';
  onToggleTheme: () => void;
}

const btnStyle = (active = false, disabled = false) => ({
  background: active ? '#1d4ed8' : '#181d27',
  color: disabled ? '#475569' : active ? '#ffffff' : '#d1d5db',
  border: active ? '1px solid #3b82f6' : '1px solid #2b3445',
  borderRadius: 5,
  padding: '4px 9px',
  fontSize: 12,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

export function Toolbar({
  assemblyMode,
  explodeAmount,
  onAssemblyModeChange,
  onExplodeAmountChange,
  selectedInstanceId,
  isolatedInstanceId,
  hiddenCount,
  isSelectedHidden,
  onFitCamera,
  onSelectCameraPreset,
  onToggleIsolateSelected,
  onExitIsolation,
  onToggleHideSelected,
  onShowAllHidden,
  showWiring,
  onToggleWiring,
  showMounts,
  onToggleMounts,
  wireframe,
  onToggleWireframe,
  showGrid,
  onToggleGrid,
  showDebug,
  onToggleDebug,
  themeMode,
  onToggleTheme,
}: ToolbarProps) {
  const isExploded = assemblyMode === 'exploded' && explodeAmount > 0;

  return (
    <div
      role="toolbar"
      aria-label="3D Studio toolbar"
      data-testid="studio-toolbar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      {/* Camera & View Group */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          data-testid="toolbar-fit-camera"
          onClick={onFitCamera}
          style={btnStyle(false)}
          title="Reframe camera to fit assembly"
        >
          Fit view
        </button>
        {CAMERA_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            data-testid={`toolbar-camera-${preset.id}`}
            onClick={() => onSelectCameraPreset(preset.view)}
            style={btnStyle(false)}
          >
            {preset.label}
          </button>
        ))}

        <span style={{ width: 1, height: 18, background: '#283040', margin: '0 2px' }} />

        {/* Explode Controls */}
        <button
          type="button"
          data-testid="toolbar-toggle-explode"
          aria-pressed={isExploded}
          onClick={() => {
            if (isExploded) {
              onExplodeAmountChange(0);
              onAssemblyModeChange('assembled');
            } else {
              onExplodeAmountChange(explodeAmount > 0 ? explodeAmount : 0.75);
              onAssemblyModeChange('exploded');
            }
          }}
          style={btnStyle(isExploded)}
        >
          {isExploded ? `Exploded (${Math.round(explodeAmount * 100)}%)` : 'Explode'}
        </button>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: '#94a3b8',
          }}
        >
          <span>Spread</span>
          <input
            type="range"
            data-testid="toolbar-explode-slider"
            aria-label="Explode spread"
            min={0}
            max={1}
            step={0.01}
            value={assemblyMode === 'exploded' ? explodeAmount : 0}
            onChange={(e) => {
              const next = Number(e.target.value);
              onExplodeAmountChange(next);
              onAssemblyModeChange(next > 0 ? 'exploded' : 'assembled');
            }}
            style={{ width: 84 }}
          />
        </label>

        <button
          type="button"
          data-testid="toolbar-toggle-steps"
          aria-pressed={assemblyMode === 'step'}
          onClick={() =>
            onAssemblyModeChange(assemblyMode === 'step' ? 'assembled' : 'step')
          }
          style={btnStyle(assemblyMode === 'step')}
        >
          Step mode
        </button>
      </div>

      {/* Selection & Overlay Toggles */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          data-testid="toolbar-isolate"
          disabled={!selectedInstanceId && !isolatedInstanceId}
          aria-pressed={!!isolatedInstanceId}
          onClick={() => {
            if (isolatedInstanceId) onExitIsolation();
            else onToggleIsolateSelected();
          }}
          style={btnStyle(!!isolatedInstanceId, !selectedInstanceId && !isolatedInstanceId)}
        >
          {isolatedInstanceId ? 'Exit isolate' : 'Isolate part'}
        </button>

        <button
          type="button"
          data-testid="toolbar-hide-selected"
          disabled={!selectedInstanceId}
          onClick={onToggleHideSelected}
          style={btnStyle(isSelectedHidden, !selectedInstanceId)}
        >
          {isSelectedHidden ? 'Show part' : 'Hide part'}
        </button>

        {hiddenCount > 0 && (
          <button
            type="button"
            data-testid="toolbar-show-all"
            onClick={onShowAllHidden}
            style={btnStyle(false)}
          >
            Show all ({hiddenCount} hidden)
          </button>
        )}

        <span style={{ width: 1, height: 18, background: '#283040', margin: '0 2px' }} />

        <button
          type="button"
          data-testid="toolbar-toggle-wiring"
          aria-pressed={showWiring}
          onClick={onToggleWiring}
          style={btnStyle(showWiring)}
        >
          Wiring
        </button>
        <button
          type="button"
          data-testid="toolbar-toggle-mounts"
          aria-pressed={showMounts}
          onClick={onToggleMounts}
          style={btnStyle(showMounts)}
        >
          Mounts
        </button>
        <button
          type="button"
          data-testid="toolbar-toggle-wireframe"
          aria-pressed={wireframe}
          onClick={onToggleWireframe}
          style={btnStyle(wireframe)}
        >
          Wireframe
        </button>
        <button
          type="button"
          data-testid="toolbar-toggle-grid"
          aria-pressed={showGrid}
          onClick={onToggleGrid}
          style={btnStyle(showGrid)}
        >
          Grid
        </button>
        <button
          type="button"
          data-testid="toolbar-toggle-debug"
          aria-pressed={showDebug}
          onClick={onToggleDebug}
          style={btnStyle(showDebug)}
        >
          Stats
        </button>
        <button
          type="button"
          data-testid="toolbar-toggle-theme"
          onClick={onToggleTheme}
          style={btnStyle(themeMode === 'light')}
        >
          {themeMode === 'dark' ? 'Light stage' : 'Dark stage'}
        </button>
      </div>
    </div>
  );
}
