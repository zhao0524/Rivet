import type { BuildPlan } from '../../lib/rivet/types';
import {
  FIXED_DT_S,
  FIXED_STEP_HZ,
  MAX_FRAME_DT_S,
  SimConfigError,
  advanceSimulation,
  applySimEvent,
  arenaWalls,
  bodyVelocity,
  decideBehavior,
  getSnapshot,
  initSimulation,
  integratePose,
  normalizeAngle,
  raycastFrontSensor,
  resolveSimParams,
  sensorRayAngles,
  stepSimulation,
  type Obstacle as EngineObstacle,
  type SimOptions,
  type SimParams,
  type SimPlan,
  type SimSnapshot as EngineSimSnapshot,
  type SimState,
  type TurnDirection,
} from './engine';
import { EXAMPLE_ARENA, EXAMPLE_OBSTACLES } from './visual/examples';
import type {
  RoverVisualConfig,
  SimArena,
  SimObstacle as VisualSimObstacle,
  SimSnapshot as VisualSimSnapshot,
} from './visual/types';

export {
  FIXED_DT_S,
  FIXED_STEP_HZ,
  MAX_FRAME_DT_S,
  SimConfigError,
  advanceSimulation,
  applySimEvent,
  arenaWalls,
  bodyVelocity,
  decideBehavior,
  getSnapshot,
  initSimulation,
  integratePose,
  normalizeAngle,
  raycastFrontSensor,
  resolveSimParams,
  sensorRayAngles,
  stepSimulation,
  type EngineObstacle,
  type EngineSimSnapshot,
  type SimOptions,
  type SimParams,
  type SimPlan,
  type SimState,
  type TurnDirection,
};

export interface SimScenarioPreset {
  id: string;
  label: string;
  description: string;
  arena: SimArena;
  initialPose: { x: number; y: number; theta: number };
  obstacles: readonly VisualSimObstacle[];
}

export const SIM_SCENARIOS: readonly SimScenarioPreset[] = Object.freeze([
  {
    id: 'obstacle-course',
    label: 'Obstacle course',
    description: 'Multi-obstacle indoor test arena with wall, pillar, crate, and post.',
    arena: EXAMPLE_ARENA,
    initialPose: { x: 0, y: 0, theta: 0 },
    obstacles: EXAMPLE_OBSTACLES,
  },
  {
    id: 'wall-ahead',
    label: 'Canonical wall ahead',
    description: 'Single wall directly ahead at x = 0.85 m to verify deterministic STOP and TURN.',
    arena: { min_x_m: -0.4, max_x_m: 1.6, min_y_m: -0.9, max_y_m: 0.9 },
    initialPose: { x: 0, y: 0, theta: 0 },
    obstacles: [
      { id: 'front-wall', kind: 'box', x_m: 0.91, y_m: 0, width_m: 0.12, depth_m: 1.2, height_m: 0.24 },
    ],
  },
  {
    id: 'chicane',
    label: 'Chicane corridor',
    description: 'Staggered barriers requiring sequential obstacle detection and turns.',
    arena: { min_x_m: -0.4, max_x_m: 2.4, min_y_m: -1.0, max_y_m: 1.0 },
    initialPose: { x: 0, y: 0, theta: 0 },
    obstacles: [
      { id: 'barrier-1', kind: 'box', x_m: 0.95, y_m: 0.15, width_m: 0.14, depth_m: 0.7, height_m: 0.22 },
      { id: 'barrier-2', kind: 'box', x_m: 1.65, y_m: -0.2, width_m: 0.14, depth_m: 0.7, height_m: 0.22 },
      { id: 'column-1', kind: 'circle', x_m: 0.55, y_m: -0.55, radius_m: 0.11, height_m: 0.25 },
    ],
  },
]);

/**
 * Extracts a validated `SimPlan` from a `BuildPlan`, or returns an error reason when
 * the plan disables simulation or omits required numeric parameters.
 */
