/**
 * Types for Rivet's simplified 2D differential-drive rover simulation.
 *
 * Units: meters, seconds, radians. Heading `theta` is measured counter-clockwise
 * from the +x axis of the 2D simulation plane.
 */

export const SIMULATION_LABEL = "Simplified kinematic simulation" as const;

export const SIMULATION_DISCLAIMER: string =
  "Simplified 2D differential-drive kinematic approximation driven by the current BuildPlan. " +
  "It is not a physics model and not a hardware safety certification.";

export const ENGINE_LIMITATIONS: readonly string[] = Object.freeze([
  "2D kinematics only: no motor torque, inertia, acceleration limits or wheel slip",
  "Wheel speeds change instantly; no battery, driver or motor response modeled",
  "Rover footprint approximated as a circle of radius wheel_base_m / 2",
  "Front range sensor approximated by noiseless rays and a cone test across sensor_fov_deg",
  "Collisions stop the rover at contact; no bounce, push or damage is modeled",
]);

/** `BuildPlan.behavior.parameters` (implementation.md §3.6). */
export interface BehaviorParameters {
  obstacle_stop_distance_m: number;
  turn_duration_ms: number;
  forward_speed_fraction: number;
}

/** `BuildPlan.behavior` (implementation.md §3.6). */
export interface BehaviorSpec {
  profile_id: string;
  controller_catalog_id?: string | null;
  parameters: BehaviorParameters;
}

/** `BuildPlan.simulation` (implementation.md §3.3/§3.4). */
export interface SimulationConfig {
  kind: "differential_drive_2d" | "none";
  enabled: boolean;
  wheel_radius_m: number;
  wheel_base_m: number;
  max_wheel_speed_mps: number;
  sensor_range_m: number;
  sensor_fov_deg: number;
  limitations: string[];
}

/** The subset of `BuildPlan` the engine reads. A full BuildPlan satisfies this shape. */
export interface SimPlan {
  build_id?: string;
  revision?: number;
  behavior: BehaviorSpec;
  simulation: SimulationConfig;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  /** Heading in radians, normalized to (-PI, PI]. */
  theta: number;
}

export interface CircleObstacle {
  kind: "circle";
  id: string;
  center: Vec2;
  radius_m: number;
}

/** Zero-thickness wall segment. */
export interface WallObstacle {
  kind: "wall";
  id: string;
  start: Vec2;
  end: Vec2;
}

/** Axis-aligned solid box. */
export interface BoxObstacle {
  kind: "box";
  id: string;
  min: Vec2;
  max: Vec2;
}

/** Solid simple polygon (implicitly closed, any winding). */
export interface PolygonObstacle {
  kind: "polygon";
  id: string;
  points: Vec2[];
}

export type Obstacle = CircleObstacle | WallObstacle | BoxObstacle | PolygonObstacle;

export type BehaviorState = "FORWARD" | "STOP" | "TURN" | "DISABLED";

export type SimEvent = { type: "DISABLE" } | { type: "ENABLE" };

export type TurnDirection = "left" | "right" | "seeded";

export interface WheelSpeeds {
  left_mps: number;
  right_mps: number;
}

export interface SensorRay {
  /** Ray angle relative to rover heading, radians. */
  angle_rad: number;
  /** Distance from the sensor origin to the first hit, or null if nothing within range. */
  distance_m: number | null;
  obstacle_id: string | null;
}

export interface SensorReading {
  /** Minimum distance across rays and in-cone features, or null when nothing is within range. */
  distance_m: number | null;
  obstacle_id: string | null;
  origin: Vec2;
  heading_rad: number;
  range_m: number;
  fov_rad: number;
  rays: SensorRay[];
}

export interface CollisionInfo {
  /** True if the rover was blocked by an obstacle during the most recent fixed step. */
  active: boolean;
  obstacle_id: string | null;
  count: number;
  first_at_s: number | null;
  last_at_s: number | null;
}

export interface StateTransition {
  from: BehaviorState;
  to: BehaviorState;
  tick: number;
  time_s: number;
  reason: "obstacle_within_stop_distance" | "stopped" | "turn_complete" | "disable_event" | "enable_event";
}

export interface SimOptions {
  initialPose?: Pose;
  /** Turn direction for TURN. `seeded` picks left/right per turn from the seeded PRNG. Default `left`. */
  turnDirection?: TurnDirection;
  /** Number of rays used to approximate the sensor FOV. Default 9. */
  sensorRayCount?: number;
  /** Trail sampling interval in fixed ticks. Default 6 (10 Hz). */
  trailSampleEveryTicks?: number;
  /** Maximum trail points kept (oldest dropped). Default 1000. */
  trailMaxPoints?: number;
  /** Maximum transitions kept (oldest dropped). Default 256. */
  maxTransitions?: number;
}

export type ResolvedSimOptions = Required<Omit<SimOptions, "initialPose">>;

export interface SimBehavior {
  state: BehaviorState;
  entered_tick: number;
  /** +1 = counter-clockwise (left), -1 = clockwise (right). */
  turn_sign: 1 | -1;
}

/** Full engine state. Treat as immutable; every engine function returns a new state. */
export interface SimState {
  tick: number;
  time_s: number;
  accumulator_s: number;
  seed: number;
  rng_state: number;
  pose: Pose;
  behavior: SimBehavior;
  wheel_speeds: WheelSpeeds;
  linear_speed_mps: number;
  angular_speed_radps: number;
  sensor: SensorReading;
  trail: Vec2[];
  collision: CollisionInfo;
  transitions: StateTransition[];
  build_id: string | null;
  revision: number | null;
  plan_limitations: string[];
  options: ResolvedSimOptions;
}

/** Read-only view for UI/telemetry. JSON-serializable. */
export interface SimSnapshot {
  label: typeof SIMULATION_LABEL;
  disclaimer: string;
  limitations: string[];
  build_id: string | null;
  revision: number | null;
  tick: number;
  time_s: number;
  pose: Pose;
  state: BehaviorState;
  wheel_speeds: WheelSpeeds;
  /** Wheel angular speeds derived from `wheel_radius_m` (rad/s), for wheel animation. */
  wheel_angular_speeds_radps: { left: number; right: number };
  /** Achieved body speed along heading during the last fixed step (0 when blocked). */
  linear_speed_mps: number;
  angular_speed_radps: number;
  sensor_estimate_m: number | null;
  sensor: SensorReading;
  trail: Vec2[];
  collision: CollisionInfo;
  transitions: StateTransition[];
}
