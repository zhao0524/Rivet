'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { partRows } from '../../lib/flow/derive';
import { projectPath } from '../../lib/flow/steps';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet/types';
import { useProjectContext } from '../flow/ProjectShell';
import type { useFlowStore } from '../flow/FlowProvider';
import { Icon } from '../system/Icon';
import { Thinking } from '../system/Thinking';
import { TreeView, type TreeNode } from '../system/TreeView';
import { useThemeMode } from '../system/ThemeToggle';
import { RoverScene } from '../three/RoverScene';
import { usePartSelection, type PartSelectionApi } from '../three/interactions';
import {
  BUILD_PHASES,
  attentionChecks,
  behaviorPlain,
  codePlain,
  controllerPlain,
  decisionSummary,
  eventSteps,
  eventsElapsedMs,
  jobErrorMessage,
  partNames,
  phaseStates,
  plainPartGroups,
  requestInput,
  rolePlain,
  stagePhrase,
  type BuildPhaseId,
} from './shared';
import '../../styles/start.css';

/** The store's generate request (wire shape built in plan-store). */
type GenerateRequest = Parameters<ReturnType<typeof useFlowStore>['startGeneration']>[0];

/** Projects whose generation was started in this store session (survives navigation, not reload). */
const startedProjects = new Set<string>();
/** The project the store's current job and events belong to. */
let jobOwner: string | null = null;

/**
 * A3 Generate: watch only. Starts the job once per project per session and shows what Rivet is
 * doing: a Thinking trace of the real job events, a tree of the build taking shape, and the 3D
 * replay once the plan has loaded. Done → Review; failed → Resume.
 */
