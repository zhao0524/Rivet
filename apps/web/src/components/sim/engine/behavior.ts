import type { SimParams } from "./params";
import { nextRandom } from "./rng";
import type { BehaviorState, SensorReading, SimBehavior, StateTransition, TurnDirection, WheelSpeeds } from "./types";

export const ZERO_WHEELS: WheelSpeeds = Object.freeze({ left_mps: 0, right_mps: 0 });

export interface BehaviorDecision {
  behavior: SimBehavior;
  wheels: WheelSpeeds;
  rngState: number;
  transitions: Omit<StateTransition, "time_s">[];
}

/**
 * Obstacle-avoidance policy `rover.obstacle_avoidance.v1` (implementation.md §3.6):
 *
 * - FORWARD: both wheels at forward_speed_fraction * max_wheel_speed_mps. When the sensed
 *   range is `< obstacle_stop_distance_m`, switch to STOP (wheels zero this step).
 * - STOP: hold zero wheel speed for one fixed step, then enter TURN.
 * - TURN: rotate in place for turn_duration_ms, then return to FORWARD (re-evaluated the same step).
 * - DISABLED: wheels zero until an explicit ENABLE event.
 */
export function decideBehavior(
  current: SimBehavior,
  sensor: SensorReading,
  params: SimParams,
  tick: number,
  turnDirection: TurnDirection,
  rngState: number,
): BehaviorDecision {
  const transitions: Omit<StateTransition, "time_s">[] = [];
  let behavior = current;
  let rng = rngState;

  const enter = (to: BehaviorState, reason: StateTransition["reason"], turnSign = behavior.turn_sign) => {
    transitions.push({ from: behavior.state, to, tick, reason });
    behavior = { state: to, entered_tick: tick, turn_sign: turnSign };
  };

  if (behavior.state === "DISABLED") {
    return { behavior, wheels: ZERO_WHEELS, rngState: rng, transitions };
  }

  if (behavior.state === "STOP") {
    let sign: 1 | -1 = turnDirection === "right" ? -1 : 1;
    if (turnDirection === "seeded") {
      const [value, next] = nextRandom(rng);
      rng = next;
      sign = value < 0.5 ? 1 : -1;
    }
    enter("TURN", "stopped", sign);
  }

  if (behavior.state === "TURN") {
    if (tick - behavior.entered_tick >= params.turnTicks) {
      enter("FORWARD", "turn_complete");
    } else {
      const s = params.turnWheelSpeedMps * behavior.turn_sign;
      return { behavior, wheels: { left_mps: -s, right_mps: s }, rngState: rng, transitions };
    }
  }

  // FORWARD
  if (sensor.distance_m !== null && sensor.distance_m < params.stopDistanceM) {
    enter("STOP", "obstacle_within_stop_distance");
    return { behavior, wheels: ZERO_WHEELS, rngState: rng, transitions };
  }
  return {
    behavior,
    wheels: { left_mps: params.forwardSpeedMps, right_mps: params.forwardSpeedMps },
    rngState: rng,
    transitions,
  };
}
