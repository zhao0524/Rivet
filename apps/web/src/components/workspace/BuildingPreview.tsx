'use client';

import { useEffect, useMemo, useState } from 'react';
import { getCombinedFixtureCatalog, getConceptExamplePlan, getSourcedRoverPlan } from '../../lib/fixtures';
import { scrubToStep } from '../three/assembly';
import { RoverScene } from '../three/RoverScene';

/** Time each part takes to seat, and the pause on the finished model before it starts again. */
const STEP_MS = 900;
const HOLD_MS = 1800;

/** Eased so each part slows as it seats, like it is being placed by hand. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The loading view while Rivet builds: a real saved build putting itself together, part by part,
 * turning slowly. A drone idea shows the saved quadcopter; anything else the rover. It is an
 * illustration of building, so the caption says it is an example rather than the user's design.
 */
export function BuildingPreview({ prompt }: { prompt: string }) {
  const drone = /\b(drone|quad|copter|uav|fpv)/i.test(prompt);
  const plan = useMemo(() => (drone ? getConceptExamplePlan() : getSourcedRoverPlan()), [drone]);
  const catalog = useMemo(() => [...getCombinedFixtureCatalog(), ...(plan.concept_catalog ?? [])], [plan]);
  const count = plan.assembly_steps.length;
  const [position, setPosition] = useState(0);

  useEffect(() => {
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || count === 0) {
      setPosition(count);
      return;
    }
    const cycle = count * STEP_MS + HOLD_MS;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - start) % cycle;
      setPosition(Math.min(count, t / STEP_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  const { step, progress } = scrubToStep(position, count);
  return (
    <div className="ws-preview" aria-hidden="true">
      <RoverScene
        plan={plan}
        catalog={catalog}
        assemblyMode="step"
        assemblyStep={step}
        assemblyProgress={ease(progress)}
        previousStepsDisplay="solid"
        ghostFutureSteps={false}
        enclosure="none"
        themeMode="dark"
        showGrid
        orbitOnly
        autoRotate
        framePadding={0.12}
      />
      <span className="ws-preview__caption">{drone ? 'Example: a quadcopter' : 'Example: an indoor rover'} being put together</span>
    </div>
  );
}