export function GenerateScreen() {
  const router = useRouter();
  const { project, update, build } = useProjectContext();
  const store = build.store;
  const { plan, catalog } = store;
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const alreadyReady = project.phase === 'ready';
  const fixture = store.dataSource.mode === 'fixture';

  // The job and its events only count when this project started them.
  const own = jobOwner === project.id;
  const job = own ? store.job : null;
  const jobEvents = useMemo(() => (own ? store.jobEvents : []), [own, store.jobEvents]);

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
    jobOwner = project.id;
    try {
      await store.startGeneration(requestRef.current);
    } catch (err) {
      startedProjects.delete(project.id);
      setStartError(err instanceof Error && err.message ? err.message : 'Rivet could not start.');
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
  const live = !done && !failed;

  const rows = useMemo(() => (planReady ? partRows(plan, catalog) : []), [planReady, plan, catalog]);
  const names = useMemo(() => partNames(rows), [rows]);
  const steps = useMemo(() => eventSteps(jobEvents, { live, fixture, names }), [jobEvents, live, fixture, names]);
  const elapsedMs = useMemo(() => eventsElapsedMs(jobEvents), [jobEvents]);
  const decided = useMemo(() => (planReady ? decisionSummary(plan, catalog) : []), [planReady, plan, catalog]);

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

  // One line that is always true about this moment.
  const status = done
    ? `Done: ${rows.length} parts, ready to review`
    : failed
      ? `Something went wrong: ${errorMessage ?? 'Rivet stopped without saying why.'}`
      : job?.status === 'complete'
        ? 'Loading the finished build…'
        : job?.stage && job.stage !== 'complete'
          ? `${stagePhrase(job.stage)}…`
          : 'Waiting for Rivet to start…';

  const selection = usePartSelection(planReady ? plan : null, { escapeToClear: false });

  return (
    <div className="gen" data-testid="generate-screen">
      <header className="gen__head">
        <div className="gen__headtext">
          <p className="ui-eyebrow">{done ? (fixture ? 'Saved example' : 'Design finished') : failed ? 'Stopped' : 'Designing'}</p>
          <h1 className="ui-h1 gen__title">{project.title}</h1>
          <p className="gen__status" aria-live="polite" data-testid="generate-status" data-state={done ? 'done' : failed ? 'failed' : 'running'}>
            {live ? <span className="ui-spinner" aria-hidden="true" /> : null}
            {done ? <Icon name="check" /> : null}
            {failed ? <Icon name="alert" /> : null}
            <span>{status}</span>
          </p>
        </div>
        <div className="gen__cta">
          {!done ? (
            <button type="button" className="ui-btn ui-btn--link" onClick={cancel} data-testid="generate-cancel">
              Cancel and go back
            </button>
          ) : null}
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
      </header>

      {failed && errorMessage ? (
        <p className="ui-notice ui-notice--danger gen__notice" role="alert" data-testid="generate-error">
          <Icon name="alert" style={{ flex: 'none', marginTop: 3 }} />
          <span>{errorMessage}</span>
        </p>
      ) : null}

      <div className="gen__grid">
        <section className="ui-card gen__panel gen__trace" aria-labelledby="generate-trace-title" data-testid="generate-trace">
          <h2 id="generate-trace-title" className="ui-h3">
            {live ? 'Designing your robot' : failed ? 'What Rivet did before it stopped' : "Here's what Rivet did"}
          </h2>

          {fixture && (done || jobEvents.length > 0) ? (
            <p className="ui-notice gen__notice" data-testid="generate-fixture-note">
              <Icon name="info" style={{ flex: 'none', marginTop: 3 }} />
              <span>This is a saved example. Rivet didn&apos;t design it from your words.</span>
            </p>
          ) : null}

          {live || jobEvents.length > 0 ? (
            <Thinking
              running={live}
              steps={steps}
              elapsedMs={elapsedMs}
              doneLabel={jobEvents.length === 1 && fixture ? 'Loaded instantly' : undefined}
              waitingText="Each step Rivet takes shows up here as it happens."
              testId="generate-thinking"
            />
          ) : (
            <p className="ui-small ui-muted gen__nolog" data-testid="generate-nolog">
              No step-by-step log for this build. Rivet only keeps it while the page stays open.
            </p>
          )}

          {planReady && decided.length > 0 ? (
            <div className="gen__decided" data-testid="generate-done">
              <h3 className="ui-eyebrow gen__decided-title">What it decided</h3>
              <p className="ui-small ui-subtle gen__decided-note">Read from the finished build, not live progress.</p>
              <ul className="gen__decisions">
                {decided.map((d) => (
                  <li key={d.id} data-testid={`generate-decided-${d.id}`}>
                    <Icon name="check" size={14} className="gen__decision-mark" />
                    <span>
                      <span className="gen__decision-text">{d.text}</span>
                      {d.detail ? <span className="gen__decision-detail">{d.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="gen__side" aria-labelledby="generate-tree-title">
          {planReady ? (
            <ReplayStage plan={plan} catalog={catalog} selection={selection} />
          ) : (
            <div className={failed ? 'gen__stage' : 'gen__stage gen__stage--wait'} data-testid="generate-stage">
              <div className="gen__wait">
                {failed ? <Icon name="alert" size={24} /> : <Icon name="cube" size={24} />}
                <span>{failed ? 'Nothing was built.' : 'The 3D model shows up here once Rivet has placed and checked the parts.'}</span>
              </div>
            </div>
          )}
          <div className="ui-card gen__panel gen__tree" data-testid="generate-tree-panel">
            <h2 id="generate-tree-title" className="ui-h3">
              Your build, piece by piece
            </h2>
            <BuildTree
              plan={planReady ? plan : null}
              catalog={catalog}
              prompt={project.prompt}
              fixture={fixture}
              events={jobEvents}
              live={live}
              finished={done}
              failed={failed}
              selection={selection}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── The build as a tree ───────────────────────────────── */

function BuildTree({
  plan,
  catalog,
  prompt,
  fixture,
  events,
  live,
  finished,
  failed,
  selection,
}: {
  plan: BuildPlan | null;
  catalog: readonly CatalogComponent[];
  prompt: string;
  fixture: boolean;
  events: Parameters<typeof phaseStates>[0];
  live: boolean;
  finished: boolean;
  failed: boolean;
  selection: PartSelectionApi;
}) {
  const rows = useMemo(() => (plan ? partRows(plan, catalog) : []), [plan, catalog]);
  const names = useMemo(() => partNames(rows), [rows]);
  const phases = useMemo(
    () => phaseStates(events, { live, finished, failed, fixture: fixture && finished, names }),
    [events, live, finished, failed, fixture, names],
  );

  const nodes = useMemo<TreeNode[]>(() => {
    const kids: Record<BuildPhaseId, TreeNode[] | undefined> = {
      understand: undefined,
      parts: undefined,
      place: undefined,
      check: undefined,
      code: undefined,
    };
    if (plan) {
      kids.understand = [
        ...(prompt.trim() ? [{ id: 'idea:prompt', label: `“${prompt.trim()}”`, detail: 'Your words', icon: 'edit' as const }] : []),
        {
          id: 'idea:title',
          label: plan.title,
          detail: fixture ? 'The saved example Rivet opened' : 'What Rivet is building',
          icon: 'sparkle' as const,
        },
      ];
      kids.parts = plainPartGroups(rows).map((g) => ({
        id: `group:${g.group}`,
        label: g.label,
        detail: g.rows.length === 1 ? '1 part' : `${g.rows.length} parts`,
        children: g.rows.map((r) => ({
          id: `part:${r.instanceId}`,
          label: r.name,
          detail: rolePlain(r.role),
          icon: 'cube' as const,
          testId: `generate-part-${r.instanceId}`,
        })),
      }));
      kids.place = [
        ...[...plan.assembly_steps]
          .sort((a, b) => a.step - b.step)
          .map((s) => ({ id: `step:${s.step}`, label: `${s.step}. ${s.title}`, icon: 'file' as const })),
        ...(plan.connections.length > 0
          ? [{ id: 'place:wires', label: `${plan.connections.length} wires join the parts`, icon: 'bolt' as const }]
          : []),
      ];
      const checks = attentionChecks(plan, names);
      const passed = plan.verification.findings.filter((f) => f.result === 'PASS').length;
      kids.check = [
        ...checks.map((c) => ({
          id: `check:${c.ruleId}`,
          label: c.title,
          detail: c.detail,
          icon: 'alert' as const,
          status: c.blocking ? ('failed' as const) : ('warning' as const),
          statusText: c.blocking ? 'Must be sorted out before you build' : 'Worth a look',
          testId: `generate-check-${c.ruleId}`,
        })),
        ...(passed > 0 ? [{ id: 'check:passed', label: passed === 1 ? '1 check passed' : `${passed} checks passed`, icon: 'check' as const, status: 'done' as const }] : []),
      ];
      const controller = rows.find((r) => r.role === 'controller');
      const behavior = behaviorPlain(plan);
      const code = codePlain(plan);
      kids.code = [
        ...(behavior && plan.firmware.compile_status !== 'not_supported' ? [{ id: 'code:behavior', label: behavior, detail: 'What the starter code does', icon: 'play' as const }] : []),
        ...(controller ? [{ id: 'code:board', label: `Runs on ${controllerPlain(controller.name)}`, icon: 'cube' as const }] : []),
        { id: 'code:status', label: code.text, detail: code.detail, icon: 'file' as const },
      ];
    }
    return BUILD_PHASES.map((p) => {
      const state = phases[p.id];
      const children = kids[p.id];
      return {
        id: `phase:${p.id}`,
        label: p.label,
        detail: plan && children && children.length > 0 ? undefined : state.detail,
        icon: 'folder' as const,
        status: state.status,
        children,
        selectable: false,
        testId: `generate-phase-${p.id}`,
      };
    });
  }, [plan, prompt, fixture, rows, names, phases]);

  // Open the phase that is working; once the plan is in, open the parts and the checks.
  const [open, setOpen] = useState<string[]>([]);
  const runningPhase = BUILD_PHASES.find((p) => phases[p.id].status === 'running')?.id;
  useEffect(() => {
    if (runningPhase) setOpen((o) => (o.includes(`phase:${runningPhase}`) ? o : [...o, `phase:${runningPhase}`]));
  }, [runningPhase]);
  const planKey = plan ? `${plan.build_id}@${plan.revision}` : null;
  useEffect(() => {
    if (!planKey) return;
    setOpen((o) => Array.from(new Set([...o, 'phase:parts', 'phase:check'])));
  }, [planKey]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = useMemo(() => findNode(nodes, selectedId), [nodes, selectedId]);

  return (
    <>
      <TreeView
        nodes={nodes}
        label="What Rivet is building"
        open={open}
        onOpenChange={setOpen}
        selectedId={selectedId}
        onSelect={(node) => {
          setSelectedId(node.id);
          if (node.id.startsWith('part:')) selection.select(node.id.slice(5), { reason: 'api', reveal: true });
          else selection.clearSelection();
        }}
        testId="generate-tree"
      />
      <p className="gen__picked ui-small" aria-live="polite" data-testid="generate-picked">
        {selectedNode ? (
          <>
            <strong>{selectedNode.label}</strong>
            {selectedNode.detail ? <span className="ui-muted"> · {selectedNode.detail}</span> : null}
            {selectedNode.id.startsWith('part:') ? <span className="ui-subtle"> · highlighted in the model</span> : null}
          </>
        ) : plan ? (
          <span className="ui-subtle">Pick a part to see it in the model.</span>
        ) : null}
      </p>
    </>
  );
}

function findNode(nodes: readonly TreeNode[], id: string | null): TreeNode | null {
  if (!id) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children ? findNode(n.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

/* ── Stage: the finished plan replayed in assembly order ── */

function ReplayStage({ plan, catalog, selection }: { plan: BuildPlan; catalog: readonly CatalogComponent[]; selection: PartSelectionApi }) {
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
    <div className="viewport gen__viewport" data-testid="generate-viewport">
      <RoverScene
        plan={plan}
        catalog={catalog}
        assemblyMode={finished ? 'assembled' : 'step'}
        assemblyStep={step}
        ghostFutureSteps
        selection={selection}
        themeMode={themeMode}
        showGrid
      />
      <span className="viewport__label">{finished ? 'Put together' : `Putting it together: step ${step} of ${stepCount}`}</span>
    </div>
  );
}
