'use client';

import { useEffect, useState } from 'react';
import { scrubToStep } from '../three/assembly';

/** One step glides into place. Shorter when a build has many steps, so the whole seat-in stays a few seconds. */
function stepMs(stepCount: number): number {
  if (stepCount <= 6) return 780;
  return Math.max(420, Math.min(780, 6200 / stepCount));
}

/**
 * Plays an assembly once, from empty to fully seated. `token` restarts it (a new build).
 * The scene eases each step, so this only advances a linear scrub position.
 */
export function useComeTogether(stepCount: number, token: string | null): { step: number; progress: number; done: boolean } {
  const [position, setPosition] = useState(0);
  const [done, setDone] = useState(!token || stepCount <= 0);
  const [seen, setSeen] = useState(token);
  if (token !== seen) {
    setSeen(token);
    setPosition(0);
    setDone(!token || stepCount <= 0);
  }

  useEffect(() => {
    if (!token || stepCount <= 0) {
      setPosition(stepCount);
      setDone(true);
      return;
    }
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setPosition(stepCount);
      setDone(true);
      return;
    }
    setPosition(0);
    setDone(false);
    const per = stepMs(stepCount);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const next = Math.min(stepCount, (now - start) / per);
      setPosition(next);
      if (next >= stepCount) {
        setDone(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stepCount, token]);

  const { step, progress } = scrubToStep(position, stepCount);
  return { step, progress, done };
}
