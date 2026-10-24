/**
 * Distinguishes a click from an orbit / pan drag. A press that travels farther
 * than `thresholdPx` before release is a drag and must not change selection.
 */
export interface PointerPositionLike {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId?: number;
}

export interface ClickGuard {
  readonly thresholdPx: number;
  /** Record a press (call from `pointerdown`). */
  down(event: PointerPositionLike): void;
  /**
   * `true` when the release at `event` is a click. `extraDelta` lets callers pass
   * the renderer's own measured travel (e.g. R3F `event.delta`).
   */
  isClick(event: PointerPositionLike | null | undefined, extraDelta?: number): boolean;
  reset(): void;
}

const MOUSE_KEY = -1;

export function createClickGuard(thresholdPx = 4): ClickGuard {
  const presses = new Map<number, { x: number; y: number }>();
  return {
    thresholdPx,
    down(event) {
      presses.set(event.pointerId ?? MOUSE_KEY, { x: event.clientX, y: event.clientY });
    },
    isClick(event, extraDelta = 0) {
      if (extraDelta > thresholdPx) return false;
      if (!event) return true;
      const key = event.pointerId ?? MOUSE_KEY;
      const press = presses.get(key) ?? (presses.size === 1 ? [...presses.values()][0] : undefined);
      if (!press) return true;
      return Math.hypot(event.clientX - press.x, event.clientY - press.y) <= thresholdPx;
    },
    reset() {
      presses.clear();
    },
  };
}
