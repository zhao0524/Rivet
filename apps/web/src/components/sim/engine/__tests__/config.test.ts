import { describe, expect, it } from "vitest";
import { initSimulation, resolveSimParams, SimConfigError, stepSimulation } from "../index";
import { roverPlan } from "./fixtures";

describe("plan-derived configuration", () => {
  it("derives every parameter from the plan", () => {
    const p = resolveSimParams(roverPlan());
    expect(p).toMatchObject({
      wheelBaseM: 0.156,
      wheelRadiusM: 0.0325,
      maxWheelSpeedMps: 0.2,
      sensorRangeM: 1.0,
      stopDistanceM: 0.25,
      turnDurationMs: 600,
      turnTicks: 36,
      footprintRadiusM: 0.078,
    });
    expect(p.forwardSpeedMps).toBeCloseTo(0.09, 12);
    expect(p.sensorFovRad).toBeCloseTo(Math.PI / 9, 12);
  });

  it.each([
    ["kind none", roverPlan({ simulation: { kind: "none" } })],
    ["disabled simulation", roverPlan({ simulation: { enabled: false } })],
    ["zero wheel base", roverPlan({ simulation: { wheel_base_m: 0 } })],
    ["negative max speed", roverPlan({ simulation: { max_wheel_speed_mps: -1 } })],
    ["NaN range", roverPlan({ simulation: { sensor_range_m: Number.NaN } })],
    ["fov >= 180", roverPlan({ simulation: { sensor_fov_deg: 180 } })],
    ["fraction > 1", roverPlan({ behavior: { forward_speed_fraction: 1.5 } })],
    ["negative stop distance", roverPlan({ behavior: { obstacle_stop_distance_m: -0.1 } })],
    ["zero turn duration", roverPlan({ behavior: { turn_duration_ms: 0 } })],
  ])("rejects an unusable plan: %s", (_name, plan) => {
    expect(() => initSimulation(plan, [])).toThrow(SimConfigError);
  });

  it("rejects an invalid plan passed to stepSimulation", () => {
    const s = initSimulation(roverPlan(), []);
    expect(() => stepSimulation(s, 1 / 60, roverPlan({ simulation: { enabled: false } }), [])).toThrow(SimConfigError);
  });

  it("rejects invalid seeds and options", () => {
    expect(() => initSimulation(roverPlan(), [], Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => initSimulation(roverPlan(), [], 0, { sensorRayCount: 0 })).toThrow(RangeError);
    expect(() => initSimulation(roverPlan(), [], 0, { initialPose: { x: Number.NaN, y: 0, theta: 0 } })).toThrow(RangeError);
  });

  it("reflects plan revision changes in state metadata", () => {
    const s = initSimulation(roverPlan(), []);
    const next = stepSimulation(s, 1 / 60, { ...roverPlan(), revision: 2 }, []);
    expect(next.revision).toBe(2);
  });
});
