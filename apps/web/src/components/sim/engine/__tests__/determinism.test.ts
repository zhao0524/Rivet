import { describe, expect, it } from "vitest";
import { advanceSimulation, arenaWalls, getSnapshot, initSimulation, MAX_FRAME_DT_S, stepSimulation } from "../index";
import { roverPlan, wallAhead } from "./fixtures";

describe("determinism and fixed timestep", () => {
  const plan = roverPlan();
  const obstacles = [...wallAhead, ...arenaWalls(-2, -2, 2, 2)];

  it("produces identical snapshots for identical inputs and seeds", () => {
    const run = () => {
      let s = initSimulation(plan, obstacles, 42, { turnDirection: "seeded" });
      const snaps = [];
      for (let i = 0; i < 1500; i++) {
        s = stepSimulation(s, 1 / 60, plan, obstacles);
        if (i % 100 === 0) snaps.push(getSnapshot(s, plan));
      }
      return snaps;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("is independent of how frame time is chunked", () => {
    let a = initSimulation(plan, obstacles);
    let b = initSimulation(plan, obstacles);
    for (let i = 0; i < 1200; i++) a = stepSimulation(a, 1 / 60, plan, obstacles);
    for (let i = 0; i < 600; i++) b = stepSimulation(b, 1 / 30, plan, obstacles);
    expect(b.tick).toBe(a.tick);
    expect(b.pose).toEqual(a.pose);
    expect(b.transitions).toEqual(a.transitions);
    const c = advanceSimulation(initSimulation(plan, obstacles), 1200, plan, obstacles);
    expect(c.pose).toEqual(a.pose);
  });

  it("accumulates sub-step frame deltas and clamps large or invalid ones", () => {
    let s = initSimulation(plan, obstacles);
    s = stepSimulation(s, 0.01, plan, obstacles);
    expect(s.tick).toBe(0);
    s = stepSimulation(s, 0.01, plan, obstacles);
    expect(s.tick).toBe(1);
    const big = stepSimulation(initSimulation(plan, obstacles), 5, plan, obstacles);
    expect(big.tick).toBe(Math.floor(MAX_FRAME_DT_S * 60 + 1e-9));
    expect(stepSimulation(initSimulation(plan, obstacles), -1, plan, obstacles).tick).toBe(0);
    expect(stepSimulation(initSimulation(plan, obstacles), Number.NaN, plan, obstacles).tick).toBe(0);
  });

  it("does not mutate the input state or plan", () => {
    const frozenPlan = JSON.parse(JSON.stringify(plan));
    const s0 = initSimulation(plan, obstacles);
    const copy = JSON.parse(JSON.stringify(s0));
    advanceSimulation(s0, 900, plan, obstacles);
    expect(JSON.parse(JSON.stringify(s0))).toEqual(copy);
    expect(plan).toEqual(frozenPlan);
  });

  it("produces a JSON-serializable snapshot with label, limitations and plan identity", () => {
    const snap = getSnapshot(advanceSimulation(initSimulation(plan, obstacles), 900, plan, obstacles), plan);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(snap.label).toBe("Simplified kinematic simulation");
    expect(snap.disclaimer).toMatch(/not a hardware safety certification/);
    expect(snap.limitations).toEqual(expect.arrayContaining(["Simplified kinematics only"]));
    expect(snap.build_id).toBe("rover_obstacle_v1");
    expect(snap.revision).toBe(1);
    expect(snap.trail.length).toBeGreaterThan(1);
    expect(snap.time_s).toBeCloseTo(15, 9);
  });

  it("bounds trail and transition history", () => {
    const s = advanceSimulation(
      initSimulation(plan, obstacles, 1, { trailMaxPoints: 10, maxTransitions: 4, trailSampleEveryTicks: 1 }),
      3000,
      plan,
      obstacles,
    );
    expect(s.trail).toHaveLength(10);
    expect(s.transitions.length).toBeLessThanOrEqual(4);
  });
});
