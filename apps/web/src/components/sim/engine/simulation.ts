import { ZERO_WHEELS, decideBehavior } from "./behavior";
import { firstOverlap } from "./geometry";
import { bodyVelocity, clampWheelSpeeds, integratePose } from "./kinematics";
import { FIXED_DT_S, MAX_FRAME_DT_S, resolveSimParams, type SimParams } from "./params";
import { normalizeSeed } from "./rng";
import { castFrontSensor, DEFAULT_SENSOR_RAY_COUNT } from "./sensor";
import {
  ENGINE_LIMITATIONS,
  SIMULATION_DISCLAIMER,
  SIMULATION_LABEL,
  type CollisionInfo,
  type Obstacle,
  type Pose,
  type ResolvedSimOptions,
  type SimEvent,
  type SimOptions,
  type SimPlan,
  type SimSnapshot,
  type SimState,
  type StateTransition,
  type Vec2,
} from "./types";

const ACCUMULATOR_EPS = 1e-9;
const CONTACT_BISECTION_ITERATIONS = 30;
/** Max fraction of the footprint radius the rover may translate per collision sub-step. */
const SWEEP_FRACTION = 0.25;

const DEFAULT_OPTIONS: ResolvedSimOptions = {
  turnDirection: "left",
  sensorRayCount: DEFAULT_SENSOR_RAY_COUNT,
  trailSampleEveryTicks: 6,
  trailMaxPoints: 1000,
  maxTransitions: 256,
};

