'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { projectStepOf, useAppRouter, usePendingNavigation } from '../system/Navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useProject, type ProjectRecord } from '../../lib/flow/projects';
import { advance, isStepId, projectPath, type StepId } from '../../lib/flow/steps';
import { IterateModal } from '../steps/IterateModal';
import { StepSkeleton } from '../system/PageSkeletons';
import { AppHeader } from './AppHeader';
import { useProjectBuild, type ProjectBuildState } from './FlowProvider';
import { Stepper } from './Stepper';

export interface ProjectContextValue {
  project: ProjectRecord;
  update: (patch: Partial<ProjectRecord>) => void;
  build: ProjectBuildState;
  /** Current route segment: a step id, `clarify` or `generate`. */
  segment: string;
  /** Navigate to a step, recording it as reached when it moves forward. */
  goTo: (step: StepId) => void;
  /** Iterate modal, reachable from any step's overflow and from Done. */
  openIterate: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used inside a project route');
  return ctx;
}

/** Wraps every `/p/:id/*` screen: loads the project and its build, shows the stepper once ready. */
export function ProjectShell({ id, children }: { id: string; children: ReactNode }) {
  const router = useAppRouter();
  const pathname = usePathname() ?? '';
  const [project, update] = useProject(id);
  const build = useProjectBuild(project);
  const [iterateOpen, setIterateOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const pendingNav = usePendingNavigation();

  // useSyncExternalStore returns null during SSR and the first client pass; wait one tick
  // before deciding the project does not exist.
  useEffect(() => setChecked(true), []);

  const segment = pathname.split('/')[3] ?? '';

  // Next scrolls the new segment to the very top, under the sticky header and stepper; start each screen at the top instead.
  useEffect(() => {
    document.documentElement.scrollTop = 0;
  }, [segment]);

  const goTo = useCallback(
    (step: StepId) => {
      if (!project) return;
      update({ furthestStep: advance(project.furthestStep, step) });
      router.push(projectPath(project.id, step));
    },
    [project, update, router],
  );

  const value = useMemo<ProjectContextValue | null>(
    () =>
      project
        ? { project, update, build, segment, goTo, openIterate: () => setIterateOpen(true) }
        : null,
    [project, update, build, segment, goTo],
  );

  if (!project || !value) {
    return (
      <>
        <AppHeader />
        <main className={checked ? 'app-main app-main--narrow' : 'app-main'}>
          {checked ? (
            <div className="ui-card ui-card--pad" data-testid="project-missing">
              <h1 className="ui-h2">This project isn&apos;t on this device</h1>
              <p className="ui-muted">
                Projects are saved in this browser only. Open it on the device where you made it, or start a new one.
              </p>
              <Link href="/new" className="ui-btn ui-btn--primary" style={{ marginTop: 12 }}>
                New project
              </Link>
            </div>
          ) : (
            <StepSkeleton />
          )}
        </main>
      </>
    );
  }

  const showStepper = project.phase === 'ready' && isStepId(segment);
  const navigating = pendingStep(pendingNav?.path, project.id, segment);

  return (
    <ProjectContext.Provider value={value}>
      <AppHeader center={<span data-testid="project-title">{project.title}</span>} />
      {showStepper ? <Stepper projectId={project.id} current={segment as StepId} furthest={project.furthestStep} /> : null}
      <main className="app-main">
        {project.phase === 'ready' && build.error && !build.ready ? (
          <section className="ui-card ui-card--pad" role="alert" data-testid="project-load-error">
            <h1 className="ui-h2">This build could not be loaded</h1>
            <p className="ui-muted">Your project is still saved on this device. The build may be unavailable or the connection may have been interrupted.</p>
            <details><summary>Error details</summary><p>{build.error}</p></details>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button type="button" className="ui-btn ui-btn--primary" onClick={() => window.location.reload()}>Try again</button>
              <Link href="/projects" className="ui-btn ui-btn--secondary">Back to projects</Link>
            </div>
          </section>
        ) : (
          <>
            {navigating ? <StepSkeleton /> : null}
            {/* Keep effects and form state alive if a slow navigation times out or is cancelled. */}
            <div style={{ display: navigating ? 'none' : 'contents' }}>{children}</div>
          </>
        )}
      </main>
      <IterateModal open={iterateOpen} onClose={() => setIterateOpen(false)} />
    </ProjectContext.Provider>
  );
}

/** A move to another step of this same project is on its way: show that step's skeleton under the stepper. */
function pendingStep(path: string | undefined, id: string, segment: string): boolean {
  const to = path ? projectStepOf(path) : null;
  return !!to && to.id === id && to.step !== segment;
}
