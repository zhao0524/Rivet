'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney, partRows } from '../../lib/flow/derive';
import {
  getProject,
  updateProject,
  type ChatEntry,
  type ChatQuestion,
  type ClarifyAnswers,
  type GenerationSummary,
  type ProjectChat,
  type ProjectReading,
  type ProjectRecord,
} from '../../lib/flow/projects';
import { takePendingImage } from '../../lib/flow/pending-image';
import { pictureThumbnail } from '../../lib/flow/picture-thumbnail';
import { RivetError } from '../../lib/rivet/errors';
import { isConceptPlan, summarizeBom } from '../../lib/rivet/honesty';
import type { BuildPlan, CatalogComponent, EditOperation, InterpretResponse } from '../../lib/rivet/types';
import type { useFlowStore } from '../flow/FlowProvider';
import { useProjectContext } from '../flow/ProjectShell';
import { decisionSummary, jobErrorMessage, requestInput, stagePhrase, summarizeIntent } from '../start/shared';

/**
 * The workspace conversation. The prompt goes straight in: Rivet reads it, builds it, then asks the
 * questions the old Clarify screen asked (what to use, budget, size) as chat messages. An answer that
 * changes the build starts a new run; one that changes nothing just moves on.
 *
 * The chat log lives on the project record, so it survives reloads. Anything still running (the
 * reading, a generation job) lives in the store and is drawn from there.
 */

type Store = ReturnType<typeof useFlowStore>;
type GenerateRequest = Parameters<Store['startGeneration']>[0];

/** Runs started in this page session, keyed `projectId#run` (survives navigation, not reload). */
const startedRuns = new Set<string>();
/** Projects whose prompt is being read right now. */
const reading = new Set<string>();
/**
 * The run the store's job belongs to, and the job object that was in the store when it started (not
 * ours). Compared by identity: saved examples answer every run with the same job id.
 */
let jobOwner: { key: string; stale: unknown } | null = null;

const QUESTION_ORDER: readonly ChatQuestion[] = ['use', 'budget', 'size'];
/** Generate refusals that mean the saved reading is gone or stale, not that the build failed. */
const STALE_INTENT: readonly string[] = ['INTENT_NOT_FOUND', 'INTENT_INPUT_MISMATCH'];

let seq = 0;
function entryId(kind: string): string {
  seq += 1;
  return `${kind}_${Date.now().toString(36)}${seq}`;
}

/** The chat a project starts with. Projects made before the workspace start with their questions answered. */
export function seedChat(project: ProjectRecord): ProjectChat {
  const log: ChatEntry[] = [];
  if (project.prompt.trim() || project.imagePreviewUrl) log.push({ id: 'prompt', kind: 'prompt' });
  if (project.phase === 'ready') {
    log.push({ id: 'gen_0', kind: 'generation', run: 0, clarify: project.clarify });
    return { log, answered: { use: true, budget: true, size: true }, runs: 0 };
  }
  return { log, answered: {}, runs: 0 };
}

/** Reads the newest copy of the project and writes back a changed chat. Safe to call twice in a row. */
function mutate(id: string, fn: (chat: ProjectChat, project: ProjectRecord) => Partial<ProjectRecord> | null): ProjectRecord | null {
  const fresh = getProject(id);
  if (!fresh) return null;
  const chat = fresh.chat ?? seedChat(fresh);
  const patch = fn(chat, fresh);
  return patch ? updateProject(id, patch) : null;
}

function patchEntry(chat: ProjectChat, id: string, patch: Partial<ChatEntry>): ProjectChat {
  return { ...chat, log: chat.log.map((e) => (e.id === id ? ({ ...e, ...patch } as ChatEntry) : e)) };
}

function append(chat: ProjectChat, ...entries: ChatEntry[]): ProjectChat {
  return { ...chat, log: [...chat.log, ...entries] };
}

export function latestGeneration(chat: ProjectChat): Extract<ChatEntry, { kind: 'generation' }> | null {
  for (let i = chat.log.length - 1; i >= 0; i--) {
    const e = chat.log[i]!;
    if (e.kind === 'generation') return e;
  }
  return null;
}

