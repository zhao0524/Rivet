import type { BuildPlan } from '../../lib/rivet/types';

export { decideBehavior, ZERO_WHEELS, type BehaviorDecision } from './engine/behavior';
export type {
  BehaviorParameters,
  BehaviorSpec,
  BehaviorState,
  SimBehavior,
  StateTransition,
  TurnDirection,
} from './engine/types';

export interface BehaviorSummary {
  profileId: string;
  controllerCatalogId: string;
  stopDistanceM: number | null;
  turnDurationMs: number | null;
  forwardSpeedFraction: number | null;
}

export function summarizeBehaviorSpec(plan: BuildPlan): BehaviorSummary | null {
  if (!plan.behavior) return null;
  const p = plan.behavior.parameters;
  return {
    profileId: plan.behavior.profile_id,
    controllerCatalogId: plan.behavior.controller_catalog_id,
    stopDistanceM: typeof p.obstacle_stop_distance_m === 'number' ? p.obstacle_stop_distance_m : null,
    turnDurationMs: typeof p.turn_duration_ms === 'number' ? p.turn_duration_ms : null,
    forwardSpeedFraction: typeof p.forward_speed_fraction === 'number' ? p.forward_speed_fraction : null,
  };
}
