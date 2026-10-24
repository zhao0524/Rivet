/**
 * The five post-generation steps in two phases. Earlier steps can be revisited; later steps
 * unlock in order. Buy is the one exception: it can be opened early from the overflow menu.
 */

export const STEPS = [
  { id: 'review', n: 1, label: 'Review', phase: 1, cta: 'Looks good, continue to Parts' },
  { id: 'parts', n: 2, label: 'Parts', phase: 1, cta: 'Continue to Wiring' },
  { id: 'wiring', n: 3, label: 'Wiring & firmware', phase: 1, cta: 'Continue to Buy' },
  { id: 'buy', n: 4, label: 'Buy', phase: 2, cta: 'Open cart' },
  { id: 'build', n: 5, label: 'Build', phase: 2, cta: 'Next step' },
] as const;

export type StepId = (typeof STEPS)[number]['id'] | 'done';

export const PHASES = [
  { n: 1, label: 'Review parts, wiring and firmware' },
  { n: 2, label: 'Buy and build' },
] as const;

const ORDER: StepId[] = ['review', 'parts', 'wiring', 'buy', 'build', 'done'];

export function stepIndex(step: StepId): number {
  return ORDER.indexOf(step);
}

export function isStepId(value: string): value is StepId {
  return (ORDER as string[]).includes(value);
}

export function nextStep(step: StepId): StepId {
  return ORDER[Math.min(stepIndex(step) + 1, ORDER.length - 1)]!;
}

/** Whether `step` can be opened given the furthest step reached. */
export function isUnlocked(step: StepId, furthest: StepId): boolean {
  return stepIndex(step) <= stepIndex(furthest);
}

/** Moving forward records the new furthest step; revisiting never moves it back. */
export function advance(furthest: StepId, to: StepId): StepId {
  return stepIndex(to) > stepIndex(furthest) ? to : furthest;
}

export function projectPath(id: string, step?: StepId | 'clarify' | 'generate'): string {
  return step ? `/p/${id}/${step}` : `/p/${id}`;
}
