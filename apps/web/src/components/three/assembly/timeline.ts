/**
 * Timeline position helpers. A continuous scrub `position` in [0, stepCount]
 * maps to a step index plus seat-in progress: position 0 is the empty prep
 * state, position n is step n fully seated, n - 0.5 is halfway into step n.
 */

export interface StepPosition {
  readonly step: number;
  readonly progress: number;
}

const clampPos = (position: number, stepCount: number): number => {
  const max = Math.max(0, Math.trunc(stepCount) || 0);
  if (!Number.isFinite(position)) return 0;
  return Math.min(Math.max(position, 0), max);
};

export function scrubToStep(position: number, stepCount: number): StepPosition {
  const p = clampPos(position, stepCount);
  if (p <= 0) return { step: 0, progress: 1 };
  const step = Math.ceil(p - 1e-9);
  return { step, progress: Math.min(1, Math.max(0, p - (step - 1))) };
}

export function stepToScrub(step: number, progress = 1, stepCount = Infinity): number {
  const s = Math.trunc(step) || 0;
  if (s <= 0) return 0;
  return clampPos(s - 1 + Math.min(Math.max(progress, 0), 1), stepCount);
}

/** Next whole step from any (possibly fractional) position. */
export function nextStepPosition(position: number, stepCount: number): number {
  return clampPos(Math.floor(clampPos(position, stepCount) + 1e-9) + 1, stepCount);
}

/** Previous whole step from any (possibly fractional) position. */
export function previousStepPosition(position: number, stepCount: number): number {
  return clampPos(Math.ceil(clampPos(position, stepCount) - 1e-9) - 1, stepCount);
}

export interface PlaybackState {
  readonly position: number;
  readonly playing: boolean;
}

export interface PlaybackOptions {
  readonly stepCount: number;
  /** Time to seat one step. Spec suggests ~200–400 ms transitions plus dwell. */
  readonly stepDurationMs?: number;
}

/** Pure playback tick: advance by `dtMs`, stop at the final step. */
export function advancePlayback(
  state: PlaybackState,
  dtMs: number,
  { stepCount, stepDurationMs = 1200 }: PlaybackOptions,
): PlaybackState {
  if (!state.playing) return state;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const position = clampPos(state.position + dt / Math.max(stepDurationMs, 1), stepCount);
  return { position, playing: position < stepCount };
}