export function readingFrom(data: InterpretResponse): ProjectReading {
  const offline = data.vision_mode === 'fixture' || data.vision_mode === 'fallback';
  const read = summarizeIntent(data.intent);
  const headline = offline ? read.headline.replace(/^Rivet read this as /, 'The saved example is ') : read.headline;
  const facts = offline ? read.facts.filter((f) => !f.startsWith('From the picture')) : read.facts;
  return {
    headline,
    facts,
    offline,
    supported: data.supported,
    limitation: data.supported ? null : data.limitation?.message ?? 'This kind of robot is not supported yet.',
    suggestedChoice: data.supported ? null : data.intent.project_family === 'rc_car' ? 'closest_supported_rover' : 'concept_model',
  };
}

export function summarizePlan(plan: BuildPlan, catalog: readonly CatalogComponent[], fixture: boolean): GenerationSummary {
  const bom = summarizeBom(plan);
  const subtotal = bom.knownSubtotal !== null ? Number(bom.knownSubtotal) : NaN;
  return {
    title: plan.title,
    parts: partRows(plan, catalog).length,
    total: Number.isFinite(subtotal) ? `${bom.totalLabel === 'Total' ? '' : 'about '}${formatMoney(subtotal, bom.currency)}` : null,
    fixture,
    concept: isConceptPlan(plan),
    decisions: decisionSummary(plan, catalog).map(({ text, detail }) => (detail ? { text, detail } : { text })),
  };
}

function generateRequest(project: ProjectRecord): GenerateRequest {
  return {
    ...(project.intentId ? { intent_id: project.intentId } : {}),
    interpretation_choice: project.clarify.interpretation_choice ?? 'as_interpreted',
    input: requestInput(project),
    requirements: {
      max_budget: project.clarify.max_budget ?? null,
      currency: 'USD',
      max_length_mm: project.clarify.max_length_mm ?? null,
    },
  };
}

/** Questions still to ask, in order. "What will Rivet use" only comes up for ideas it can't engineer. */
export function openQuestions(chat: ProjectChat, readingInfo: ProjectReading | null | undefined): ChatQuestion[] {
  return QUESTION_ORDER.filter((q) => !chat.answered[q] && (q !== 'use' || (readingInfo ? !readingInfo.supported : false)));
}

export function budgetLabel(value: number | null): string {
  return value === null ? 'No budget limit' : `Under $${value}`;
}

export function sizeLabel(mm: number | null): string {
  return mm === null ? 'No size limit' : `Under ${mm} mm long`;
}

export type SessionStatus = 'reading' | 'generating' | 'failed' | 'ready' | 'loading';

export interface WorkspaceSession {
  chat: ProjectChat;
  status: SessionStatus;
  /** The run whose job belongs to this page, so its events can be shown live; null otherwise. */
  liveRun: number | null;
  /** One short, true line about what is happening (e.g. "Choosing parts…"). */
  stageText: string;
  errorMessage: string | null;
  editPending: boolean;
  /** The saved reading was rejected, so Try again reads the prompt again instead of reusing it. */
  reread: boolean;
  answer: (question: ChatQuestion, value: number | string | null) => void;
  retry: () => void;
  retryReading: () => void;
  skipReading: () => void;
  send: (text: string, operation?: EditOperation) => Promise<void>;
}

