'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { partRows, type PartRow } from '../../lib/flow/derive';
import { projectPath } from '../../lib/flow/steps';
import type { BuildPlan, CatalogComponent, StageEvent } from '../../lib/rivet/types';
import { useProjectContext } from '../flow/ProjectShell';
import type { useFlowStore } from '../flow/FlowProvider';
import { Icon } from '../system/Icon';
import { useThemeMode } from '../system/ThemeToggle';
import { RoverScene } from '../three/RoverScene';
import { STAGE_LABEL, formatClock, jobErrorMessage, requestInput } from './shared';
import '../../styles/start.css';

/** The store's generate request (wire shape built in plan-store). */
type GenerateRequest = Parameters<ReturnType<typeof useFlowStore>['startGeneration']>[0];

/** Projects whose generation was started in this store session (survives navigation, not reload). */
const startedProjects = new Set<string>();

/**
 * A3 Generate: watch only. Starts the job once per project per session, shows the real event tape
 * and, once the plan has loaded, the parts arriving in assembly order. Done → Review; failed → Resume.
 */
export function GenerateScreen() {
  const router = useRouter();
  const { project, update, build } = useProjectContext();
  const store = build.store;
  const { job, jobEvents, plan, catalog } = store;
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const alreadyReady = project.phase === 'ready';

  const request = useMemo<GenerateRequest>(
    () => ({
      ...(project.intentId ? { intent_id: project.intentId } : {}),
      interpretation_choice: project.clarify.interpretation_choice ?? 'as_interpreted',
      input: requestInput(project),
      requirements: {
        max_budget: project.clarify.max_budget ?? null,
        currency: 'USD',
        max_length_mm: project.clarify.max_length_mm ?? null,
      },
    }),
    [project],
  );

  const requestRef = useRef(request);
  requestRef.current = request;

  async function start() {
    setStartError(null);
    setStarting(true);
    try {
      await store.startGeneration(requestRef.current);
    } catch (err) {
      startedProjects.delete(project.id);
      setStartError(err instanceof Error && err.message ? err.message : 'Generation could not start.');
    } finally {
      setStarting(false);
    }
  }
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    if (alreadyReady || startedProjects.has(project.id)) return;
    startedProjects.add(project.id);
    void startRef.current();
  }, [project.id, alreadyReady]);

  // Which plan is "the result": the job's build while generating, the project's build once ready.
  const resultBuildId = alreadyReady ? project.exampleId ?? project.buildId : job?.status === 'complete' ? job.build_id ?? null : null;
  const planReady = Boolean(resultBuildId) && plan.build_id === resultBuildId && !store.loading;
  const failed = startError !== null || job?.status === 'failed';
  const errorMessage = startError ?? jobErrorMessage(job);
  const done = alreadyReady || (job?.status === 'complete' && planReady);
  const fixture = store.dataSource.mode === 'fixture';

  const rows = useMemo(() => (planReady ? partRows(plan, catalog) : []), [planReady, plan, catalog]);
  const stepGroups = useMemo(() => (planReady ? groupByFirstStep(plan, rows) : []), [planReady, plan, rows]);

  function review() {
    if (!alreadyReady && job?.build_id) {
      update({
        phase: 'ready',
        buildId: job.build_id,
        revision: job.revision ?? plan.revision,
        furthestStep: 'review',
      });
    }
    router.push(projectPath(project.id, 'review'));
  }

  function cancel() {
    if (job) store.cancelJob(job.job_id);
    startedProjects.delete(project.id);
    update({ phase: 'clarify' });
    router.push(projectPath(project.id, 'clarify'));
  }

  function resume() {
    startedProjects.add(project.id);
    void start();
  }

  const status = done
    ? `Done: ${rows.length} parts`
    : failed
      ? 'Generation failed'
      : job?.status === 'complete'
        ? 'Loading the finished plan…'
        : job?.stage
          ? `Working: ${STAGE_LABEL[job.stage] ?? job.stage}`
          : 'Starting…';

  return (
    <div className="gen" data-testid="generate-screen">
      <header className="gen__head">
        <div>
          <h1 className="ui-h1">{done ? (fixture ? 'Loaded the saved example' : 'Your build is ready') : failed ? 'Generation stopped' : 'Generating your build'}</h1>
          <p className="gen__status" aria-live="polite" data-testid="generate-status">
            {!done && !failed ? <span className="ui-spinner" aria-hidden="true" /> : null}
            {done ? <Icon name="check" /> : null}
            {status}
          </p>
        </div>
      </header>

      <div className="gen__grid">
        <div className="gen__main">
          {planReady ? (
            <ReplayStage plan={plan} catalog={catalog} />
          ) : (
            <div className={failed ? 'gen__stage' : 'gen__stage gen__stage--wait'} data-testid="generate-stage">
              <div className="gen__wait">
                {failed ? <Icon name="alert" size={28} /> : <span className="ui-spinner" aria-hidden="true" />}
                <span>{failed ? 'Nothing was built.' : 'The model appears here once the first parts are chosen. Rivet reports stages, not percentages.'}</span>
              </div>
            </div>
          )}

          {failed && errorMessage ? (
            <p className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }} data-testid="generate-error">
              <Icon name="alert" style={{ flex: 'none', marginTop: 3 }} />
              <span>{errorMessage}</span>
            </p>
          ) : null}

          {done ? (
            <div className="ui-card ui-card--pad gen__done" data-testid="generate-done">
              <div className="gen__count">
                <strong>{rows.length}</strong>
                <span className="ui-muted">parts in “{plan.title}”</span>
              </div>
              {fixture ? (
                <p className="ui-notice" style={{ margin: 0 }} data-testid="generate-fixture-note">
                  <Icon name="info" style={{ flex: 'none', marginTop: 3 }} />
                  <span>Loaded the saved example: no live generation ran. This is a checked-in build, not a design made from your prompt.</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {planReady && stepGroups.length > 0 ? (
            <ol className="gen__parts" aria-label="Parts in assembly order" data-testid="generate-parts">
              {stepGroups.map((g, i) => (
                <li key={g.step} className="ui-card gen-step" style={{ '--i': i } as CSSProperties}>
                  <span className="gen-step__n" aria-hidden="true">
                    {g.step}
                  </span>
                  <span className="gen-step__title">{g.title}</span>
                  <ul className="gen-step__parts">
                    {g.rows.map((r, j) => (
                      <li key={r.instanceId} className="gen-part" style={{ '--i': i + j * 0.5 } as CSSProperties}>
                        {r.name}
                        <span className="gen-part__role">{r.role.replace(/_/g, ' ')}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : null}

          <div className="gen__cta">
            {!done ? (
              <button type="button" className="ui-btn ui-btn--link" onClick={cancel} data-testid="generate-cancel">
                Cancel and go back
              </button>
            ) : (
              <span />
            )}
            {done ? (
              <button type="button" className="ui-btn ui-btn--primary ui-btn--lg" onClick={review} data-testid="generate-review">
                Review
                <Icon name="arrowRight" />
              </button>
            ) : failed ? (
              <button type="button" className="ui-btn ui-btn--primary ui-btn--lg" onClick={resume} disabled={starting} data-testid="generate-resume">
                Resume
              </button>
            ) : null}
          </div>
        </div>

        <Tape events={jobEvents} />
      </div>
    </div>
  );
}

/* ── Event tape ────────────────────────────────────────── */

function Tape({ events }: { events: readonly StageEvent[] }) {
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [events.length]);

  return (
    <aside className="ui-card tape" aria-label="Generation events" data-testid="generate-tape">
      <div className="tape__head">
        <span>Events</span>
        <span className="ui-small ui-subtle">{events.length === 0 ? 'None yet' : `${events.length}`}</span>
      </div>
      <ol className="tape__list" aria-live="polite">
        {events.length === 0 ? <li className="tape__empty">Events from the engine appear here as they happen.</li> : null}
        {events.map((e, i) => (
          <li key={e.event_id} className="tape__row" ref={i === events.length - 1 ? endRef : undefined}>
            <span className="tape__stage" data-status={e.status}>
              {STAGE_LABEL[e.stage] ?? e.stage}
            </span>
            <span className="tape__msg">{e.message}</span>
            <span className="tape__meta">
              <span>{e.actor}</span>
              <span>{formatClock(e.timestamp)}</span>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/* ── Stage: the finished plan replayed in assembly order ── */

function ReplayStage({ plan, catalog }: { plan: BuildPlan; catalog: readonly CatalogComponent[] }) {
  const themeMode = useThemeMode();
  const stepCount = plan.assembly_steps.length;
  const [step, setStep] = useState(0);

  useEffect(() => {
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || stepCount === 0) {
      setStep(stepCount);
      return;
    }
    setStep(0);
    let current = 0;
    const id = window.setInterval(() => {
      current += 1;
      setStep(current);
      if (current >= stepCount) window.clearInterval(id);
    }, 450);
    return () => window.clearInterval(id);
  }, [plan.build_id, plan.revision, stepCount]);

  const finished = step >= stepCount;
  return (
    <div className="viewport" data-testid="generate-viewport">
      <RoverScene
        plan={plan}
        catalog={catalog}
        assemblyMode={finished ? 'assembled' : 'step'}
        assemblyStep={step}
        ghostFutureSteps
        themeMode={themeMode}
        showGrid
      />
      <span className="viewport__label">{finished ? 'Assembled' : `Assembly order: step ${step} of ${stepCount}`}</span>
    </div>
  );
}

/* ── Parts grouped by the step that first places them ──── */

interface StepGroup {
  step: number;
  title: string;
  rows: PartRow[];
}

function groupByFirstStep(plan: BuildPlan, rows: readonly PartRow[]): StepGroup[] {
  const byId = new Map(rows.map((r) => [r.instanceId, r]));
  const seen = new Set<string>();
  const groups: StepGroup[] = [];
  for (const s of [...plan.assembly_steps].sort((a, b) => a.step - b.step)) {
    const fresh = s.instance_ids.filter((id) => !seen.has(id) && byId.has(id));
    for (const id of fresh) seen.add(id);
    if (fresh.length > 0) groups.push({ step: s.step, title: s.title, rows: fresh.map((id) => byId.get(id)!) });
  }
  // Parts no step mentions still belong to the build.
  const rest = rows.filter((r) => !seen.has(r.instanceId));
  if (rest.length > 0) groups.push({ step: groups.length + 1, title: 'Also in the build', rows: rest });
  return groups;
}
