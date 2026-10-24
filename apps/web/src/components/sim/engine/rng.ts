/** mulberry32: tiny deterministic PRNG with a serializable 32-bit state. */
export function nextRandom(state: number): [value: number, nextState: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new RangeError(`seed must be finite (got ${seed})`);
  return Math.trunc(seed) >>> 0;
}
