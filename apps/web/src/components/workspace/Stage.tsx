'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buyLines, formatMoney, makerLabel, partRows } from '../../lib/flow/derive';
import type { BuildPlan, CatalogComponent, StageEvent } from '../../lib/rivet/types';
import { Icon } from '../system/Icon';
import { RoverScene } from '../three/RoverScene';
import type { PartSelectionApi } from '../three/interactions';
import { BUILD_PHASES, partNames, phaseStates, rolePlain } from '../start/shared';
import type { SessionStatus } from './session';

export type StageMode = 'assembled' | 'exploded' | 'step';

export interface StageView {
  mode: StageMode;
  /** Assembly step shown in step mode (1-based). */
  step: number;
  wires: boolean;
  body: boolean;
}

const MIN_LOADING_MS = 1400;

export const DEFAULT_VIEW: StageView = { mode: 'assembled', step: 1, wires: false, body: true };

/**
 * The middle of the workspace: the build in 3D. While Rivet is still reading or building it shows a
 * drafting table with the real progress of the job; a rebuild keeps the last model on screen, dimmed,
 * under the same progress. A new build plays its assembly once, then settles assembled.
 */
export function Stage({
  plan,
  catalog,
  status,
  stageText,
  errorMessage,
  events,
  live,
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
  events: readonly StageEvent[];
  live: boolean;
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
  const replay = useReplay(plan, busy);
  const [reset, setReset] = useState(0);
  // Until a model has been on screen once, loading is the drafting table; after that, a rebuild dims the last model.
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (plan && !busy) setSeen(true);
  }, [plan, busy]);
  const drafting = busy && (!plan || !seen);

  const rows = useMemo(() => (plan ? partRows(plan, catalog) : []), [plan, catalog]);
  const names = useMemo(() => partNames(rows), [rows]);
  const lines = useMemo(() => (plan ? buyLines(plan, catalog) : []), [plan, catalog]);
  const selected = selection.selectedInstanceId ? rows.find((r) => r.instanceId === selection.selectedInstanceId) ?? null : null;
  const selectedLine = selected ? lines.find((l) => l.catalogId === selected.catalogId) ?? null : null;

  const mode: StageMode = replay !== null ? 'step' : view.mode;
  const step = replay ?? Math.min(Math.max(view.step, 1), Math.max(stepCount, 1));
  const stepInfo = plan?.assembly_steps.find((s) => s.step === step) ?? null;

  return (
    <div className="ws-stage" data-testid="workspace-stage" data-state={busy ? 'busy' : failed ? 'failed' : 'ready'}>
      {plan ? (
        <div className="ws-stage__canvas" data-dim={busy || undefined} data-hidden={drafting || undefined}>
          <RoverScene
            plan={plan}
            catalog={catalog}
            selection={selection}
            themeMode="dark"
            assemblyMode={mode}
            assemblyProgress={mode === 'exploded' ? 1 : undefined}
            assemblyStep={step}
            ghostFutureSteps
            showWiring={view.wires && mode !== 'exploded'}
            enclosure={view.body ? 'ghost' : 'none'}
            showGrid
            resetSignal={reset}
          />
        </div>
      ) : null}

      {drafting ? <DraftingTable status={status} stageText={stageText} events={events} live={live} names={names} /> : null}
      {busy && !drafting ? (
        <div className="ws-stage__veil" role="status" aria-live="polite" data-testid="workspace-rebuilding">
          <span className="ws-spin" aria-hidden="true" />
          <span>{stageText}</span>
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

      {plan && !busy ? (
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

/** The step being replayed after a new build arrives, or null once it has settled. */
function useReplay(plan: BuildPlan | null, busy: boolean): number | null {
  const key = plan && !busy ? `${plan.build_id}@${plan.revision}` : null;
  const count = plan?.assembly_steps.length ?? 0;
  const [state, setState] = useState<{ key: string | null; step: number | null }>({ key: null, step: null });

  useEffect(() => {
    if (!key || count === 0) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setState({ key, step: null });
      return;
    }
    let current = 1;
    setState({ key, step: 1 });
    const t = window.setInterval(() => {
      current += 1;
      if (current > count) {
        window.clearInterval(t);
        setState({ key, step: null });
      } else setState({ key, step: current });
    }, 260);
    return () => window.clearInterval(t);
  }, [key, count]);

  return state.key === key ? state.step : null;
}

/* ── Loading: a drafting table with the job's real progress ── */

function DraftingTable({
  status,
  stageText,
  events,
  live,
  names,
}: {
  status: SessionStatus;
  stageText: string;
  events: readonly StageEvent[];
  live: boolean;
  names: ReadonlyMap<string, string>;
}) {
  const phases = useMemo(
    () => phaseStates(events, { live: live || status !== 'failed', finished: false, failed: false, fixture: false, names }),
    [events, live, status, names],
  );
  return (
    <div className="ws-draft" role="status" aria-live="polite" aria-busy="true" data-testid="workspace-loading">
      <div className="ws-draft__grid" aria-hidden="true" />
      <div className="ws-draft__scan" aria-hidden="true" />
      <svg className="ws-draft__model" viewBox="0 0 240 180" aria-hidden="true">
        {/* An isometric chassis drawing itself: base plate, wheels, board, sensor. */}
        <path className="ws-draft__line" style={{ ['--d' as string]: '0s' }} d="M40 100 L120 60 L200 100 L120 140 Z" />
        <path className="ws-draft__line" style={{ ['--d' as string]: '0.25s' }} d="M40 100 L40 112 L120 152 L200 112 L200 100" />
        <path className="ws-draft__line" style={{ ['--d' as string]: '0.25s' }} d="M120 140 L120 152" />
        <ellipse className="ws-draft__line" style={{ ['--d' as string]: '0.6s' }} cx="62" cy="122" rx="12" ry="16" />
        <ellipse className="ws-draft__line" style={{ ['--d' as string]: '0.7s' }} cx="178" cy="122" rx="12" ry="16" />
        <path className="ws-draft__line ws-draft__line--accent" style={{ ['--d' as string]: '1s' }} d="M92 92 L124 76 L152 90 L120 106 Z" />
        <path className="ws-draft__line ws-draft__line--accent" style={{ ['--d' as string]: '1.3s' }} d="M150 72 L170 62 L182 68 L162 78 Z M162 78 L162 86 M150 72 L150 80" />
        <path className="ws-draft__line ws-draft__line--wire" style={{ ['--d' as string]: '1.6s' }} d="M124 76 C 140 60, 150 58, 166 66" />
      </svg>
      <div className="ws-draft__panel">
        <p className="ws-draft__status">
          <span className="ws-spin" aria-hidden="true" />
          <span data-testid="workspace-stage-text">{status === 'ready' ? 'Putting it together…' : stageText}</span>
        </p>
        <ol className="ws-draft__phases">
          {BUILD_PHASES.map((p) => {
            const state =
              status === 'ready' ? 'done' : status === 'reading' ? (p.id === 'understand' ? 'running' : 'pending') : phases[p.id].status;
            return (
              <li key={p.id} data-state={state}>
                <span className="ws-draft__mark" aria-hidden="true">
                  {state === 'done' ? <Icon name="check" size={11} /> : null}
                </span>
                <span>{p.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
