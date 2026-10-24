'use client';

import { useState } from 'react';
import type { AssemblyMode } from '../three/assembly';
import { DEFAULT_VIEW, type CameraView } from '../three/stage';
import { MenuButton, type MenuEntry } from '../ui/MenuButton';

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
  /** Human-readable name of the selected part, shown next to its Isolate/Hide actions. */
  selectedLabel?: string | null;
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

/**
 * Scene toolbar: a few primary controls (view preset, fit, explode, wireframe) plus a
 * "View" menu for everything else. Part actions appear only while a part is selected.
 */
export function Toolbar({
  assemblyMode,
  explodeAmount,
  onAssemblyModeChange,
  onExplodeAmountChange,
  selectedInstanceId,
  selectedLabel,
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
  const [presetId, setPresetId] = useState(CAMERA_PRESETS[0]!.id);

  const viewMenu: MenuEntry[] = [
    {
      id: 'steps',
      label: 'Step-by-step assembly',
      checked: assemblyMode === 'step',
      onSelect: () => onAssemblyModeChange(assemblyMode === 'step' ? 'assembled' : 'step'),
      testId: 'toolbar-toggle-steps',
    },
    { id: 'wiring', label: 'Wiring overlay', checked: showWiring, onSelect: onToggleWiring, testId: 'toolbar-toggle-wiring' },
    { id: 'mounts', label: 'Mount points', checked: showMounts, onSelect: onToggleMounts, testId: 'toolbar-toggle-mounts' },
    { id: 'grid', label: 'Grid', checked: showGrid, onSelect: onToggleGrid, testId: 'toolbar-toggle-grid' },
    {
      id: 'theme',
      label: 'Light stage',
      checked: themeMode === 'light',
      onSelect: onToggleTheme,
      testId: 'toolbar-toggle-theme',
    },
    { id: 'stats', label: 'Render stats', checked: showDebug, onSelect: onToggleDebug, testId: 'toolbar-toggle-debug' },
  ];
  if (isolatedInstanceId || hiddenCount > 0) {
    viewMenu.push({ kind: 'separator', id: 'parts-sep' });
    if (isolatedInstanceId) {
      viewMenu.push({ id: 'exit-isolate', label: 'Exit isolate', onSelect: onExitIsolation, testId: 'toolbar-exit-isolate' });
    }
    if (hiddenCount > 0) {
      viewMenu.push({
        id: 'show-all',
        label: `Show all parts (${hiddenCount} hidden)`,
        onSelect: onShowAllHidden,
        testId: 'toolbar-show-all',
      });
    }
  }

  return (
    <div role="toolbar" aria-label="3D view controls" data-testid="studio-toolbar" className="rv-toolbar">
      <div className="rv-toolbar__group">
        <select
          className="rv-select"
          aria-label="Camera view"
          data-testid="toolbar-camera-select"
          value={presetId}
          onChange={(e) => {
            const preset = CAMERA_PRESETS.find((p) => p.id === e.target.value);
            if (!preset) return;
            setPresetId(preset.id);
            onSelectCameraPreset(preset.view);
          }}
        >
          {CAMERA_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rv-btn"
          data-testid="toolbar-fit-camera"
          title="Reframe the camera to fit the whole assembly"
          onClick={onFitCamera}
        >
          Fit
        </button>
        <button
          type="button"
          className="rv-btn"
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
        >
          {isExploded ? `Exploded ${Math.round(explodeAmount * 100)}%` : 'Explode'}
        </button>
        {isExploded ? (
          <label className="rv-toolbar__label">
            <span>Spread</span>
            <input
              type="range"
              data-testid="toolbar-explode-slider"
              aria-label="Explode spread"
              min={0}
              max={1}
              step={0.01}
              value={explodeAmount}
              onChange={(e) => {
                const next = Number(e.target.value);
                onExplodeAmountChange(next);
                onAssemblyModeChange(next > 0 ? 'exploded' : 'assembled');
              }}
              style={{ width: 84 }}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="rv-btn"
          data-testid="toolbar-toggle-wireframe"
          aria-pressed={wireframe}
          onClick={onToggleWireframe}
        >
          Wireframe
        </button>
        <MenuButton label="View" entries={viewMenu} testId="toolbar-view-menu" />
      </div>

      {selectedInstanceId ? (
        <div className="rv-toolbar__group" role="group" aria-label="Selected part" data-testid="toolbar-selection">
          <span
            className="rv-toolbar__label"
            title={selectedLabel ?? selectedInstanceId}
            style={{ display: 'inline-block', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {selectedLabel ?? selectedInstanceId}
          </span>
          <button
            type="button"
            className="rv-btn"
            data-testid="toolbar-isolate"
            aria-pressed={!!isolatedInstanceId}
            onClick={() => (isolatedInstanceId ? onExitIsolation() : onToggleIsolateSelected())}
          >
            {isolatedInstanceId ? 'Exit isolate' : 'Isolate'}
          </button>
          <button
            type="button"
            className="rv-btn"
            data-testid="toolbar-hide-selected"
            aria-pressed={isSelectedHidden}
            onClick={onToggleHideSelected}
          >
            {isSelectedHidden ? 'Show' : 'Hide'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
