'use client';

import type { ReactNode } from 'react';
import type { StudioActionMode } from '../../lib/plan-store';

export const STUDIO_MODES: ReadonlyArray<{ id: StudioActionMode; label: string; description: string }> = [
  { id: 'design', label: 'Design', description: 'Interactive 3D assembly, part selection, and edits' },
  { id: 'inspect', label: 'Inspect', description: 'Catalog provenance, BOM sourcing, and verification checks' },
  { id: 'wiring', label: 'Wiring', description: 'Electrical netlist overlay and controller pin mapping' },
  { id: 'assemble', label: 'Assemble', description: 'Step-by-step assembly scrubber and exploded view' },
  { id: 'simulate', label: 'Simulate', description: 'Simplified 2D differential-drive obstacle avoidance' },
];

export interface StudioShellProps {
  /** Left panel: project controls, component tree, and revision edits (`<ProjectControls />` / `<PartsPanel />`). */
  sidebar: ReactNode;
  /** Center primary viewport: 3D hardware stage (`<RoverScene />`). */
  scene: ReactNode;
  /** Right panel: contextual part inspector, BOM, verification, and exports (`<PartInspector />` / `<Inspector />`). */
  inspector: ReactNode;
  /** Assembly timeline strip (`<AssemblyTimeline />` / `<StepTimeline />`). */
  timeline?: ReactNode;
  /** Bottom or simulation panel (`<SimulationPanel />` / `<SimView />`). */
  bottomPanel?: ReactNode;
  /** Top navigation / build identity bar. */
  header?: ReactNode;
  /** Provenance / trust disclosure banner (`Saved synthetic example`, `Fallback`, etc.). */
  banner?: ReactNode;
  /** Floating or top scene toolbar (`<Toolbar />`). */
  toolbar?: ReactNode;
  /** Optional modal/drawer for image/prompt intake (`<BuildIntake />`). */
  intakeOverlay?: ReactNode;
  /** Active studio action mode (`design | inspect | wiring | assemble | simulate`). */
  mode?: StudioActionMode;
  onModeChange?: (mode: StudioActionMode) => void;
  className?: string;
}

/**
 * Designer-replaceable Studio layout shell (implementation.md §6 C6).
 * Exposes predictable named slots (`sidebar`, `scene`, `inspector`, `timeline`, `bottomPanel`)
 * and `data-slot` attributes so visual styling can be updated without touching 3D or engine logic.
 */
export function StudioShell({
  sidebar,
  scene,
  inspector,
  timeline,
  bottomPanel,
  header,
  banner,
  toolbar,
  intakeOverlay,
  mode = 'design',
  onModeChange,
  className,
}: StudioShellProps) {
  return (
    <div
      className={className}
      data-rivet="studio-shell"
      data-mode={mode}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: '#0b0d11',
        color: '#e5e7eb',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {header ? (
        <header
          data-slot="header"
          style={{
            borderBottom: '1px solid #1f242d',
            background: '#11141b',
            padding: '10px 16px',
          }}
        >
          {header}
        </header>
      ) : null}

      {banner ? (
        <div
          data-slot="banner"
          style={{
            borderBottom: '1px solid #292524',
            background: '#1c1917',
            padding: '6px 16px',
          }}
        >
          {banner}
        </div>
      ) : null}

      {intakeOverlay ? (
        <div
          data-slot="intake-overlay"
          style={{
            borderBottom: '1px solid #1f242d',
            background: '#131720',
            padding: '16px',
          }}
        >
          {intakeOverlay}
        </div>
      ) : null}

      {/* Core 3-column Studio Grid */}
      <div
        data-slot="workspace"
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(270px, 320px) minmax(0, 1fr) minmax(320px, 400px)',
          minHeight: 0,
        }}
      >
        <aside
          data-slot="sidebar"
          aria-label="Project controls and components"
          style={{
            borderRight: '1px solid #1f242d',
            background: '#0f1218',
            overflowY: 'auto',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {sidebar}
        </aside>

        <main
          data-slot="center"
          style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 540,
            background: '#0b0d11',
            position: 'relative',
          }}
        >
          {toolbar ? (
            <div
              data-slot="toolbar"
              style={{
                borderBottom: '1px solid #1f242d',
                background: '#11151d',
                padding: '8px 12px',
              }}
            >
              {toolbar}
            </div>
          ) : null}

          <div
            data-slot="scene"
            style={{
              flex: 1,
              position: 'relative',
              minHeight: 420,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {mode === 'simulate' && bottomPanel ? bottomPanel : scene}
          </div>

          {timeline ? (
            <div
              data-slot="timeline"
              style={{
                borderTop: '1px solid #1f242d',
                background: '#10141c',
                padding: '10px 14px',
              }}
            >
              {timeline}
            </div>
          ) : null}

          {mode !== 'simulate' && bottomPanel ? (
            <div
              data-slot="bottom-panel"
              style={{
                borderTop: '1px solid #1f242d',
                background: '#0f131b',
                padding: '10px 14px',
              }}
            >
              {bottomPanel}
            </div>
          ) : null}
        </main>

        <aside
          data-slot="inspector"
          aria-label="Contextual hardware inspector"
          style={{
            borderLeft: '1px solid #1f242d',
            background: '#0f1218',
            overflowY: 'auto',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {inspector}
        </aside>
      </div>

      {/* Bottom Action Modes Bar (project.md §3) */}
      <footer
        data-slot="mode-bar"
        role="navigation"
        aria-label="Studio modes"
        style={{
          borderTop: '1px solid #1f242d',
          background: '#11141b',
          padding: '8px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {STUDIO_MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                data-testid={`studio-mode-${m.id}`}
                aria-pressed={active}
                title={m.description}
                onClick={() => onModeChange?.(m.id)}
                style={{
                  background: active ? '#2563eb' : '#181c26',
                  color: active ? '#ffffff' : '#cbd5e1',
                  border: active ? '1px solid #3b82f6' : '1px solid #283040',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          {STUDIO_MODES.find((m) => m.id === mode)?.description}
        </div>
      </footer>
    </div>
  );
}
