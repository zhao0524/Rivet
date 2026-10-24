import { describe, expect, it } from 'vitest';
import { advancePlayback, nextStepPosition, previousStepPosition, scrubToStep, stepToScrub } from '../timeline';

describe('scrub mapping', () => {
  it('maps positions to step + progress and back', () => {
    expect(scrubToStep(0, 8)).toEqual({ step: 0, progress: 1 });
    expect(scrubToStep(0.5, 8)).toEqual({ step: 1, progress: 0.5 });
    expect(scrubToStep(3, 8)).toEqual({ step: 3, progress: 1 });
    expect(scrubToStep(8, 8)).toEqual({ step: 8, progress: 1 });
    expect(scrubToStep(42, 8)).toEqual({ step: 8, progress: 1 });
    expect(scrubToStep(-1, 8)).toEqual({ step: 0, progress: 1 });
    expect(scrubToStep(Number.NaN, 8)).toEqual({ step: 0, progress: 1 });
    expect(scrubToStep(2, 0)).toEqual({ step: 0, progress: 1 });
    for (const p of [0, 0.25, 1, 3.5, 7.75, 8]) {
      const { step, progress } = scrubToStep(p, 8);
      expect(stepToScrub(step, progress, 8)).toBeCloseTo(p);
    }
  });

  it('next/back snap to whole steps and clamp', () => {
    expect(nextStepPosition(0, 3)).toBe(1);
    expect(nextStepPosition(1.4, 3)).toBe(2);
    expect(nextStepPosition(3, 3)).toBe(3);
    expect(previousStepPosition(1.4, 3)).toBe(1);
    expect(previousStepPosition(2, 3)).toBe(1);
    expect(previousStepPosition(0, 3)).toBe(0);
  });
});

describe('advancePlayback', () => {
  it('advances while playing and stops at the last step', () => {
    let s = { position: 0, playing: true };
    s = advancePlayback(s, 600, { stepCount: 2, stepDurationMs: 1200 });
    expect(s).toEqual({ position: 0.5, playing: true });
    s = advancePlayback(s, 10_000, { stepCount: 2, stepDurationMs: 1200 });
    expect(s).toEqual({ position: 2, playing: false });
    const paused = { position: 1, playing: false };
    expect(advancePlayback(paused, 500, { stepCount: 2 })).toBe(paused);
    expect(advancePlayback({ position: 1, playing: true }, -5, { stepCount: 2 }).position).toBe(1);
  });
});
