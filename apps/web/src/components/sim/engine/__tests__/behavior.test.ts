import { describe, expect, it } from "vitest";
import { advanceSimulation, applySimEvent, getSnapshot, initSimulation, type SimState } from "../index";
import { expectedStopTick, roverPlan, WALL_X, wallAhead } from "./fixtures";

function runUntil(state: SimState, plan: ReturnType<typeof roverPlan>, pred: (s: SimState) => boolean, max = 20_000) {
  let s = state;
  for (let i = 0; i < max && !pred(s); i++) s = advanceSimulation(s, 1, plan, wallAhead);
  return s;
}

describe("FORWARD -> STOP -> TURN -> FORWARD controller", () => {
  const plan = roverPlan();
  const turnTicks = 36; // 600 ms at 60 Hz

  it("enters STOP exactly when the sensed range drops below obstacle_stop_distance_m", () => {
    const stopTick = expectedStopTick(plan, WALL_X);
    const s = runUntil(initSimulation(plan, wallAhead), plan, (x) => x.behavior.state !== "FORWARD");
    const t = s.transitions[0]!;
    expect(t).toMatchObject({ from: "FORWARD", to: "STOP", tick: stopTick, reason: "obstacle_within_stop_distance" });
    expect(t.time_s).toBeCloseTo(stopTick / 60, 12);
    expect(s.sensor.distance_m!).toBeLessThan(0.25);
    expect(s.wheel_speeds).toEqual({ left_mps: 0, right_mps: 0 });
    expect(s.collision.count).toBe(0);
  });

  it("holds STOP for one fixed step, turns for turn_duration_ms, then returns to FORWARD", () => {
    let s = advanceSimulation(initSimulation(plan, wallAhead), 2000, plan, wallAhead);
    const [stop, turn, forward] = s.transitions;
    expect(stop!.to).toBe("STOP");
    expect(turn).toMatchObject({ from: "STOP", to: "TURN", tick: stop!.tick + 1, reason: "stopped" });
    expect(forward).toMatchObject({ from: "TURN", to: "FORWARD", tick: turn!.tick + turnTicks, reason: "turn_complete" });

    // Heading change during TURN is omega * duration, omega = 2 * v / wheel_base (left turn).
    s = advanceSimulation(initSimulation(plan, wallAhead), forward!.tick + 1, plan, wallAhead);
    const v = 0.45 * 0.2;
    expect(s.pose.theta).toBeCloseTo(((2 * v) / 0.156) * turnTicks / 60, 9);
  });

  it("rotates in place during TURN with opposite wheel speeds", () => {
    const stopTick = expectedStopTick(plan, WALL_X);
    const before = advanceSimulation(initSimulation(plan, wallAhead), stopTick + 2, plan, wallAhead);
    expect(before.behavior.state).toBe("TURN");
    const after = advanceSimulation(before, 10, plan, wallAhead);
    expect(after.pose.x).toBe(before.pose.x);
    expect(after.pose.y).toBe(before.pose.y);
    expect(after.wheel_speeds.left_mps).toBeCloseTo(-0.09, 12);
    expect(after.wheel_speeds.right_mps).toBeCloseTo(0.09, 12);
    expect(after.angular_speed_radps).toBeCloseTo(0.18 / 0.156, 12);
  });

  it("supports right and seeded turn directions", () => {
    const right = advanceSimulation(initSimulation(plan, wallAhead, 0, { turnDirection: "right" }), 700, plan, wallAhead);
    expect(right.pose.theta).toBeLessThan(0);
    const seededA = advanceSimulation(initSimulation(plan, wallAhead, 7, { turnDirection: "seeded" }), 4000, plan, wallAhead);
    const seededB = advanceSimulation(initSimulation(plan, wallAhead, 7, { turnDirection: "seeded" }), 4000, plan, wallAhead);
    expect(seededA).toEqual(seededB);
  });

  it("changing obstacle_stop_distance_m changes where the rover stops", () => {
    const near = roverPlan({ behavior: { obstacle_stop_distance_m: 0.1 } });
    const far = roverPlan({ behavior: { obstacle_stop_distance_m: 0.5 } });
    const stopX = (p: ReturnType<typeof roverPlan>) =>
      runUntil(initSimulation(p, wallAhead), p, (s) => s.behavior.state === "STOP").pose.x;
    const xNear = stopX(near);
    const xFar = stopX(far);
    expect(WALL_X - 0.078 - xNear).toBeLessThan(0.1);
    expect(WALL_X - 0.078 - xNear).toBeGreaterThan(0.1 - 0.0016);
    expect(WALL_X - 0.078 - xFar).toBeLessThan(0.5);
    expect(xFar).toBeLessThan(xNear);
  });

  it("threshold edits take effect mid-run because params are re-read from the current plan", () => {
    const s0 = advanceSimulation(initSimulation(plan, wallAhead), 200, plan, wallAhead);
    expect(s0.behavior.state).toBe("FORWARD");
    const edited = roverPlan({ behavior: { obstacle_stop_distance_m: 0.9 } });
    const s1 = advanceSimulation(s0, 1, edited, wallAhead);
    expect(s1.behavior.state).toBe("STOP");
  });

  it("changing wheel_base_m changes turn rate and footprint", () => {
    const narrow = roverPlan({ simulation: { wheel_base_m: 0.1 } });
    const wide = roverPlan({ simulation: { wheel_base_m: 0.3 } });
    const heading = (p: ReturnType<typeof roverPlan>) => {
      const s = runUntil(initSimulation(p, wallAhead), p, (x) => x.transitions.some((t) => t.to === "FORWARD"));
      return s.pose.theta;
    };
    expect(heading(narrow)).toBeCloseTo((0.18 / 0.1) * 0.6, 9);
    expect(heading(wide)).toBeCloseTo((0.18 / 0.3) * 0.6, 9);
    const stopX = (p: ReturnType<typeof roverPlan>) =>
      runUntil(initSimulation(p, wallAhead), p, (s) => s.behavior.state === "STOP").pose.x;
    expect(stopX(narrow) - stopX(wide)).toBeCloseTo(0.1, 2);
  });

  it("changing turn_duration_ms changes TURN length", () => {
    const p = roverPlan({ behavior: { turn_duration_ms: 250 } });
    const s = advanceSimulation(initSimulation(p, wallAhead), 2000, p, wallAhead);
    const turn = s.transitions.find((t) => t.to === "TURN")!;
    const forward = s.transitions.find((t) => t.from === "TURN")!;
    expect(forward.tick - turn.tick).toBe(15);
  });
});

