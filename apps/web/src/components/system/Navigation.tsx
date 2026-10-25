'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PageSkeleton, ProjectsSkeleton, StartSkeleton } from './PageSkeletons';

/**
 * Navigation feedback. A page change can take a moment before the next route answers (its code is
 * still loading, or the server is still rendering it), and Next keeps the old page on screen until it
 * does. This notes where we are heading the instant a link is clicked or `router.push` is called, so
 * screens can show the destination's skeleton straight away. It clears as soon as the path changes.
 */

export interface PendingNavigation {
  path: string;
  at: number;
}

let pending: PendingNavigation | null = null;
/** Tracking runs only while the root watcher is mounted; it is the one that clears on arrival. */
let watchers = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Pending navigations only count after this long, so fast ones never flash a skeleton. */
const SHOW_AFTER_MS = 120;
/** A navigation that never lands (blocked, or cancelled) stops counting after this. */
const GIVE_UP_MS = 10_000;

export function markNavigating(href: string): void {
  if (typeof window === 'undefined' || watchers === 0) return;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
  pending = { path: url.pathname, at: Date.now() };
  emit();
  const mine = pending;
  window.setTimeout(() => {
    if (pending === mine) clearNavigating();
  }, GIVE_UP_MS);
}

export function clearNavigating(): void {
  if (!pending) return;
  pending = null;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The navigation in flight, once it has taken long enough to be worth showing. */
export function usePendingNavigation(): PendingNavigation | null {
  const current = useSyncExternalStore(subscribe, () => pending, () => null);
  const [shown, setShown] = useState<PendingNavigation | null>(null);
  useEffect(() => {
    if (!current) {
      setShown(null);
      return;
    }
    const wait = Math.max(0, SHOW_AFTER_MS - (Date.now() - current.at));
    const t = window.setTimeout(() => setShown(current), wait);
    return () => window.clearTimeout(t);
  }, [current]);
  return shown;
}

/** `useRouter`, with `push` and `replace` reporting where they are going. */
export function useAppRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  return useMemo(
    () => ({
      ...router,
      push: (href, options) => {
        markNavigating(href);
        if (options) router.push(href, options);
        else router.push(href);
      },
      replace: (href, options) => {
        markNavigating(href);
        if (options) router.replace(href, options);
        else router.replace(href);
      },
    }),
    [router],
  );
}

/** A project step path: /p/<id>/<step>. */
export function projectStepOf(path: string): { id: string; step: string } | null {
  const m = /^\/p\/([^/]+)(?:\/([^/]+))?/.exec(path);
  return m ? { id: decodeURIComponent(m[1]!), step: m[2] ?? '' } : null;
}

function DestinationSkeleton({ path }: { path: string }) {
  if (path === '/new') return <StartSkeleton />;
  if (path === '/projects') return <ProjectsSkeleton />;
  return <PageSkeleton />;
}

/**
 * Mounted once in the root layout: notes link clicks, clears when the path changes, and covers the
 * page with the destination's skeleton while a slow navigation is in flight. Moves between a project's
 * own steps are left to the project shell, which keeps its header and stepper on screen.
 */
export function NavigationWatch() {
  const pathname = usePathname();
  const shown = usePendingNavigation();

  useEffect(() => clearNavigating(), [pathname]);
  useEffect(() => {
    watchers++;
    return () => {
      watchers--;
      clearNavigating();
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      markNavigating(a.href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (!shown) return null;
  const from = projectStepOf(pathname ?? '');
  const to = projectStepOf(shown.path);
  if (from && to && from.id === to.id) return null;
  return (
    <div className="ui-nav-cover" data-testid="navigation-skeleton">
      <div className="app">
        <DestinationSkeleton path={shown.path} />
      </div>
    </div>
  );
}