export function useWorkspaceSession(): WorkspaceSession {
  const { project, update, build } = useProjectContext();
  const store = build.store;
  const id = project.id;
  const chat = useMemo(() => project.chat ?? seedChat(project), [project]);
  const runKey = `${id}#${chat.runs}`;
  const own = jobOwner?.key === runKey && store.job !== null && store.job !== jobOwner.stale;
  const job = own ? store.job : null;
  const [startError, setStartError] = useState<string | null>(null);
  const [reread, setReread] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const fixture = store.dataSource.mode === 'fixture';
  const jobRef = useRef(store.job);
  jobRef.current = store.job;

  // Projects from before the workspace get their chat on first open.
  useEffect(() => {
    if (!project.chat) mutate(id, (c) => ({ chat: c }));
  }, [id, project.chat]);

  const startJob = useCallback(
    async (key: string) => {
      const fresh = getProject(id);
      if (!fresh) return;
      setStartError(null);
      // Until the new job answers, the store still holds the last one; it is not this run's.
      jobOwner = { key, stale: jobRef.current };
      try {
        await store.startGeneration(generateRequest(fresh));
        setReread(false);
      } catch (err) {
        // The stored reading has expired or no longer matches the prompt: build from the prompt alone, once.
        if (err instanceof RivetError && STALE_INTENT.includes(err.code) && fresh.intentId) {
          updateProject(id, { intentId: null });
          try {
            await store.startGeneration(generateRequest({ ...fresh, intentId: null }));
            setReread(false);
            return;
          } catch (retry) {
            err = retry;
          }
        }
        // The run stays marked as started, so nothing restarts it on its own; Try again clears the mark.
        setReread(false);
        setStartError(err instanceof Error && err.message ? err.message : 'Rivet could not start.');
      }
    },
    [id, store],
  );

  /** A new run: a chat entry for it, the project marked as generating, then the job. */
  const startRun = useCallback(() => {
    const next = mutate(id, (c, p) => {
      const run = c.runs + 1;
      return {
        phase: 'generating',
        chat: { ...append(c, { id: entryId('gen'), kind: 'generation', run, clarify: p.clarify }), runs: run },
      };
    });
    if (!next?.chat) return;
    const key = `${id}#${next.chat.runs}`;
    startedRuns.add(key);
    void startJob(key);
  }, [id, startJob]);

  /** The first run after reading, only while the project has not started one. */
  const startFirstRun = useCallback(() => {
    const fresh = getProject(id);
    if (!fresh) return;
    // A project saved mid-build before it had a chat (older projects) has no run to resume either.
    const noRun = fresh.phase === 'generating' && (fresh.chat?.runs ?? 0) === 0;
    if (fresh.phase !== 'draft' && fresh.phase !== 'clarify' && !noRun) return;
    startRun();
  }, [id, startRun]);

  const interpret = useCallback(async () => {
    if (reading.has(id)) return;
    const source = store.dataSource;
    const upload = store.uploadImage;
    if (!getProject(id)) return;
    reading.add(id);
    setInterpreting(true);
    // A picture added on the landing page arrives here still unsent: upload it before reading.
    const picture = takePendingImage(id);
    if (picture) {
      try {
        const asset = await upload(picture);
        const thumbnail = await pictureThumbnail(picture);
        updateProject(id, { imageAssetId: asset.asset_id, imagePreviewUrl: asset.preview_url || null, imageThumbnail: thumbnail });
      } catch (err) {
        const why = err instanceof Error && err.message ? err.message : 'it could not be sent';
        mutate(id, (c) => ({
          chat: append(c, { id: entryId('r'), kind: 'rivet', text: `Your picture didn't upload (${why}), so I'm building from your words alone.`, tone: 'warn' }),
        }));
      }
    }
    const fresh = getProject(id);
    if (!fresh || !source.interpret) {
      reading.delete(id);
      setInterpreting(false);
      startFirstRun();
      return;
    }
    try {
      const data = await source.interpret({ input: requestInput(fresh), requirements: { currency: 'USD' } });
      const info = readingFrom(data);
      // Saving the reading moves the project on: the effect below starts the first run.
      mutate(id, (c, p) => ({
        intentId: data.intent_id,
        assumptions: data.intent.assumptions,
        reading: info,
        clarify: {
          ...p.clarify,
          interpretation_choice: info.supported ? 'as_interpreted' : p.clarify.interpretation_choice ?? info.suggestedChoice ?? 'concept_model',
        },
        chat: c.log.some((e) => e.kind === 'reading') ? c : append(c, { id: entryId('read'), kind: 'reading' }),
      }));
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Rivet couldn't read your idea.";
      mutate(id, (c) => ({ chat: append(c, { id: entryId('readerr'), kind: 'reading-error', message }) }));
    } finally {
      reading.delete(id);
      setInterpreting(false);
    }
  }, [id, store.dataSource, store.uploadImage, startFirstRun]);

  // A new prompt: read it, then build it. No Clarify screen in between.
  useEffect(() => {
    if (project.phase !== 'draft' && project.phase !== 'clarify') return;
    if (chat.log[chat.log.length - 1]?.kind === 'reading-error') return;
    if (project.reading) startFirstRun();
    else void interpret();
  }, [project.phase, project.reading, chat.log, interpret, startFirstRun]);

  // Generating, but this page never started the job (a reload, or Retry): start it.
  useEffect(() => {
    if (project.phase !== 'generating') return;
    if (chat.runs === 0) {
      startFirstRun();
      return;
    }
    if (latestGeneration(chat)?.failed || startedRuns.has(runKey)) return;
    startedRuns.add(runKey);
    void startJob(runKey);
  }, [project.phase, chat, runKey, startJob, startFirstRun]);

  // The job finished and its build has loaded: the project now points at it.
  const resultId = job?.status === 'complete' ? job.build_id ?? null : null;
  const resultLoaded = Boolean(resultId) && store.plan.build_id === resultId && !store.loading;
  useEffect(() => {
    if (project.phase !== 'generating' || !resultLoaded || !job) return;
    const summary = summarizePlan(store.plan, store.catalog, fixture);
    mutate(id, (c, p) => {
      if (p.phase !== 'generating') return null;
      const gen = latestGeneration(c);
      return {
        phase: 'ready',
        buildId: job.build_id ?? null,
        exampleId: null,
        revision: job.revision ?? store.plan.revision,
        reviewDone: false,
        chat: gen ? patchEntry(c, gen.id, { summary, failed: undefined }) : c,
      };
    });
  }, [project.phase, resultLoaded, job, store.plan, store.catalog, fixture, id]);

  // A failed run says so in its chat entry.
  const failure = startError ?? jobErrorMessage(job);
  useEffect(() => {
    if (!failure || project.phase !== 'generating') return;
    mutate(id, (c) => {
      const gen = latestGeneration(c);
      if (!gen || gen.failed === failure) return null;
      return { chat: patchEntry(c, gen.id, { failed: failure }) };
    });
  }, [failure, project.phase, id]);

  // A ready build whose entry has no summary yet (an older project, or a saved example): fill it in.
  useEffect(() => {
    if (project.phase !== 'ready' || !build.ready) return;
    const gen = latestGeneration(chat);
    if (!gen || gen.summary) return;
    const summary = summarizePlan(store.plan, store.catalog, fixture);
    mutate(id, (c) => {
      const g = latestGeneration(c);
      return g && !g.summary ? { chat: patchEntry(c, g.id, { summary }) } : null;
    });
  }, [project.phase, build.ready, chat, store.plan, store.catalog, fixture, id]);

  // Once a build is in, ask the next open question; when none is left, say what can happen next.
  useEffect(() => {
    if (project.phase !== 'ready' || !latestGeneration(chat)?.summary) return;
    mutate(id, (c, p) => {
      const last = c.log[c.log.length - 1];
      if (last?.kind === 'question' && !c.answered[last.question]) return null;
      const next = openQuestions(c, p.reading)[0];
      if (next) {
        if (c.log.some((e) => e.kind === 'question' && e.question === next)) return null;
        return { chat: append(c, { id: entryId('q'), kind: 'question', question: next }) };
      }
      if (c.log.some((e) => e.kind === 'wrap')) return null;
      return { chat: append(c, { id: entryId('wrap'), kind: 'wrap' }) };
    });
  }, [project.phase, chat, id]);

  const answer = useCallback(
    (question: ChatQuestion, value: number | string | null) => {
      let rebuild = false;
      mutate(id, (c, p) => {
        if (c.answered[question]) return null;
        const clarify: ClarifyAnswers = { ...p.clarify };
        let said: string;
        if (question === 'budget') {
          clarify.max_budget = typeof value === 'number' ? value : null;
          said = budgetLabel(clarify.max_budget);
        } else if (question === 'size') {
          clarify.max_length_mm = typeof value === 'number' ? value : null;
          said = sizeLabel(clarify.max_length_mm);
        } else {
          clarify.interpretation_choice = value === 'closest_supported_rover' ? 'closest_supported_rover' : 'concept_model';
          said = value === 'closest_supported_rover' ? 'Use the closest supported rover' : 'Build a 3D model of this';
        }
        const used = latestGeneration(c)?.clarify ?? p.clarify;
        rebuild =
          !p.exampleId &&
          ((question === 'budget' && clarify.max_budget !== (used.max_budget ?? null)) ||
            (question === 'size' && clarify.max_length_mm !== (used.max_length_mm ?? null)) ||
            (question === 'use' && clarify.interpretation_choice !== used.interpretation_choice));
        return {
          clarify,
          chat: {
            ...append(
              c,
              { id: entryId('u'), kind: 'user', text: said },
              { id: entryId('r'), kind: 'rivet', text: rebuild ? rebuildLine(question, clarify) : keepLine(question) },
            ),
            answered: { ...c.answered, [question]: true },
          },
        };
      });
      if (rebuild) startRun();
    },
    [id, startRun],
  );

  const retry = useCallback(() => {
    startedRuns.delete(runKey);
    setStartError(null);
    if (reread) {
      setReread(false);
      mutate(id, (c) => ({
        intentId: null,
        reading: null,
        phase: 'clarify',
        chat: { ...c, log: c.log.filter((e) => !(e.kind === 'generation' && e.failed)) },
      }));
      return;
    }
    // Clearing `failed` puts the run back in progress; the effect above starts it again.
    mutate(id, (c) => {
      const gen = latestGeneration(c);
      return gen ? { phase: 'generating', chat: patchEntry(c, gen.id, { failed: undefined }) } : null;
    });
  }, [id, runKey, reread]);

  const retryReading = useCallback(() => {
    mutate(id, (c) => ({ chat: { ...c, log: c.log.filter((e) => e.kind !== 'reading-error') } }));
  }, [id]);

  const skipReading = useCallback(() => {
    mutate(id, (c) => ({ chat: { ...c, log: c.log.filter((e) => e.kind !== 'reading-error') } }));
    startFirstRun();
  }, [id, startFirstRun]);

  const send = useCallback(
    async (text: string, operation?: EditOperation) => {
      const instruction = text.trim();
      if (!instruction) return;
      mutate(id, (c) => ({ chat: append(c, { id: entryId('u'), kind: 'user', text: instruction }) }));
      if (!build.ready) {
        mutate(id, (c) => ({
          chat: append(c, { id: entryId('r'), kind: 'rivet', text: "I can change things once the build has finished.", tone: 'warn' }),
        }));
        return;
      }
      const res = await store.submitEdit(instruction, operation);
      let reply: ChatEntry;
      if (!res) {
        reply = { id: entryId('r'), kind: 'rivet', text: "That change didn't go through.", tone: 'danger' };
      } else if (res.accepted && typeof res.revision === 'number') {
        update({ revision: res.revision, reviewDone: false });
        reply = { id: entryId('r'), kind: 'rivet', text: 'Done. I made the change and re-checked the whole build.', tone: 'ok' };
      } else {
        reply = {
          id: entryId('r'),
          kind: 'rivet',
          text: fixture
            ? "Changes need Rivet's live engine, which isn't connected right now, so nothing changed."
            : "I didn't make that change.",
          ...(fixture || !res.finding?.message ? {} : { detail: res.finding.message }),
          tone: 'warn',
        };
      }
      mutate(id, (c) => ({ chat: append(c, reply) }));
    },
    [id, build.ready, store, update, fixture],
  );

  const gen = latestGeneration(chat);
  const readingFailed = chat.log[chat.log.length - 1]?.kind === 'reading-error';
  const status: SessionStatus =
    project.phase === 'draft' || project.phase === 'clarify'
      ? readingFailed && !interpreting
        ? 'failed'
        : 'reading'
      : project.phase === 'generating'
        ? gen?.failed
          ? 'failed'
          : 'generating'
        : build.ready
          ? 'ready'
          : 'loading';

  const stageText =
    status === 'reading'
      ? 'Reading your idea…'
      : status === 'generating'
        ? job?.status === 'complete'
          ? 'Loading the finished build…'
          : job?.stage && job.stage !== 'complete'
            ? `${stagePhrase(job.stage)}…`
            : 'Getting started…'
        : status === 'failed'
          ? 'Stopped'
          : status === 'loading'
            ? 'Opening the build…'
            : 'Ready';

  return {
    chat,
    status,
    liveRun: own ? chat.runs : null,
    stageText,
    errorMessage: gen?.failed ?? failure ?? null,
    editPending: store.editPending,
    reread,
    answer,
    retry,
    retryReading,
    skipReading,
    send,
  };
}

function rebuildLine(question: ChatQuestion, clarify: ClarifyAnswers): string {
  if (question === 'budget')
    return clarify.max_budget === null ? 'Rebuilding it without a budget limit.' : `Rebuilding it to stay under $${clarify.max_budget}.`;
  if (question === 'size')
    return clarify.max_length_mm === null ? 'Rebuilding it without a size limit.' : `Rebuilding it to stay under ${clarify.max_length_mm} mm.`;
  return clarify.interpretation_choice === 'closest_supported_rover'
    ? 'Switching to the closest rover Rivet fully engineers.'
    : 'Switching to a 3D model of your idea.';
}

function keepLine(question: ChatQuestion): string {
  if (question === 'budget') return 'Got it. The build already fits that, so nothing changes.';
  if (question === 'size') return 'Got it. No change needed.';
  return 'Keeping it as it is.';
}
