import type {
  RoverVisualConfig,
  SimArena,
  SimObstacle,
  SimSnapshot,
  SimTrailPoint,
} from "./types";

/**
 * Coordinate mapping between the 2D simulation plane and the 3D stage.
 *
 * The stage uses the project convention (y up, rover front along local +z).
 * Simulation x maps to world x and simulation y maps to world -z, which keeps
 * counter-clockwise headings counter-clockwise when viewed from above.
 * One world unit is one meter.
 */
export type Vec3 = [number, number, number];

export interface RoverPose {
  position: Vec3;
  /** Rotation about world +y applied to a model whose front faces local +z. */
  yaw_rad: number;
}

export const DEFAULT_VISUAL_CONFIG: RoverVisualConfig = {
  wheel_base_m: 0.156,
  wheel_radius_m: 0.0325,
  sensor_fov_deg: 20,
  sensor_offset_m: 0.09,
  stop_distance_m: null,
};

export function resolveVisualConfig(
  config?: Partial<RoverVisualConfig>,
): RoverVisualConfig {
  const merged = { ...DEFAULT_VISUAL_CONFIG, ...config };
  return {
    ...merged,
    wheel_base_m: positiveOr(merged.wheel_base_m, DEFAULT_VISUAL_CONFIG.wheel_base_m),
    wheel_radius_m: positiveOr(merged.wheel_radius_m, DEFAULT_VISUAL_CONFIG.wheel_radius_m),
    sensor_fov_deg: positiveOr(merged.sensor_fov_deg, DEFAULT_VISUAL_CONFIG.sensor_fov_deg),
  };
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function simToWorld(x_m: number, y_m: number, height_m = 0): Vec3 {
  return [x_m, height_m, -y_m];
}

export function headingToYaw(theta_rad: number): number {
  return theta_rad + Math.PI / 2;
}

export function snapshotToPose(
  snapshot: Pick<SimSnapshot, "x_m" | "y_m" | "theta_rad">,
): RoverPose {
  return {
    position: simToWorld(snapshot.x_m, snapshot.y_m),
    yaw_rad: headingToYaw(snapshot.theta_rad),
  };
}

/** Wheel contact centers in the simulation plane (left is +90 degrees from heading). */
export function wheelPositionsSim(
  snapshot: Pick<SimSnapshot, "x_m" | "y_m" | "theta_rad">,
  wheel_base_m: number,
): { left: SimTrailPoint; right: SimTrailPoint } {
  const half = wheel_base_m / 2;
  const nx = -Math.sin(snapshot.theta_rad);
  const ny = Math.cos(snapshot.theta_rad);
  return {
    left: { x_m: snapshot.x_m + nx * half, y_m: snapshot.y_m + ny * half },
    right: { x_m: snapshot.x_m - nx * half, y_m: snapshot.y_m - ny * half },
  };
}

export function sensorOriginSim(
  snapshot: Pick<SimSnapshot, "x_m" | "y_m" | "theta_rad">,
  sensor_offset_m: number,
): SimTrailPoint {
  return {
    x_m: snapshot.x_m + Math.cos(snapshot.theta_rad) * sensor_offset_m,
    y_m: snapshot.y_m + Math.sin(snapshot.theta_rad) * sensor_offset_m,
  };
}

/** Point where the sensor ray ends: the detected return, or the edge of range. */
export function sensorHitSim(
  snapshot: SimSnapshot,
  sensor_offset_m: number,
): SimTrailPoint {
  const origin = sensorOriginSim(snapshot, sensor_offset_m);
  const length = visibleRayLength(snapshot);
  return {
    x_m: origin.x_m + Math.cos(snapshot.theta_rad) * length,
    y_m: origin.y_m + Math.sin(snapshot.theta_rad) * length,
  };
}

export function visibleRayLength(
  snapshot: Pick<SimSnapshot, "sensor_distance_m" | "sensor_range_m">,
): number {
  const range = Math.max(0, snapshot.sensor_range_m);
  if (snapshot.sensor_distance_m == null || !Number.isFinite(snapshot.sensor_distance_m)) {
    return range;
  }
  return clamp(snapshot.sensor_distance_m, 0, range);
}

/** Wheel spin in radians after `dt_s`; positive speed rolls the rover forward. */
export function advanceWheelAngle(
  angle_rad: number,
  speed_mps: number,
  wheel_radius_m: number,
  dt_s: number,
): number {
  if (!(wheel_radius_m > 0) || !Number.isFinite(speed_mps)) return angle_rad;
  const next = angle_rad + (speed_mps / wheel_radius_m) * Math.max(0, dt_s);
  return next % (Math.PI * 2);
}

export function linearSpeed(
  snapshot: Pick<SimSnapshot, "wheel_speed_left_mps" | "wheel_speed_right_mps">,
): number {
  return (snapshot.wheel_speed_left_mps + snapshot.wheel_speed_right_mps) / 2;
}

export function angularSpeed(
  snapshot: Pick<SimSnapshot, "wheel_speed_left_mps" | "wheel_speed_right_mps">,
  wheel_base_m: number,
): number {
  if (!(wheel_base_m > 0)) return 0;
  return (snapshot.wheel_speed_right_mps - snapshot.wheel_speed_left_mps) / wheel_base_m;
}

/**
 * Sensor fan triangles in rover-local space (front along +z), centered on the
 * sensor. Returned as a flat xyz array suitable for a BufferGeometry.
 */
export function sensorFanPositions(
  fov_deg: number,
  range_m: number,
  segments = 24,
): Float32Array {
  const half = ((fov_deg * Math.PI) / 180) / 2;
  const count = Math.max(1, Math.floor(segments));
  const out = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const a0 = -half + (2 * half * i) / count;
    const a1 = -half + (2 * half * (i + 1)) / count;
    out.set(
      [0, 0, 0, Math.sin(a0) * range_m, 0, Math.cos(a0) * range_m, Math.sin(a1) * range_m, 0, Math.cos(a1) * range_m],
      i * 9,
    );
  }
  return out;
}

