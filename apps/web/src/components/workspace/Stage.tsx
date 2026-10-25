'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buyLines, formatMoney, makerLabel, partRows } from '../../lib/flow/derive';
import { isConceptPlan } from '../../lib/rivet/honesty';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet/types';
import { Icon } from '../system/Icon';
import { RoverScene } from '../three/RoverScene';
import type { PartSelectionApi } from '../three/interactions';
import { rolePlain } from '../start/shared';
import { useComeTogether } from './comeTogether';
import type { SessionStatus } from './session';

export type StageMode = 'assembled' | 'exploded' | 'step';

export interface StageView {
  mode: StageMode;
  /** Assembly step shown in step mode (1-based). */
  step: number;
  wires: boolean;
  body: boolean;
}

const MIN_LOADING_MS = 3000;

/** A clearer floor grid than the default, to read sizes against. */
const WORKSPACE_THEME = { gridCell: '#2c323b', gridSection: '#48505c' } as const;

export const DEFAULT_VIEW: StageView = { mode: 'assembled', step: 1, wires: false, body: true };

/**
 * The middle of the workspace: the build in 3D. While Rivet is still working, the stage stays clear.
 * When the build arrives it plays its assembly once, then settles assembled. A rebuild keeps the last
 * model on screen, dimmed, until the new one is ready.
 */