describe("DISABLE", () => {
  const plan = roverPlan();

  it("stops immediately and holds position until ENABLE", () => {
    const moving = advanceSimulation(initSimulation(plan, wallAhead), 100, plan, wallAhead);
    expect(moving.linear_speed_mps).toBeGreaterThan(0);
    const disabled = applySimEvent(moving, { type: "DISABLE" });
    expect(disabled.behavior.state).toBe("DISABLED");
    expect(disabled.wheel_speeds).toEqual({ left_mps: 0, right_mps: 0 });
    expect(getSnapshot(disabled).linear_speed_mps).toBe(0);
    expect(disabled.transitions.at(-1)).toMatchObject({ from: "FORWARD", to: "DISABLED", reason: "disable_event", tick: 100 });

    const later = advanceSimulation(disabled, 600, plan, wallAhead);
    expect(later.pose).toEqual(moving.pose);
    expect(later.behavior.state).toBe("DISABLED");
    expect(later.tick).toBe(700);

    const enabled = applySimEvent(later, { type: "ENABLE" });
    expect(enabled.behavior.state).toBe("FORWARD");
    expect(advanceSimulation(enabled, 1, plan, wallAhead).pose.x).toBeGreaterThan(moving.pose.x);
  });

  it("interrupts a TURN", () => {
    const stopTick = expectedStopTick(plan, WALL_X);
    const turning = advanceSimulation(initSimulation(plan, wallAhead), stopTick + 5, plan, wallAhead);
    expect(turning.behavior.state).toBe("TURN");
    const disabled = advanceSimulation(applySimEvent(turning, { type: "DISABLE" }), 120, plan, wallAhead);
    expect(disabled.pose).toEqual(turning.pose);
  });

  it("is idempotent and ENABLE is a no-op when not disabled", () => {
    const s = initSimulation(plan, []);
    const d = applySimEvent(s, { type: "DISABLE" });
    expect(applySimEvent(d, { type: "DISABLE" })).toBe(d);
    expect(applySimEvent(s, { type: "ENABLE" })).toBe(s);
  });
});
