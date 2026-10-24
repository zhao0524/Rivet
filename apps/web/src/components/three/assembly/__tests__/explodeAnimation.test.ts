import { describe, expect, it } from 'vitest';
import { explodedPosition, isExplodeSettled, stepExplodeSpring, type ExplodeSpringState } from '../index';

const FRAME = 1 / 60;

function run(state: ExplodeSpringState, target: number, seconds: number, dt = FRAME): number[] {
  const values: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) values.push(stepExplodeSpring(state, target, dt).value);
  return values;
}

describe('explode spring', () => {
  it('eases from rest, never overshoots, and lands exactly on the target in ~350 ms', () => {
    const s = { value: 0, velocity: 0 };
    const values = run(s, 1, 0.5);
    // Smooth start: the first frame moves only a little.
    expect(values[0]).toBeGreaterThan(0);
    expect(values[0]).toBeLessThan(0.05);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    const at350 = values[Math.round(0.35 / FRAME) - 1];
    expect(at350).toBeGreaterThan(0.97);
    expect(isExplodeSettled(s, 1)).toBe(true);
    expect(s.value).toBe(1);
  });

  it('reverses mid-flight without a jump in position', () => {
    const s = { value: 0, velocity: 0 };
    run(s, 1, 0.12);
    const before = s.value;
    expect(before).toBeGreaterThan(0.2);
    expect(before).toBeLessThan(0.9);
    const next = stepExplodeSpring(s, 0, FRAME).value;
    // One frame later it is still near where it was (continuous), and heading back.
    expect(Math.abs(next - before)).toBeLessThan(0.1);
    run(s, 0, 0.6);
    expect(s).toEqual({ value: 0, velocity: 0 });
  });

  it('rapid toggling never accumulates error: it always rests exactly on 0 or 1', () => {
    const s = { value: 0, velocity: 0 };
    for (let i = 0; i < 200; i++) run(s, i % 2 ? 0 : 1, (i % 7) * FRAME);
    run(s, 0, 1);
    expect(s).toEqual({ value: 0, velocity: 0 });
    run(s, 1, 1);
    expect(s).toEqual({ value: 1, velocity: 0 });
  });

  it('is stable for irregular and oversized frame times', () => {
    const s = { value: 0, velocity: 0 };
    stepExplodeSpring(s, 1, 5); // clamped to a short step
    expect(s.value).toBeGreaterThan(0);
    expect(s.value).toBeLessThan(1);
    stepExplodeSpring(s, 1, Number.NaN);
    stepExplodeSpring(s, 1, -1);
    expect(Number.isFinite(s.value)).toBe(true);
    run(s, 1, 1, 0.033);
    expect(s.value).toBe(1);
  });

  it('display position is base + offset * progress', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(explodedPosition([10, 20, 30], [4, -2, 0], 0, out)).toEqual([10, 20, 30]);
    expect(explodedPosition([10, 20, 30], [4, -2, 0], 0.5, out)).toEqual([12, 19, 30]);
    expect(explodedPosition([10, 20, 30], [4, -2, 0], 1, out)).toEqual([14, 18, 30]);
  });
});