function resolveOptions(options: SimOptions): ResolvedSimOptions {
  const { initialPose: _ignored, ...rest } = options;
  const merged = { ...DEFAULT_OPTIONS, ...stripUndefined(rest) };
  for (const key of ["sensorRayCount", "trailSampleEveryTicks", "trailMaxPoints", "maxTransitions"] as const) {
    if (!Number.isInteger(merged[key]) || merged[key] < 1) {
      throw new RangeError(`options.${key} must be an integer >= 1`);
    }
  }
  return merged;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function appendBounded<T>(list: readonly T[], items: readonly T[], max: number): T[] {
  const next = list.concat(items);
  return next.length > max ? next.slice(next.length - max) : next;
}

function limitationsFor(plan: SimPlan): string[] {
  return [...(plan.simulation.limitations ?? [])];
}

/** Create a fresh simulation for the current plan. Throws `SimConfigError` on an unusable plan. */
export function initSimulation(
  plan: SimPlan,
  obstacles: readonly Obstacle[],
  seed = 0,
  options: SimOptions = {},
): SimState {
  const params = resolveSimParams(plan);
  const resolved = resolveOptions(options);
  const normalizedSeed = normalizeSeed(seed);
  const start = options.initialPose ?? { x: 0, y: 0, theta: 0 };
  for (const v of [start.x, start.y, start.theta]) {
    if (!Number.isFinite(v)) throw new RangeError("options.initialPose must be finite");
  }
  const pose: Pose = { x: start.x, y: start.y, theta: start.theta };

  const blocking = firstOverlap(pose, params.footprintRadiusM, obstacles);
  const collision: CollisionInfo = blocking
    ? { active: true, obstacle_id: blocking.id, count: 1, first_at_s: 0, last_at_s: 0 }
    : { active: false, obstacle_id: null, count: 0, first_at_s: null, last_at_s: null };

  return {
    tick: 0,
    time_s: 0,
    accumulator_s: 0,
    seed: normalizedSeed,
    rng_state: normalizedSeed,
    pose,
    behavior: { state: "FORWARD", entered_tick: 0, turn_sign: 1 },
    wheel_speeds: { ...ZERO_WHEELS },
    linear_speed_mps: 0,
    angular_speed_radps: 0,
    sensor: castFrontSensor(pose, params, obstacles, resolved.sensorRayCount),
    trail: [{ x: pose.x, y: pose.y }],
    collision,
    transitions: [],
    build_id: plan.build_id ?? null,
    revision: plan.revision ?? null,
    plan_limitations: limitationsFor(plan),
    options: resolved,
  };
}

/**
 * Translate from `from` towards `to` without letting the circular footprint penetrate any obstacle.
 * Sub-steps are bounded by a fraction of the footprint radius so thin walls cannot be tunneled.
 */
function sweepTranslation(
  from: Vec2,
  to: Vec2,
  radius: number,
  obstacles: readonly Obstacle[],
): { position: Vec2; blockedBy: Obstacle | null } {
  const startBlock = firstOverlap(from, radius, obstacles);
  if (startBlock) return { position: from, blockedBy: startBlock };

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { position: from, blockedBy: null };

  const subSteps = Math.max(1, Math.ceil(distance / (radius * SWEEP_FRACTION)));
  const at = (f: number): Vec2 => ({ x: from.x + dx * f, y: from.y + dy * f });
  let freeF = 0;
  for (let i = 1; i <= subSteps; i++) {
    const f = i / subSteps;
    const hit = firstOverlap(at(f), radius, obstacles);
    if (hit) {
      let lo = freeF;
      let hi = f;
      for (let k = 0; k < CONTACT_BISECTION_ITERATIONS; k++) {
        const mid = (lo + hi) / 2;
        if (firstOverlap(at(mid), radius, obstacles)) hi = mid;
        else lo = mid;
      }
      return { position: at(lo), blockedBy: hit };
    }
    freeF = f;
  }
  return { position: to, blockedBy: null };
}

function fixedStep(state: SimState, params: SimParams, obstacles: readonly Obstacle[]): SimState {
  const { options } = state;
  const sensor = castFrontSensor(state.pose, params, obstacles, options.sensorRayCount);
  const decision = decideBehavior(
    state.behavior,
    sensor,
    params,
    state.tick,
    options.turnDirection,
    state.rng_state,
  );
  const wheels = clampWheelSpeeds(decision.wheels, params.maxWheelSpeedMps);
  const velocity = bodyVelocity(wheels, params.wheelBaseM);
  const target = integratePose(state.pose, velocity, FIXED_DT_S);
  const swept = sweepTranslation(state.pose, target, params.footprintRadiusM, obstacles);
  const pose: Pose = { x: swept.position.x, y: swept.position.y, theta: target.theta };

  const nextTick = state.tick + 1;
  const nextTime = nextTick * FIXED_DT_S;

  let collision = state.collision;
  if (swept.blockedBy) {
    collision = {
      active: true,
      obstacle_id: swept.blockedBy.id,
      count: state.collision.count + 1,
      first_at_s: state.collision.first_at_s ?? nextTime,
      last_at_s: nextTime,
    };
  } else if (collision.active) {
    collision = { ...collision, active: false, obstacle_id: null };
  }

  const moved = (pose.x - state.pose.x) * Math.cos(state.pose.theta) + (pose.y - state.pose.y) * Math.sin(state.pose.theta);

  const newTransitions: StateTransition[] = decision.transitions.map((t) => ({ ...t, time_s: t.tick * FIXED_DT_S }));
  const trail =
    nextTick % options.trailSampleEveryTicks === 0
      ? appendBounded(state.trail, [{ x: pose.x, y: pose.y }], options.trailMaxPoints)
      : state.trail;

  return {
    ...state,
    tick: nextTick,
    time_s: nextTime,
    rng_state: decision.rngState,
    pose,
    behavior: decision.behavior,
    wheel_speeds: wheels,
    linear_speed_mps: moved / FIXED_DT_S,
    angular_speed_radps: velocity.omega_radps,
    sensor: castFrontSensor(pose, params, obstacles, options.sensorRayCount),
    trail,
    collision,
    transitions: newTransitions.length
      ? appendBounded(state.transitions, newTransitions, options.maxTransitions)
      : state.transitions,
  };
}

function withPlanMetadata(state: SimState, plan: SimPlan): SimState {
  return {
    ...state,
    build_id: plan.build_id ?? null,
    revision: plan.revision ?? null,
    plan_limitations: limitationsFor(plan),
  };
}

/**
 * Advance by a real frame delta. `dtSeconds` is clamped to [0, MAX_FRAME_DT_S] and accumulated;
 * the model only ever integrates fixed 1/60 s steps, so results do not depend on frame rate.
 * Parameters are re-read from `plan` on every call, so plan edits take effect immediately.
 */
export function stepSimulation(
  state: SimState,
  dtSeconds: number,
  plan: SimPlan,
  obstacles: readonly Obstacle[],
): SimState {
  const params = resolveSimParams(plan);
  const dt = Number.isFinite(dtSeconds) ? Math.min(Math.max(dtSeconds, 0), MAX_FRAME_DT_S) : 0;
  let next = withPlanMetadata(state, plan);
  let acc = state.accumulator_s + dt;
  while (acc + ACCUMULATOR_EPS >= FIXED_DT_S) {
    next = fixedStep(next, params, obstacles);
    acc -= FIXED_DT_S;
  }
  return { ...next, accumulator_s: Math.max(0, acc) };
}

/** Advance exactly `ticks` fixed steps (no frame-time clamping); useful for tests and replay. */
export function advanceSimulation(
  state: SimState,
  ticks: number,
  plan: SimPlan,
  obstacles: readonly Obstacle[],
): SimState {
  if (!Number.isInteger(ticks) || ticks < 0) throw new RangeError("ticks must be an integer >= 0");
  const params = resolveSimParams(plan);
  let next = withPlanMetadata(state, plan);
  for (let i = 0; i < ticks; i++) next = fixedStep(next, params, obstacles);
  return next;
}

/** Apply an explicit control event. DISABLE zeroes wheel speeds immediately. */
export function applySimEvent(state: SimState, event: SimEvent): SimState {
  const current = state.behavior.state;
  if (event.type === "DISABLE") {
    if (current === "DISABLED") return state;
    return {
      ...state,
      behavior: { ...state.behavior, state: "DISABLED", entered_tick: state.tick },
      wheel_speeds: { ...ZERO_WHEELS },
      linear_speed_mps: 0,
      angular_speed_radps: 0,
      transitions: appendBounded(
        state.transitions,
        [{ from: current, to: "DISABLED", tick: state.tick, time_s: state.time_s, reason: "disable_event" }],
        state.options.maxTransitions,
      ),
    };
  }
  if (current !== "DISABLED") return state;
  return {
    ...state,
    behavior: { ...state.behavior, state: "FORWARD", entered_tick: state.tick },
    transitions: appendBounded(
      state.transitions,
      [{ from: "DISABLED", to: "FORWARD", tick: state.tick, time_s: state.time_s, reason: "enable_event" }],
      state.options.maxTransitions,
    ),
  };
}

/** JSON-serializable view of the state for UI/telemetry. */
export function getSnapshot(state: SimState, plan?: SimPlan): SimSnapshot {
  const wheelRadius = plan?.simulation.wheel_radius_m;
  const angular = (s: number) => (wheelRadius && wheelRadius > 0 ? s / wheelRadius : 0);
  return {
    label: SIMULATION_LABEL,
    disclaimer: SIMULATION_DISCLAIMER,
    limitations: [...state.plan_limitations, ...ENGINE_LIMITATIONS],
    build_id: state.build_id,
    revision: state.revision,
    tick: state.tick,
    time_s: state.time_s,
    pose: { ...state.pose },
    state: state.behavior.state,
    wheel_speeds: { ...state.wheel_speeds },
    wheel_angular_speeds_radps: {
      left: angular(state.wheel_speeds.left_mps),
      right: angular(state.wheel_speeds.right_mps),
    },
    linear_speed_mps: state.linear_speed_mps,
    angular_speed_radps: state.angular_speed_radps,
    sensor_estimate_m: state.sensor.distance_m,
    sensor: { ...state.sensor, origin: { ...state.sensor.origin }, rays: state.sensor.rays.map((r) => ({ ...r })) },
    trail: state.trail.map((p) => ({ ...p })),
    collision: { ...state.collision },
    transitions: state.transitions.map((t) => ({ ...t })),
  };
}
