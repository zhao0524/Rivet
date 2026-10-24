import rawPlan from "../../../../../../../fixtures/plans/rover_obstacle_v1.json";
import type { SelectablePlan } from "../types";

/** Shared `fixtures/plans/rover_obstacle_v1.json` (implementation.md Appendix A.2). */
export const roverPlanJson = JSON.stringify(rawPlan);

export function loadRoverPlan(): SelectablePlan & Record<string, unknown> {
  return deepFreeze(JSON.parse(roverPlanJson));
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Same build, next revision, with the given instances removed. */
export function nextRevisionWithout(
  plan: SelectablePlan,
  removed: string[],
): SelectablePlan & Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(plan));
  copy.revision = plan.revision + 1;
  copy.components = copy.components.filter(
    (component: { instance_id: string }) => !removed.includes(component.instance_id),
  );
  return deepFreeze(copy);
}