export function isDisabledState(state: string): boolean {
  return state === "DISABLE" || state === "DISABLED";
}

export type SensorTone = "clear" | "detected" | "threshold";

export function sensorTone(
  snapshot: Pick<SimSnapshot, "sensor_distance_m" | "sensor_range_m">,
  stop_distance_m: number | null,
): SensorTone {
  const d = snapshot.sensor_distance_m;
  if (d == null || !Number.isFinite(d) || d > snapshot.sensor_range_m) return "clear";
  if (stop_distance_m != null && d < stop_distance_m) return "threshold";
  return "detected";
}

/** Bounds that contain every obstacle, the trail and the rover, with padding. */
export function computeArena(
  obstacles: readonly SimObstacle[],
  snapshot: SimSnapshot | null,
  padding_m = 0.4,
): SimArena {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const o of obstacles) {
    const r = o.kind === "circle" ? o.radius_m : Math.hypot(o.width_m, o.depth_m) / 2;
    xs.push(o.x_m - r, o.x_m + r);
    ys.push(o.y_m - r, o.y_m + r);
  }
  if (snapshot) {
    xs.push(snapshot.x_m);
    ys.push(snapshot.y_m);
    for (const p of snapshot.trail) {
      xs.push(p.x_m);
      ys.push(p.y_m);
    }
  }
  if (xs.length === 0) {
    return { min_x_m: -1, max_x_m: 1, min_y_m: -1, max_y_m: 1 };
  }
  return {
    min_x_m: Math.min(...xs) - padding_m,
    max_x_m: Math.max(...xs) + padding_m,
    min_y_m: Math.min(...ys) - padding_m,
    max_y_m: Math.max(...ys) + padding_m,
  };
}

export function arenaCenterWorld(arena: SimArena): Vec3 {
  return simToWorld((arena.min_x_m + arena.max_x_m) / 2, (arena.min_y_m + arena.max_y_m) / 2);
}

export function arenaSize(arena: SimArena): { width_m: number; depth_m: number } {
  return {
    width_m: Math.max(0.1, arena.max_x_m - arena.min_x_m),
    depth_m: Math.max(0.1, arena.max_y_m - arena.min_y_m),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
