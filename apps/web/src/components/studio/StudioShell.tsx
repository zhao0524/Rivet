'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { StudioActionMode } from '../../lib/plan-store';

export const STUDIO_MODES: ReadonlyArray<{ id: StudioActionMode; label: string; description: string }> = [
  { id: 'design', label: 'Design', description: 'Interactive 3D assembly, part selection, and edits' },
  { id: 'inspect', label: 'Inspect', description: 'Catalog provenance, BOM sourcing, and verification checks' },
  { id: 'wiring', label: 'Wiring', description: 'Electrical netlist overlay and controller pin mapping' },
  { id: 'assemble', label: 'Assemble', description: 'Step-by-step assembly scrubber and exploded view' },
  { id: 'simulate', label: 'Simulate', description: 'Simplified 2D differential-drive obstacle avoidance' },
];

type DrawerId = 'sidebar' | 'inspector';

export interface StudioShellProps {
  /** Left panel: prompt, components and revision edits (`<PartsPanel />`). A drawer below 1100px. */
  sidebar: ReactNode;
  /** Center primary viewport: 3D hardware stage (`<RoverScene />`). Fills all free space. */
  scene: ReactNode;
  /**
   * Right panel. Its content follows the active `mode` (there are no inspector tabs):
   * design = part details, inspect = BOM + verification, wiring = netlist and pin map,
   * assemble = steps, simulate = simulation model. A drawer below 1100px, a bottom sheet below 700px.
   */
  inspector: ReactNode;
  /** Assembly timeline strip under the scene (`<StepTimeline />`); pass it only in assemble mode. */
  timeline?: ReactNode;
  /** Replaces the scene in simulate mode (`<SimView />`); otherwise rendered under the scene. */
  bottomPanel?: ReactNode;
  /** Left part of the top bar: build identity. */
  header?: ReactNode;
  /** Right part of the top bar: primary actions (New build, Export). */
  headerActions?: ReactNode;
  /** Provenance / trust disclosure banner (`Saved synthetic example`, `Fallback`, etc.). One line. */
  banner?: ReactNode;
  /** Scene toolbar (`<Toolbar />`); floats over the top of the scene. */
  toolbar?: ReactNode;
  /** Layer over the workspace for image/prompt intake (`<BuildIntake />`); never shifts the layout. */
  intakeOverlay?: ReactNode;
  /** Active studio mode: the single navigation for what the studio shows. */
  mode?: StudioActionMode;
  onModeChange?: (mode: StudioActionMode) => void;
  /** Changing this value opens the inspector drawer on narrow screens (e.g. the selected part id). */
  inspectorOpenSignal?: unknown;
  className?: string;
}

/**
 * Designer-replaceable Studio layout shell (implementation.md §6 C6).
 * Fits the viewport (100dvh, panels scroll internally), exposes named slots with `data-slot`
 * attributes, and is styled by the `.rv-*` classes in `styles/globals.css` so visual changes
 * never touch 3D or engine logic.
 */
export function StudioShell({
  sidebar,
  scene,
  inspector,
  timeline,
  bottomPanel,
  header,
  headerActions,
  banner,
  toolbar,
  intakeOverlay,
  mode = 'design',
  onModeChange,
  inspectorOpenSignal,
  className,
}: StudioShellProps) {
  const [openDrawer, setOpenDrawer] = useState<DrawerId | null>(null);
  const toggleDrawer = (id: DrawerId) => setOpenDrawer((current) => (current === id ? null : id));

  useEffect(() => {
    if (inspectorOpenSignal) setOpenDrawer('inspector');
  }, [inspectorOpenSignal]);

  useEffect(() => {
    if (!openDrawer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenDrawer(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openDrawer]);

  const activeMode = STUDIO_MODES.find((m) => m.id === mode);

  return (
    <div
      className={className ? `rv-shell ${className}` : 'rv-shell'}
      data-rivet="studio-shell"
      data-layout="viewport"
      data-mode={mode}
    >
      <header data-slot="header" className="rv-topbar">
        <button
          type="button"
          className="rv-btn rv-panel-toggle"
          data-testid="shell-toggle-sidebar"
          aria-controls="rv-studio-sidebar"
          aria-expanded={openDrawer === 'sidebar'}
          onClick={() => toggleDrawer('sidebar')}
        >
          Parts
        </button>

        <div className="rv-topbar__header">{header}</div>

        <nav aria-label="Studio modes" data-slot="mode-nav" className="rv-modenav">
          {STUDIO_MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                className="rv-modenav__item"
                data-testid={`studio-mode-${m.id}`}
                aria-current={active ? 'page' : undefined}
                title={m.description}
                onClick={() => onModeChange?.(m.id)}
              >
                {m.label}
              </button>
            );
          })}
        </nav>

        <div className="rv-topbar__actions">{headerActions}</div>
        <span className="rv-topbar__break" aria-hidden="true" />

        <button
          type="button"
          className="rv-btn rv-panel-toggle"
          data-testid="shell-toggle-inspector"
          aria-controls="rv-studio-inspector"
          aria-expanded={openDrawer === 'inspector'}
          onClick={() => toggleDrawer('inspector')}
        >
          Details
        </button>
      </header>

      {banner ? (
        <div data-slot="banner" className="rv-banner">
          {banner}
        </div>
      ) : null}

      <div data-slot="workspace" className="rv-workspace">
        <aside
          id="rv-studio-sidebar"
          data-slot="sidebar"
          tabIndex={0}
          data-open={openDrawer === 'sidebar'}
          aria-label="Project controls and components"
          className="rv-panel rv-panel--left"
        >
          {sidebar}
        </aside>

        <main data-slot="center" className="rv-center" aria-label={activeMode?.description}>
          <div data-slot="scene" className="rv-scene">
            {mode === 'simulate' && bottomPanel ? bottomPanel : scene}
            {toolbar ? (
              <div data-slot="toolbar" className="rv-toolbar-slot">
                {toolbar}
              </div>
            ) : null}
          </div>

          {timeline ? (
            <div data-slot="timeline" className="rv-timeline">
              {timeline}
            </div>
          ) : null}

          {mode !== 'simulate' && bottomPanel ? (
            <div data-slot="bottom-panel" className="rv-timeline">
              {bottomPanel}
            </div>
          ) : null}
        </main>

        <aside
          id="rv-studio-inspector"
          data-slot="inspector"
          tabIndex={0}
          data-open={openDrawer === 'inspector'}
          aria-label={`${activeMode?.label ?? 'Studio'} details`}
          className="rv-panel rv-panel--right"
        >
          {inspector}
        </aside>

        <div
          className="rv-scrim"
          data-visible={openDrawer !== null}
          aria-hidden="true"
          onClick={() => setOpenDrawer(null)}
        />

        {intakeOverlay ? (
          <div data-slot="intake-overlay" className="rv-overlay">
            {intakeOverlay}
          </div>
        ) : null}
      </div>
    </div>
  );
}
