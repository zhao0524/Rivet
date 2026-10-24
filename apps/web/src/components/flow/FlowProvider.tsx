'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useStudioPlanStore } from '../../lib/plan-store';
import type { ProjectRecord } from '../../lib/flow/projects';

type FlowStore = ReturnType<typeof useStudioPlanStore>;

const FlowContext = createContext<FlowStore | null>(null);

/**
 * One plan store for the whole app route group. The (app) layout persists across navigation,
 * so prompt → clarify → generate → the five steps share a single in-flight job and loaded plan.
 */
export function FlowProvider({ children, store: injected }: { children: ReactNode; store?: FlowStore }) {
  const own = useStudioPlanStore();
  return <FlowContext.Provider value={injected ?? own}>{children}</FlowContext.Provider>;
}

export function useFlowStore(): FlowStore {
  const store = useContext(FlowContext);
  if (!store) throw new Error('useFlowStore must be used inside <FlowProvider>');
  return store;
}

export interface ProjectBuildState {
  store: FlowStore;
  /** The store holds this project's plan. */
  ready: boolean;
  loading: boolean;
  error: string | null;
}

/** Makes sure the store holds the build that belongs to `project`, loading it when needed. */
export function useProjectBuild(project: ProjectRecord | null): ProjectBuildState {
  const store = useFlowStore();
  const target = project?.exampleId ?? project?.buildId ?? null;
  const requested = useRef<string | null>(null);
  const key = target ? `${target}@${project?.revision ?? 'latest'}` : null;

  useEffect(() => {
    if (!project || !target || !key || requested.current === key) return;
    if (store.plan.build_id === target && (project.revision === null || store.plan.revision === project.revision)) {
      requested.current = key;
      return;
    }
    requested.current = key;
    if (project.exampleId) void store.loadSavedExample(project.exampleId);
    else void store.loadBuild(target, project.revision ?? undefined);
  }, [project, target, key, store]);

  const ready = Boolean(target) && store.plan.build_id === target && !store.loading;
  return {
    store,
    ready,
    loading: store.loading || (Boolean(target) && store.plan.build_id !== target),
    error: store.contractError ?? store.revisionError,
  };
}
