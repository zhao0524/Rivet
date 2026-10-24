import type { Obstacle, SimPlan } from "../types";

/** behavior + simulation blocks mirrored from implementation.md Appendix A.2 (`rover_obstacle_v1`). */
export function roverPlan(overrides: {
  behavior?: Partial<SimPlan["behavior"]["parameters"]>;
  simulation?: Partial<SimPlan["simulation"]>;
} = {}): SimPlan {
  return {
    build_id: "rover_obstacle_v1",
    revision: 1,
    behavior: {
      profile_id: "rover.obstacle_avoidance.v1",
      controller_catalog_id: "demo.esp32",
      parameters: {
        obstacle_stop_distance_m: 0.25,
        turn_duration_ms: 600,
        forward_speed_fraction: 0.45,
        ...overrides.behavior,
      },
    },
    simulation: {
      kind: "differential_drive_2d",
      enabled: true,
      wheel_radius_m: 0.0325,
      wheel_base_m: 0.156,
      max_wheel_speed_mps: 0.2,
      sensor_range_m: 1.0,
      sensor_fov_deg: 20,
      limitations: ["Synthetic illustrative dimensions", "Simplified kinematics only", "No physical feasibility verified"],
      ...overrides.simulation,
    },
  };
}

export const WALL_X = 1.2;

/** Bounded scenario: rover at origin facing +x, a long wall straight ahead at x = WALL_X. */
export const wallAhead: Obstacle[] = [
  { kind: "wall", id: "wall-ahead", start: { x: WALL_X, y: -1 }, end: { x: WALL_X, y: 1 } },
];

/** Ticks until FORWARD -> STOP for a straight approach to a perpendicular wall (computed with engine float math). */
export function expectedStopTick(plan: SimPlan, wallX: number): number {
  const p = plan.behavior.parameters;
  const s = plan.simulation;
  const v = p.forward_speed_fraction * s.max_wheel_speed_mps;
  const r = s.wheel_base_m / 2;
  let x = 0;
  for (let tick = 0; tick < 1_000_000; tick++) {
    if (wallX - (x + r) < p.obstacle_stop_distance_m) return tick;
    x = x + v * Math.cos(0) * (1 / 60);
  }
  throw new Error("never stops");
}