export function extractSimPlan(
  plan: BuildPlan,
): { ok: true; simPlan: SimPlan; params: SimParams } | { ok: false; reason: string } {
  if (!plan.simulation || !plan.simulation.enabled || plan.simulation.kind !== 'differential_drive_2d') {
    return { ok: false, reason: 'Simulation is disabled or unsupported for this BuildPlan.' };
  }
  if (!plan.behavior) {
    return { ok: false, reason: 'BuildPlan has no behavior specification.' };
  }
  const candidate: SimPlan = {
    build_id: plan.build_id,
    revision: plan.revision,
    behavior: {
      profile_id: plan.behavior.profile_id,
      controller_catalog_id: plan.behavior.controller_catalog_id,
      parameters: {
        obstacle_stop_distance_m: Number(plan.behavior.parameters.obstacle_stop_distance_m),
        turn_duration_ms: Number(plan.behavior.parameters.turn_duration_ms),
        forward_speed_fraction: Number(plan.behavior.parameters.forward_speed_fraction),
      },
    },
    simulation: {
      kind: plan.simulation.kind,
      enabled: plan.simulation.enabled,
      wheel_radius_m: Number(plan.simulation.wheel_radius_m),
      wheel_base_m: Number(plan.simulation.wheel_base_m),
      max_wheel_speed_mps: Number(plan.simulation.max_wheel_speed_mps),
      sensor_range_m: Number(plan.simulation.sensor_range_m),
      sensor_fov_deg: Number(plan.simulation.sensor_fov_deg),
      limitations: [...plan.simulation.limitations],
    },
  };
  try {
    const params = resolveSimParams(candidate);
    return { ok: true, simPlan: candidate, params };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Invalid simulation configuration',
    };
  }
}

/**
 * Converts visual stage obstacles (`SimObstacle[]`) and optional arena bounds into
 * the 2D kinematic engine's `Obstacle[]` representation.
 */
export function visualObstaclesToEngineObstacles(
  obstacles: readonly VisualSimObstacle[],
  arena?: SimArena,
): EngineObstacle[] {
  const result: EngineObstacle[] = [];
  for (const obs of obstacles) {
    if (obs.kind === 'circle') {
      result.push({
        kind: 'circle',
        id: obs.id,
        center: { x: obs.x_m, y: obs.y_m },
        radius_m: obs.radius_m,
      });
    } else {
      const hw = obs.width_m / 2;
      const hd = obs.depth_m / 2;
      const rot = obs.rotation_rad ?? 0;
      if (Math.abs(rot) < 1e-9) {
        result.push({
          kind: 'box',
          id: obs.id,
          min: { x: obs.x_m - hw, y: obs.y_m - hd },
          max: { x: obs.x_m + hw, y: obs.y_m + hd },
        });
      } else {
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const localCorners: ReadonlyArray<[number, number]> = [
          [-hw, -hd],
          [hw, -hd],
          [hw, hd],
          [-hw, hd],
        ];
        result.push({
          kind: 'polygon',
          id: obs.id,
          points: localCorners.map(([lx, ly]) => ({
            x: obs.x_m + lx * c - ly * s,
            y: obs.y_m + lx * s + ly * c,
          })),
        });
      }
    }
  }
  if (arena) {
    result.push(...arenaWalls(arena.min_x_m, arena.min_y_m, arena.max_x_m, arena.max_y_m));
  }
  return result;
}

/**
 * Maps an `EngineSimSnapshot` from `sim/engine` into the `VisualSimSnapshot` consumed
 * by `<RoverSimulationView>` in `sim/visual`.
 */
export function engineSnapshotToVisualSnapshot(snapshot: EngineSimSnapshot): VisualSimSnapshot {
  return {
    x_m: snapshot.pose.x,
    y_m: snapshot.pose.y,
    theta_rad: snapshot.pose.theta,
    wheel_speed_left_mps: snapshot.wheel_speeds.left_mps,
    wheel_speed_right_mps: snapshot.wheel_speeds.right_mps,
    sensor_range_m: snapshot.sensor.range_m,
    sensor_distance_m: snapshot.sensor_estimate_m,
    state: snapshot.state,
    trail: snapshot.trail.map((p) => ({ x_m: p.x, y_m: p.y })),
    collision: snapshot.collision.active,
  };
}

/**
 * Extracts `RoverVisualConfig` from a `BuildPlan` so the 3D rover and sensor cone
 * match the exact wheel base, wheel radius, sensor FOV, and stop distance of the active revision.
 */
export function extractVisualConfigFromPlan(plan: BuildPlan): Partial<RoverVisualConfig> {
  const wheelBase = typeof plan.simulation?.wheel_base_m === 'number' ? plan.simulation.wheel_base_m : 0.156;
  const wheelRadius = typeof plan.simulation?.wheel_radius_m === 'number' ? plan.simulation.wheel_radius_m : 0.0325;
  const sensorFov = typeof plan.simulation?.sensor_fov_deg === 'number' ? plan.simulation.sensor_fov_deg : 20;
  const stopDist =
    typeof plan.behavior?.parameters?.obstacle_stop_distance_m === 'number'
      ? plan.behavior.parameters.obstacle_stop_distance_m
      : null;

  return {
    wheel_base_m: wheelBase,
    wheel_radius_m: wheelRadius,
    sensor_fov_deg: sensorFov,
    sensor_offset_m: wheelBase / 2,
    stop_distance_m: stopDist,
  };
}
