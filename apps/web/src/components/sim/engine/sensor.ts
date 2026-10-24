import { normalizeAngle, obstacleSegments, rayObstacle } from "./geometry";
import { resolveSimParams, type SimParams } from "./params";
import type { Obstacle, Pose, SensorRay, SensorReading, SimPlan, Vec2 } from "./types";

export const DEFAULT_SENSOR_RAY_COUNT = 9;

export function sensorRayAngles(fovRad: number, rayCount: number): number[] {
  const n = Math.max(1, Math.floor(rayCount));
  if (n === 1 || fovRad === 0) return [0];
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(-fovRad / 2 + (i * fovRad) / (n - 1));
  return angles;
}

/**
 * Closest point of an obstacle feature that lies inside the sensor cone (circles and polygon/wall
 * vertices), so small features between rays are still detected. Returns null when none qualifies.
 */
function coneFeatureDistance(origin: Vec2, heading: number, halfFov: number, range: number, obstacle: Obstacle): number | null {
  if (obstacle.kind === "circle") {
    const dx = obstacle.center.x - origin.x;
    const dy = obstacle.center.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (d <= obstacle.radius_m) return 0;
    const surface = d - obstacle.radius_m;
    if (surface > range) return null;
    const offset = Math.abs(normalizeAngle(Math.atan2(dy, dx) - heading));
    return offset <= halfFov + Math.asin(obstacle.radius_m / d) && offset < Math.PI / 2 ? surface : null;
  }
  let best: number | null = null;
  for (const [vertex] of obstacleSegments(obstacle)) {
    const dx = vertex.x - origin.x;
    const dy = vertex.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (d > range) continue;
    if (Math.abs(normalizeAngle(Math.atan2(dy, dx) - heading)) <= halfFov && (best === null || d < best)) best = d;
  }
  if (obstacle.kind === "wall") {
    const d = Math.hypot(obstacle.end.x - origin.x, obstacle.end.y - origin.y);
    const offset = Math.abs(normalizeAngle(Math.atan2(obstacle.end.y - origin.y, obstacle.end.x - origin.x) - heading));
    if (d <= range && offset <= halfFov && (best === null || d < best)) best = d;
  }
  return best;
}

/** Sensor is mounted at the front edge of the circular footprint, facing the rover heading. */
export function castFrontSensor(
  pose: Pose,
  params: SimParams,
  obstacles: readonly Obstacle[],
  rayCount: number = DEFAULT_SENSOR_RAY_COUNT,
): SensorReading {
  const cos = Math.cos(pose.theta);
  const sin = Math.sin(pose.theta);
  const origin = { x: pose.x + params.footprintRadiusM * cos, y: pose.y + params.footprintRadiusM * sin };
  const range = params.sensorRangeM;

  let bestDistance: number | null = null;
  let bestId: string | null = null;
  const rays: SensorRay[] = [];
  for (const angle of sensorRayAngles(params.sensorFovRad, rayCount)) {
    const dir = { x: Math.cos(pose.theta + angle), y: Math.sin(pose.theta + angle) };
    let rayDistance: number | null = null;
    let rayId: string | null = null;
    for (const obstacle of obstacles) {
      const t = rayObstacle(origin, dir, obstacle);
      if (t !== null && t <= range && (rayDistance === null || t < rayDistance)) {
        rayDistance = t;
        rayId = obstacle.id;
      }
    }
    rays.push({ angle_rad: angle, distance_m: rayDistance, obstacle_id: rayId });
    if (rayDistance !== null && (bestDistance === null || rayDistance < bestDistance)) {
      bestDistance = rayDistance;
      bestId = rayId;
    }
  }

  const halfFov = params.sensorFovRad / 2;
  for (const obstacle of obstacles) {
    const d = coneFeatureDistance(origin, pose.theta, halfFov, range, obstacle);
    if (d !== null && (bestDistance === null || d < bestDistance)) {
      bestDistance = d;
      bestId = obstacle.id;
    }
  }

  return {
    distance_m: bestDistance,
    obstacle_id: bestId,
    origin,
    heading_rad: pose.theta,
    range_m: range,
    fov_rad: params.sensorFovRad,
    rays,
  };
}

/**
 * Raycast the plan's front range sensor from `pose`. Range and FOV come from
 * `plan.simulation`; the FOV is approximated by `rayCount` evenly spaced rays plus a cone test
 * for circles and polygon/wall vertices. `distance_m` is the minimum over both.
 */
export function raycastFrontSensor(
  pose: Pose,
  plan: SimPlan,
  obstacles: readonly Obstacle[],
  rayCount: number = DEFAULT_SENSOR_RAY_COUNT,
): SensorReading {
  return castFrontSensor(pose, resolveSimParams(plan), obstacles, rayCount);
}
