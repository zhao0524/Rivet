/**
 * Structural types for the simulator viewer. These intentionally mirror the
 * snapshot shape the simulation engine publishes, without importing it, so the
 * viewer stays decoupled from the physics implementation.
 *
 * Units follow the simulator contract: meters, radians, meters per second.
 * The 2D simulation plane is (x_m, y_m) with theta measured counter-clockwise
 * from +x when viewed from above.
 */

export interface SimTrailPoint {
  x_m: number;
  y_m: number;
}

/** Known FSM states; other strings are rendered verbatim with a neutral color. */
export type KnownSimState = "FORWARD" | "STOP" | "TURN" | "DISABLE" | "DISABLED";

export interface SimSnapshot {
  x_m: number;
  y_m: number;
  theta_rad: number;
  wheel_speed_left_mps: number;
  wheel_speed_right_mps: number;
  sensor_range_m: number;
  /** Distance to the nearest return within range, or null when nothing is sensed. */
  sensor_distance_m: number | null;
  state: KnownSimState | (string & {});
  trail: readonly SimTrailPoint[];
  collision: boolean;
}

export interface SimBoxObstacle {
  id: string;
  kind: "box";
  /** Center of the box in the simulation plane. */
  x_m: number;
  y_m: number;
  /** Extent along the obstacle's local x axis (sim x when rotation is 0). */
  width_m: number;
  /** Extent along the obstacle's local y axis (sim y when rotation is 0). */
  depth_m: number;
  /** Counter-clockwise rotation in the simulation plane. */
  rotation_rad?: number;
  /** Visual height only; the simulation is 2D. */
  height_m?: number;
}

export interface SimCircleObstacle {
  id: string;
  kind: "circle";
  x_m: number;
  y_m: number;
  radius_m: number;
  height_m?: number;
}

export type SimObstacle = SimBoxObstacle | SimCircleObstacle;

/** Axis-aligned bounds of the course in the simulation plane. */
export interface SimArena {
  min_x_m: number;
  max_x_m: number;
  min_y_m: number;
  max_y_m: number;
}

/**
 * Visual parameters for the rover model and sensor overlay. Pass values from
 * the active BuildPlan's `simulation` / `behavior` blocks so the drawing
 * matches the simulated vehicle.
 */
export interface RoverVisualConfig {
  wheel_base_m: number;
  wheel_radius_m: number;
  sensor_fov_deg: number;
  /** Forward offset of the range sensor from the rover's kinematic center. */
  sensor_offset_m: number;
  /** Optional behavior threshold; used only to color the sensor overlay. */
  stop_distance_m: number | null;
}

export type SimPlaybackStatus = "playing" | "paused";
