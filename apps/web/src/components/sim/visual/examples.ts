/**
 * Hand-authored, static snapshots for visual debugging of the viewer only.
 * They are NOT simulation output: poses and sensor distances were placed by
 * hand (and checked against the obstacle geometry in tests) so each FSM state
 * and the collision overlay can be inspected without the simulation engine.
 * Rover parameters mirror the synthetic `rover_obstacle_v1` fixture.
 */
import type { RoverVisualConfig, SimArena, SimObstacle, SimSnapshot, SimTrailPoint } from "./types";

export const EXAMPLE_VISUAL_CONFIG: RoverVisualConfig = {
  wheel_base_m: 0.156,
  wheel_radius_m: 0.0325,
  sensor_fov_deg: 20,
  sensor_offset_m: 0.09,
  stop_distance_m: 0.25,
};

export const EXAMPLE_SENSOR_RANGE_M = 1.0;
const CRUISE_MPS = 0.09;

export const EXAMPLE_ARENA: SimArena = { min_x_m: -0.4, max_x_m: 2.6, min_y_m: -1.2, max_y_m: 1.2 };

export const EXAMPLE_OBSTACLES: readonly SimObstacle[] = [
  { id: "wall-ahead", kind: "box", x_m: 1.6, y_m: 0, width_m: 0.12, depth_m: 1.0, height_m: 0.24 },
  { id: "pillar", kind: "circle", x_m: 0.9, y_m: 0.75, radius_m: 0.12, height_m: 0.3 },
  { id: "crate", kind: "box", x_m: 2.1, y_m: -0.7, width_m: 0.3, depth_m: 0.3, rotation_rad: 0.4, height_m: 0.18 },
  { id: "post", kind: "circle", x_m: 0.35, y_m: -0.8, radius_m: 0.06, height_m: 0.2 },
];

function straight(from: SimTrailPoint, to: SimTrailPoint, step_m = 0.03): SimTrailPoint[] {
  const len = Math.hypot(to.x_m - from.x_m, to.y_m - from.y_m);
  const n = Math.max(1, Math.round(len / step_m));
  const out: SimTrailPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x_m: round(from.x_m + (to.x_m - from.x_m) * t), y_m: round(from.y_m + (to.y_m - from.y_m) * t) });
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

const START: SimTrailPoint = { x_m: 0, y_m: 0 };

export interface ExampleSnapshot {
  id: string;
  label: string;
  snapshot: SimSnapshot;
}

function snap(partial: Omit<SimSnapshot, "sensor_range_m">): SimSnapshot {
  return { sensor_range_m: EXAMPLE_SENSOR_RANGE_M, ...partial };
}

export const EXAMPLE_SNAPSHOTS: readonly ExampleSnapshot[] = [
  {
    id: "forward-clear",
    label: "Forward, nothing in range",
    snapshot: snap({
      x_m: 0.3, y_m: 0, theta_rad: 0,
      wheel_speed_left_mps: CRUISE_MPS, wheel_speed_right_mps: CRUISE_MPS,
      sensor_distance_m: null, state: "FORWARD", collision: false,
      trail: straight(START, { x_m: 0.3, y_m: 0 }),
    }),
  },
  {
    id: "forward-detected",
    label: "Forward, wall detected",
    snapshot: snap({
      x_m: 0.85, y_m: 0, theta_rad: 0,
      wheel_speed_left_mps: CRUISE_MPS, wheel_speed_right_mps: CRUISE_MPS,
      sensor_distance_m: 0.6, state: "FORWARD", collision: false,
      trail: straight(START, { x_m: 0.85, y_m: 0 }),
    }),
  },
  {
    id: "stop-threshold",
    label: "Stop at threshold",
    snapshot: snap({
      x_m: 1.21, y_m: 0, theta_rad: 0,
      wheel_speed_left_mps: 0, wheel_speed_right_mps: 0,
      sensor_distance_m: 0.24, state: "STOP", collision: false,
      trail: straight(START, { x_m: 1.21, y_m: 0 }),
    }),
  },
  {
    id: "turn",
    label: "Turning in place",
    snapshot: snap({
      x_m: 1.21, y_m: 0, theta_rad: 0.6,
      wheel_speed_left_mps: -CRUISE_MPS, wheel_speed_right_mps: CRUISE_MPS,
      sensor_distance_m: 0.31, state: "TURN", collision: false,
      trail: straight(START, { x_m: 1.21, y_m: 0 }),
    }),
  },
  {
    id: "forward-after-turn",
    label: "Forward after turn",
    snapshot: snap({
      x_m: 1.23, y_m: 0.12, theta_rad: 1.35,
      wheel_speed_left_mps: CRUISE_MPS, wheel_speed_right_mps: CRUISE_MPS,
      sensor_distance_m: null, state: "FORWARD", collision: false,
      trail: [...straight(START, { x_m: 1.21, y_m: 0 }), ...straight({ x_m: 1.21, y_m: 0 }, { x_m: 1.23, y_m: 0.12 }).slice(1)],
    }),
  },
  {
    id: "disabled",
    label: "Disabled",
    snapshot: snap({
      x_m: 0.7, y_m: 0, theta_rad: 0,
      wheel_speed_left_mps: 0, wheel_speed_right_mps: 0,
      sensor_distance_m: 0.75, state: "DISABLED", collision: false,
      trail: straight(START, { x_m: 0.7, y_m: 0 }),
    }),
  },
  {
    id: "collision",
    label: "Collision reported",
    snapshot: snap({
      x_m: 1.44, y_m: 0, theta_rad: 0,
      wheel_speed_left_mps: 0, wheel_speed_right_mps: 0,
      sensor_distance_m: 0.01, state: "STOP", collision: true,
      trail: straight(START, { x_m: 1.44, y_m: 0 }),
    }),
  },
];

export const EXAMPLE_LIMITATIONS: readonly string[] = [
  "Synthetic illustrative dimensions",
  "Simplified kinematics only",
  "No motor torque, slip or real sensor noise",
];
