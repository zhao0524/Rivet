'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Enter animation for a route. Next remounts a `template.tsx` on every navigation into its segment,
 * so wrapping a segment's children in this plays the animation each time the page changes.
 *
 * Templates nest (root, app, project), and the outermost one that changed is the one that animates:
 * an inner wrapper mounting inside a wrapper that is still entering drops its own animation, so a
 * page never fades in twice. The class comes off once the animation is over, so the wrapper leaves no
 * lasting transform behind (a transform would break fixed and sticky children).
 *
 * `fade` animates opacity only, for pages whose scroll effects measure positions as they mount.
 */
const ENTER_CLASSES = ['ui-page-enter', 'ui-page-enter--rise', 'ui-page-enter--fade'];
/** A little longer than the longest enter animation (system.css). */
const ENTER_MS = 420;

export function PageTransition({ children, variant = 'rise' }: { children: ReactNode; variant?: 'rise' | 'fade' }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => el.classList.remove(...ENTER_CLASSES);
    const outer = el.parentElement?.closest('.ui-page-enter');
    const outerRunning = outer?.getAnimations?.().some((a) => a.playState === 'running') ?? false;
    if (outerRunning) {
      done();
      return;
    }
    // A timer, not animationend: a server-rendered page can finish animating before React is listening.
    const t = window.setTimeout(done, ENTER_MS);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div ref={ref} className={`ui-page ${ENTER_CLASSES[0]} ui-page-enter--${variant}`}>
      {children}
    </div>
  );
}
