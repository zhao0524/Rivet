'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Object3D } from 'three';
import {
  explodedPosition,
  isExplodeSettled,
  stepExplodeSpring,
  type ExplodeSpringState,
} from './explodeAnimation';
import type { Vec3 } from './types';

export interface ExplodeAnimatorApi {
  /**
   * Drive `object.position` as `base + offset * progress` until the returned
   * cleanup runs. `base` is the presentation pose without explode; the plan pose
   * is never written.
   */
  register(object: Object3D, base: Vec3, offset: Vec3): () => void;
  /** Live spring state (read-only for callers). */
  readonly state: Readonly<ExplodeSpringState>;
}

const ExplodeAnimatorContext = createContext<ExplodeAnimatorApi | null>(null);

/** The surrounding animator, or `null` when parts render without one (static poses). */
export function useExplodeAnimator(): ExplodeAnimatorApi | null {
  return useContext(ExplodeAnimatorContext);
}

const FIRST_FRAME_S = 1 / 60;
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);

export interface ExplodeAnimatorProps {
  /** Fraction of the full explode offset to settle at (0 = assembled). */
  target: number;
  children?: ReactNode;
}

/**
 * Animates the explode fraction inside the R3F frame loop. Positions are written
 * straight to the registered Object3Ds, so a toggle costs one React render and the
 * animation itself none. Works with `frameloop="demand"`: it requests frames only
 * while the spring is moving.
 */
export function ExplodeAnimator({ target, children }: ExplodeAnimatorProps) {
  const invalidate = useThree((s) => s.invalidate);
  // The first mount starts at rest on the target: opening an exploded build does not animate.
  const spring = useRef<ExplodeSpringState>({ value: clamp01(target), velocity: 0 });
  const targetRef = useRef(clamp01(target));
  const idle = useRef(true);
  const bindings = useMemo(() => new Map<Object3D, { base: Vec3; offset: Vec3 }>(), []);
  const scratch = useMemo<[number, number, number]>(() => [0, 0, 0], []);

  const api = useMemo<ExplodeAnimatorApi>(() => {
    const apply = (object: Object3D, b: { base: Vec3; offset: Vec3 }) => {
      explodedPosition(b.base, b.offset, spring.current.value, scratch);
      object.position.set(scratch[0], scratch[1], scratch[2]);
    };
    return {
      state: spring.current,
      register(object, base, offset) {
        const binding = { base, offset };
        bindings.set(object, binding);
        apply(object, binding);
        invalidate();
        return () => {
          if (bindings.get(object) === binding) bindings.delete(object);
        };
      },
    };
  }, [bindings, invalidate, scratch]);

  useEffect(() => {
    targetRef.current = clamp01(target);
    invalidate();
  }, [target, invalidate]);

  useFrame((_, delta) => {
    const s = spring.current;
    const t = targetRef.current;
    if (isExplodeSettled(s, t)) {
      idle.current = true;
      return;
    }
    // After an idle period the clock delta spans the whole pause; start with one frame.
    stepExplodeSpring(s, t, idle.current ? FIRST_FRAME_S : delta);
    idle.current = false;
    for (const [object, b] of bindings) {
      explodedPosition(b.base, b.offset, s.value, scratch);
      object.position.set(scratch[0], scratch[1], scratch[2]);
    }
    if (!isExplodeSettled(s, t)) invalidate();
  });

  return <ExplodeAnimatorContext.Provider value={api}>{children}</ExplodeAnimatorContext.Provider>;
}
