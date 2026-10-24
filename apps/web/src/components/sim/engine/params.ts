import type { SimPlan } from "./types";

export const FIXED_STEP_HZ = 60;
export const FIXED_DT_S = 1 / FIXED_STEP_HZ;
/** Largest frame delta accepted per `stepSimulation` call (implementation.md C4). */
export const MAX_FRAME_DT_S = 0.05;

export class SimConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimConfigError";
  }
}

/** Engine parameters derived from the current plan. Nothing here is a fixed product claim. */
export interface SimParams {
  wheelBaseM: number;
  wheelRadiusM: number;
  maxWheelSpeedMps: number;
  sensorRangeM: number;
  sensorFovRad: number;
  stopDistanceM: number;
  turnDurationMs: number;
  turnTicks: number;
  forwardSpeedMps: number;
  turnWheelSpeedMps: number;
  footprintRadiusM: number;
}

function requirePositive(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SimConfigError(`${name} must be a finite number > 0 (got ${String(value)})`);
  }
  return value;
}

function requireNonNegative(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SimConfigError(`${name} must be a finite number >= 0 (got ${String(value)})`);
  }
  return value;
}

export function resolveSimParams(plan: SimPlan): SimParams {
  const sim = plan?.simulation;
  const params = plan?.behavior?.parameters;
  if (!sim) throw new SimConfigError("plan.simulation is missing");
  if (!params) throw new SimConfigError("plan.behavior.parameters is missing");
  if (sim.kind !== "differential_drive_2d") {
    throw new SimConfigError(`simulation.kind '${String(sim.kind)}' is not supported`);
  }
  if (sim.enabled !== true) throw new SimConfigError("simulation.enabled is false for this plan");

  const wheelBaseM = requirePositive("simulation.wheel_base_m", sim.wheel_base_m);
  const wheelRadiusM = requirePositive("simulation.wheel_radius_m", sim.wheel_radius_m);
  const maxWheelSpeedMps = requirePositive("simulation.max_wheel_speed_mps", sim.max_wheel_speed_mps);
  const sensorRangeM = requirePositive("simulation.sensor_range_m", sim.sensor_range_m);
  const sensorFovDeg = requireNonNegative("simulation.sensor_fov_deg", sim.sensor_fov_deg);
  if (sensorFovDeg >= 180) throw new SimConfigError("simulation.sensor_fov_deg must be < 180");

  const stopDistanceM = requireNonNegative(
    "behavior.parameters.obstacle_stop_distance_m",
    params.obstacle_stop_distance_m,
  );
  const turnDurationMs = requirePositive("behavior.parameters.turn_duration_ms", params.turn_duration_ms);
  const fraction = requirePositive("behavior.parameters.forward_speed_fraction", params.forward_speed_fraction);
  if (fraction > 1) throw new SimConfigError("behavior.parameters.forward_speed_fraction must be <= 1");

  const forwardSpeedMps = fraction * maxWheelSpeedMps;
  return {
    wheelBaseM,
    wheelRadiusM,
    maxWheelSpeedMps,
    sensorRangeM,
    sensorFovRad: (sensorFovDeg * Math.PI) / 180,
    stopDistanceM,
    turnDurationMs,
    turnTicks: Math.max(1, Math.round((turnDurationMs * FIXED_STEP_HZ) / 1000)),
    forwardSpeedMps,
    turnWheelSpeedMps: forwardSpeedMps,
    footprintRadiusM: wheelBaseM / 2,
  };
}
