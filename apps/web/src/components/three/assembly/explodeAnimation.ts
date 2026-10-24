import type { Vec3 } from './types';

/**
 * Presentation-only explode animation. A single scalar `value` (0 = assembled,
 * 1 = full explode offset) follows `target` as a critically damped spring, solved
 * analytically so any frame time is stable. Retargeting mid-flight keeps the
 * current value and velocity, so reversals are smooth; at rest the value snaps to
 * the exact target, so repeated toggles never accumulate drift.
 */
export interface ExplodeSpringState {
  value: number;
  velocity: number;
}

/** Spring stiffness (rad/s). ~98% of a full 0→1 move completes in ~350 ms. */
export const EXPLODE_SPRING_OMEGA = 16.7;
// Snap to rest once within 0.3% of the move (sub-0.2 mm for a 60 mm offset). In the
// critically damped tail |velocity| is about 15x the distance, so both bounds agree.
const SETTLE_DISTANCE = 3e-3;
const SETTLE_VELOCITY = 0.08;
/** Larger frame gaps (tab switch, dropped frames) are clamped so motion stays visible. */
const MAX_STEP_S = 0.1;

export function isExplodeSettled(state: ExplodeSpringState, target: number): boolean {
  return state.value === target && state.velocity === 0;
}

/** Advance `state` toward `target` by `dtSeconds`. Mutates and returns `state`. */
export function stepExplodeSpring(
  state: ExplodeSpringState,
  target: number,
  dtSeconds: number,
  omega = EXPLODE_SPRING_OMEGA,
): ExplodeSpringState {
  const dt = Math.min(Math.max(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0), MAX_STEP_S);
  if (dt === 0) return state;
  const x0 = state.value - target;
  const v0 = state.velocity;
  const decay = Math.exp(-omega * dt);
  const c = v0 + omega * x0;
  const x = (x0 + c * dt) * decay;
  const v = (v0 - omega * c * dt) * decay;
  if (Math.abs(x) < SETTLE_DISTANCE && Math.abs(v) < SETTLE_VELOCITY) {
    state.value = target;
    state.velocity = 0;
  } else {
    state.value = target + x;
    state.velocity = v;
  }
  return state;
}

/** `base + offset * progress`, written into `out`. */
export function explodedPosition(base: Vec3, offset: Vec3, progress: number, out: [number, number, number]) {
  out[0] = base[0] + offset[0] * progress;
  out[1] = base[1] + offset[1] * progress;
  out[2] = base[2] + offset[2] * progress;
  return out;
}
