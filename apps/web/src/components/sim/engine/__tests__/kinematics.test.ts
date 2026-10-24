import { describe, expect, it } from "vitest";
import { advanceSimulation, bodyVelocity, FIXED_DT_S, getSnapshot, initSimulation, integratePose } from "../index";
import { roverPlan } from "./fixtures";

describe("differential-drive kinematics", () => {
  it("computes v = (vR + vL) / 2 and omega = (vR - vL) / wheelBase", () => {
    const a = bodyVelocity({ left_mps: 0.1, right_mps: 0.3 }, 0.2);
    expect(a.v_mps).toBeCloseTo(0.2, 12);
    expect(a.omega_radps).toBeCloseTo(1, 12);
    expect(bodyVelocity({ left_mps: -0.1, right_mps: 0.1 }, 0.1)).toEqual({ v_mps: 0, omega_radps: 2 });
  });

  it("integrates x/y/theta with explicit Euler", () => {
    const p = integratePose({ x: 1, y: 2, theta: Math.PI / 2 }, { v_mps: 0.5, omega_radps: 0.25 }, 0.1);
    expect(p.x).toBeCloseTo(1, 12);
    expect(p.y).toBeCloseTo(2.05, 12);
    expect(p.theta).toBeCloseTo(Math.PI / 2 + 0.025, 12);
  });

  it("normalizes heading into (-PI, PI]", () => {
    const p = integratePose({ x: 0, y: 0, theta: Math.PI - 0.01 }, { v_mps: 0, omega_radps: 1 }, 0.1);
    expect(p.theta).toBeCloseTo(-Math.PI + 0.09, 12);
  });

  it("drives straight at forward_speed_fraction * max_wheel_speed_mps with open space", () => {
    const plan = roverPlan();
    const ticks = 120;
    const s = advanceSimulation(initSimulation(plan, []), ticks, plan, []);
    const v = 0.45 * 0.2;
    expect(s.pose.x).toBeCloseTo(v * ticks * FIXED_DT_S, 12);
    expect(s.pose.y).toBe(0);
    expect(s.pose.theta).toBe(0);
    expect(s.behavior.state).toBe("FORWARD");
    const snap = getSnapshot(s, plan);
    expect(snap.linear_speed_mps).toBeCloseTo(v, 12);
    expect(snap.wheel_speeds).toEqual({ left_mps: v, right_mps: v });
    expect(snap.wheel_angular_speeds_radps.left).toBeCloseTo(v / 0.0325, 12);
    expect(snap.time_s).toBeCloseTo(2, 12);
  });

  it("drives straight along the initial heading", () => {
    const plan = roverPlan();
    const s = advanceSimulation(initSimulation(plan, [], 0, { initialPose: { x: 0, y: 0, theta: Math.PI / 2 } }), 60, plan, []);
    expect(s.pose.x).toBeCloseTo(0, 12);
    expect(s.pose.y).toBeCloseTo(0.09, 12);
  });

  it("speed scales with the plan's max_wheel_speed_mps and forward_speed_fraction", () => {
    const fast = roverPlan({ simulation: { max_wheel_speed_mps: 0.4 }, behavior: { forward_speed_fraction: 0.9 } });
    const s = advanceSimulation(initSimulation(fast, []), 60, fast, []);
    expect(s.pose.x).toBeCloseTo(0.36, 12);
  });
});