export function Stage({
  plan,
  catalog,
  status,
  stageText,
  errorMessage,
  selection,
  view,
  onView,
  onRetry,
  retryLabel = 'Try again',
}: {
  plan: BuildPlan | null;
  catalog: readonly CatalogComponent[];
  status: SessionStatus;
  stageText: string;
  errorMessage: string | null;
  selection: PartSelectionApi;
  view: StageView;
  onView: (view: StageView) => void;
  onRetry: () => void;
  retryLabel?: string;
}) {
  // A saved example answers instantly; holding the loading state a moment makes the hand-off read as a
  // transition, not a flicker.
  const busy = useHeld(status === 'reading' || status === 'generating' || status === 'loading', MIN_LOADING_MS);
  const failed = status === 'failed';
  const stepCount = plan?.assembly_steps.length ?? 0;
  const replay = useReplay(plan);
  const [reset, setReset] = useState(0);

  const rows = useMemo(() => (plan ? partRows(plan, catalog) : []), [plan, catalog]);
  const lines = useMemo(() => (plan ? buyLines(plan, catalog) : []), [plan, catalog]);
  const selected = selection.selectedInstanceId ? rows.find((r) => r.instanceId === selection.selectedInstanceId) ?? null : null;
  const selectedLine = selected ? lines.find((l) => l.catalogId === selected.catalogId) ?? null : null;

  const mode: StageMode = replay !== null ? 'step' : view.mode;
  const step = replay ? replay.step : Math.min(Math.max(view.step, 1), Math.max(stepCount, 1));
  const stepInfo = plan?.assembly_steps.find((s) => s.step === step) ?? null;

  return (
    <div className="ws-stage" data-testid="workspace-stage" data-state={busy ? 'busy' : failed ? 'failed' : 'ready'}>
      {plan ? (
        <div className="ws-stage__canvas" data-dim={busy && !replay ? '' : undefined}>
          <RoverScene
            plan={plan}
            catalog={catalog}
            selection={selection}
            themeMode="dark"
            assemblyMode={mode}
            assemblyProgress={replay ? replay.progress : mode === 'exploded' ? 1 : undefined}
            assemblyStep={step}
            ghostFutureSteps={!replay}
            showWiring={view.wires && mode !== 'exploded'}
            enclosure={view.body && !isConceptPlan(plan) ? 'ghost' : 'none'}
            showGrid
            themeOverrides={WORKSPACE_THEME}
            resetSignal={reset}
          />
        </div>
      ) : null}

      {!plan && busy && !failed ? (
        <div className="ws-stage__veil" role="status" aria-live="polite" aria-busy="true" data-testid="workspace-loading">
          <span className="ws-spin" aria-hidden="true" />
          <span data-testid="workspace-stage-text">{stageText}</span>
        </div>
      ) : null}

      {failed ? (
        <div className="ws-stage__empty" role="alert" data-testid="workspace-failed">
          <Icon name="alert" size={22} />
          <p className="ws-stage__empty-title">Rivet stopped before the model was ready</p>
          {errorMessage ? <p className="ws-stage__empty-text">{errorMessage}</p> : null}
          <button type="button" className="ws-btn ws-btn--primary" onClick={onRetry} data-testid="workspace-retry">
            {retryLabel}
          </button>
        </div>
      ) : null}

      {plan && !busy && !replay ? (
        <>
          <div className="ws-stage__tools" role="toolbar" aria-label="View">
            <div className="ws-seg" role="radiogroup" aria-label="How to show the build">
              {(
                [
                  ['assembled', 'Assembled'],
                  ['exploded', 'Exploded'],
                  ['step', 'Steps'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={mode === id}
                  className="ws-seg__item"
                  onClick={() => onView({ ...view, mode: id })}
                  data-testid={`workspace-view-${id}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ws-stage__toggles">
              <Toggle on={view.wires} onClick={() => onView({ ...view, wires: !view.wires })} icon="bolt" label="Wires" testId="workspace-toggle-wires" />
              <Toggle on={view.body} onClick={() => onView({ ...view, body: !view.body })} icon="cube" label="Printed body" testId="workspace-toggle-body" />
              <button type="button" className="ws-icon-btn" onClick={() => setReset((n) => n + 1)} aria-label="Reset the camera" title="Reset the camera">
                <Icon name="replay" size={15} />
              </button>
            </div>
          </div>

          {mode === 'step' && stepCount > 0 ? (
            <div className="ws-stepbar" data-testid="workspace-stepbar">
              <button
                type="button"
                className="ws-icon-btn"
                onClick={() => onView({ ...view, mode: 'step', step: Math.max(1, step - 1) })}
                disabled={replay !== null || step <= 1}
                aria-label="Previous step"
              >
                <Icon name="arrowLeft" size={15} />
              </button>
              <div className="ws-stepbar__text" aria-live="polite">
                <span className="ws-stepbar__count">
                  Step {step} of {stepCount}
                </span>
                <span className="ws-stepbar__title">{stepInfo?.title ?? ''}</span>
              </div>
              <button
                type="button"
                className="ws-icon-btn"
                onClick={() => onView({ ...view, mode: 'step', step: Math.min(stepCount, step + 1) })}
                disabled={replay !== null || step >= stepCount}
                aria-label="Next step"
              >
                <Icon name="arrowRight" size={15} />
              </button>
            </div>
          ) : null}

          {selected ? (
            <div className="ws-picked" data-testid="workspace-picked">
              <div className="ws-picked__head">
                <span className="ws-picked__role">{rolePlain(selected.role)}</span>
                <button type="button" className="ws-icon-btn ws-icon-btn--sm" onClick={() => selection.clearSelection()} aria-label="Clear selection">
                  <Icon name="close" size={13} />
                </button>
              </div>
              <p className="ws-picked__name">{selected.name}</p>
              <p className="ws-picked__meta">
                {makerLabel(selected.manufacturer)}
                {selectedLine?.unitPrice != null && plan ? ` · ${formatMoney(selectedLine.unitPrice, plan.bom.currency)}` : ''}
                {selectedLine?.url ? ` · ${selectedLine.vendor}` : ''}
              </p>
            </div>
          ) : (
            <p className="ws-stage__hint" aria-hidden="true">
              Drag to turn · scroll to zoom · click a part
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function Toggle({ on, onClick, icon, label, testId }: { on: boolean; onClick: () => void; icon: 'bolt' | 'cube'; label: string; testId: string }) {
  return (
    <button type="button" className="ws-toggle" aria-pressed={on} onClick={onClick} data-testid={testId}>
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );
}

/** True while `on`, and for at least `ms` after it first turned on. */
function useHeld(on: boolean, ms: number): boolean {
  const since = useRef<number | null>(null);
  const [held, setHeld] = useState(on);
  if (on && since.current === null) since.current = Date.now();
  useEffect(() => {
    if (on) {
      setHeld(true);
      return;
    }
    const started = since.current;
    since.current = null;
    const left = started === null ? 0 : ms - (Date.now() - started);
    if (left <= 0) {
      setHeld(false);
      return;
    }
    const t = window.setTimeout(() => setHeld(false), left);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return on || held;
}

/** The step being seated after a new build arrives, or null once it has settled. */
function useReplay(plan: BuildPlan | null): { step: number; progress: number } | null {
  const token = plan ? `${plan.build_id}@${plan.revision}` : null;
  const count = plan?.assembly_steps.length ?? 0;
  const play = useComeTogether(count, token);
  if (!plan || play.done) return null;
  return { step: play.step, progress: play.progress };
}

