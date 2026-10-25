'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { StepId } from './steps';

/**
 * Browser-only projects (hackathon scope: no accounts backend). Everything lives in
 * localStorage, so projects stay on this device. Reads and writes never throw: blocked
 * storage degrades to an in-memory copy for the page view.
 */

export type ProjectPhase = 'draft' | 'clarify' | 'generating' | 'ready';

export interface ClarifyAnswers {
  /** Budget in the project currency; null = no hard limit. */
  max_budget: number | null;
  /** Longest side in mm; null = no limit. */
  max_length_mm: number | null;
  /**
   * How to build an interpretation that is not a supported family: a 3D concept model of what the
   * photo or text shows (default), or the closest supported rover.
   */
  interpretation_choice?: 'as_interpreted' | 'closest_supported_rover' | 'concept_model';
}

export interface ProjectRecord {
  /** The draft id: shared by the marketing PromptBox, the app prompt and the project URL. */
  id: string;
  title: string;
  prompt: string;
  imageAssetId: string | null;
  imagePreviewUrl: string | null;
  createdAt: string;
  updatedAt: string;
  phase: ProjectPhase;
  intentId: string | null;
  /** What Rivet assumed when it read the prompt (shown, collapsed, on Review). */
  assumptions: string[];
  clarify: ClarifyAnswers;
  /** Saved example to open instead of a generated build ("See an example"). */
  exampleId: string | null;
  buildId: string | null;
  revision: number | null;
  /** Furthest step reached; earlier steps can be revisited, later ones unlock in order. */
  furthestStep: StepId;
  /** Review finished: save and share become available. */
  reviewDone: boolean;
  /** Catalog ids the user already owns (Buy). */
  ownedCatalogIds: string[];
  /** Build step the user is on (1-based, 0 = not started). Progress is saved per step. */
  buildStep: number;
  /** Assembly steps whose safety notes were acknowledged. */
  acknowledgedSteps: number[];
  /** Catalog ids marked missing during Build. */
  missingCatalogIds: string[];
  completedAt: string | null;
}

export interface LocalAccount {
  email: string;
  provider: 'email' | 'google';
  savedAt: string;
}

const PROJECTS_KEY = 'rivet.projects.v1';
const DRAFT_KEY = 'rivet.draft.v1';
const ACCOUNT_KEY = 'rivet.account.v1';
const CHANGE_EVENT = 'rivet:projects-changed';

const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  cache.delete(key);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// useSyncExternalStore needs a stable snapshot per raw value.
const cache = new Map<string, { raw: string | null; value: unknown }>();
function parsed<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = read(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  if (raw) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function subscribe(onChange: () => void) {
  const handler = () => {
    cache.clear();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

const NO_PROJECTS: ProjectRecord[] = [];

export function newId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `p_${rand}`;
}

export function titleFromPrompt(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, ' ');
  if (!text) return 'Untitled build';
  const short = text.length > 48 ? `${text.slice(0, 46).trimEnd()}…` : text;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

export function createProjectRecord(input: Partial<ProjectRecord> & { prompt: string }): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: input.id ?? newId(),
    title: input.title ?? titleFromPrompt(input.prompt),
    prompt: input.prompt,
    imageAssetId: input.imageAssetId ?? null,
    imagePreviewUrl: input.imagePreviewUrl ?? null,
    createdAt: now,
    updatedAt: now,
    phase: input.phase ?? 'draft',
    intentId: null,
    assumptions: input.assumptions ?? [],
    clarify: { max_budget: null, max_length_mm: null },
    exampleId: input.exampleId ?? null,
    buildId: input.buildId ?? null,
    revision: input.revision ?? null,
    furthestStep: input.furthestStep ?? 'review',
    reviewDone: false,
    ownedCatalogIds: [],
    buildStep: 0,
    acknowledgedSteps: [],
    missingCatalogIds: [],
    completedAt: null,
  };
}

export function listProjects(): ProjectRecord[] {
  return parsed<ProjectRecord[]>(PROJECTS_KEY, NO_PROJECTS);
}

export function getProject(id: string): ProjectRecord | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function saveProject(project: ProjectRecord): ProjectRecord {
  const next = { ...project, updatedAt: new Date().toISOString() };
  const rest = listProjects().filter((p) => p.id !== project.id);
  write(PROJECTS_KEY, JSON.stringify([next, ...rest]));
  return next;
}

export function updateProject(id: string, patch: Partial<ProjectRecord>): ProjectRecord | null {
  const current = getProject(id);
  if (!current) return null;
  return saveProject({ ...current, ...patch, id });
}

export function deleteProject(id: string) {
  write(PROJECTS_KEY, JSON.stringify(listProjects().filter((p) => p.id !== id)));
}

export function duplicateProject(id: string): ProjectRecord | null {
  const source = getProject(id);
  if (!source) return null;
  return saveProject({ ...source, id: newId(), title: `${source.title} (copy)`, createdAt: new Date().toISOString() });
}

/* ── Shared draft (marketing PromptBox ↔ app PromptBox) ── */

export interface Draft {
  id: string;
  text: string;
}

export function readDraft(): Draft | null {
  return parsed<Draft | null>(DRAFT_KEY, null);
}

export function writeDraft(draft: Draft | null) {
  write(DRAFT_KEY, draft ? JSON.stringify(draft) : null);
}

/* ── Local "account" (M2 Save your project). Never leaves the browser. ── */

export function readAccount(): LocalAccount | null {
  return parsed<LocalAccount | null>(ACCOUNT_KEY, null);
}

export function saveAccount(account: LocalAccount) {
  write(ACCOUNT_KEY, JSON.stringify(account));
}

/* ── Hooks ── */

export function useProjects(): ProjectRecord[] {
  return useSyncExternalStore(subscribe, listProjects, () => NO_PROJECTS);
}

export function useProject(id: string | null): [ProjectRecord | null, (patch: Partial<ProjectRecord>) => void] {
  const project = useSyncExternalStore(
    subscribe,
    () => (id ? getProject(id) : null),
    () => null,
  );
  const update = useCallback(
    (patch: Partial<ProjectRecord>) => {
      if (id) updateProject(id, patch);
    },
    [id],
  );
  return [project, update];
}

export function useAccount(): LocalAccount | null {
  return useSyncExternalStore(subscribe, readAccount, () => null);
}
