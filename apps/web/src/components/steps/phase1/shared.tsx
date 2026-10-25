'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import '../../../styles/phase1.css';
import '../../../styles/phase2.css';
import { useProjectContext } from '../../flow/ProjectShell';
import { projectPath } from '../../../lib/flow/steps';
import type { BuildPlan, CatalogComponent } from '../../../lib/rivet/types';
import { RoverScene, type RoverSceneProps } from '../../three/RoverScene';
import { useThemeMode } from '../../system/ThemeToggle';
import type { OverflowItem } from '../../system/OverflowMenu';

/**
 * Overflow items every Phase 1 step shares: "Change something" (Iterate), "Open Buy early",
 * and, once Review is done, "Save and share". Returns the items plus the toast that
 * confirms a copied link; render `toast` inside the step body.
 */
export function useStepOverflow(extra: readonly OverflowItem[] = []): { items: OverflowItem[]; toast: ReactNode } {
  const { project, goTo, openIterate } = useProjectContext();
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 4000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const share = useCallback(async () => {
    const url = `${window.location.origin}${projectPath(project.id, 'review')}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied('Link copied. Projects are saved in this browser, so it opens on this device.');
    } catch {
      setCopied(`Copy this link by hand: ${url}. It opens on this device only.`);
    }
  }, [project.id]);

  const items = useMemo<OverflowItem[]>(() => {
    const list: OverflowItem[] = [
      { id: 'iterate', label: 'Change something', onSelect: openIterate, testId: 'overflow-iterate' },
      { id: 'buy-early', label: 'Jump ahead to Buy', onSelect: () => goTo('buy'), testId: 'overflow-buy-early' },
      ...extra,
    ];
    if (project.reviewDone) {
      list.push({ id: 'share', label: 'Save and share', onSelect: () => void share(), testId: 'overflow-share' });
    }
    return list;
  }, [openIterate, goTo, extra, project.reviewDone, share]);

  // The live region always exists, so the copied message is announced when it appears.
  const toast = (
    <div className="p1-toast-slot" role="status" aria-live="polite">
      {copied ? (
        <div className="ui-notice ui-notice--ok p1-toast" data-testid="share-toast">
          {copied}
        </div>
      ) : null}
    </div>
  );

  return { items, toast };
}

/** Plain, non-alarming line for a build that failed to load. */
export function BuildError({ message }: { message: string }) {
  return (
    <div className="ui-notice ui-notice--danger" role="alert" data-testid="build-error">
      {message}
    </div>
  );
}

/** Skeleton rows while the build loads. */
export function SkeletonRows({ count = 6, testId }: { count?: number; testId?: string }) {
  return (
    <div className="p1-skeleton-rows" aria-hidden="true" data-testid={testId}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ui-skeleton" />
      ))}
    </div>
  );
}

export interface SceneViewportProps extends Omit<RoverSceneProps, 'plan' | 'catalog' | 'themeMode'> {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  small?: boolean;
  /** Pill in the corner, e.g. the approximate-wiring note. */
  label?: ReactNode;
  testId?: string;
}

/** The 3D rover inside a `.viewport`, themed to match the page. */
export function SceneViewport({ small = false, label, testId, ...scene }: SceneViewportProps) {
  const themeMode = useThemeMode();
  return (
    <div className={small ? 'viewport viewport--sm' : 'viewport'} data-testid={testId}>
      <RoverScene {...scene} themeMode={themeMode} showGrid={false} />
      {label ? <span className="viewport__label">{label}</span> : null}
    </div>
  );
}

/** Viewport-shaped skeleton. */
export function SceneSkeleton({ small = false }: { small?: boolean }) {
  return <div className={small ? 'viewport viewport--sm ui-skeleton' : 'viewport ui-skeleton'} aria-hidden="true" />;
}

/**
 * A small text-link disclosure for technical detail (ids, pin names, raw engine text), so the
 * plain line stays first and nothing is deleted for people who want the specifics.
 */
export function MoreDetails({ summary = 'Details', children, testId }: { summary?: string; children: ReactNode; testId?: string }) {
  return (
    <details className="p2-details" data-testid={testId}>
      <summary className="ui-small">{summary}</summary>
      <div className="p2-details__body ui-small ui-muted">{children}</div>
    </details>
  );
}
