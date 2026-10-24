import { describe, expect, it } from "vitest";
import { advanceSimulation, arenaWalls, initSimulation, stepSimulation, type Obstacle } from "../index";
import { roverPlan, WALL_X, wallAhead } from "./fixtures";

const R = 0.078;

describe("collision and tunneling guard", () => {
  it("never passes through the wall in a bounded obstacle scenario over a long run", () => {
    const plan = roverPlan();
    const bounded: Obstacle[] = [
      { kind: "wall", id: "wall-ahead", start: { x: WALL_X, y: -2 }, end: { x: WALL_X, y: 2 } },
      ...arenaWalls(-2, -2, 2, 2),
    ];
    let s = initSimulation(plan, bounded);
    for (let i = 0; i < 60 * 120; i++) {
      s = advanceSimulation(s, 1, plan, bounded);
      expect(s.pose.x + R).toBeLessThanOrEqual(WALL_X + 1e-9);
    }
  });

  it("stops at contact and reports a collision when the sensor cannot see the obstacle", () => {
    // Threshold 0 means the controller never stops; the engine must stop the rover at the wall.
    const plan = roverPlan({ behavior: { obstacle_stop_distance_m: 0 } });
    const s = advanceSimulation(initSimulation(plan, wallAhead), 60 * 30, plan, wallAhead);
    expect(s.pose.x).toBeCloseTo(WALL_X - R, 6);
    expect(s.pose.x).toBeLessThanOrEqual(WALL_X - R + 1e-6);
    expect(s.collision.active).toBe(true);
    expect(s.collision.obstacle_id).toBe("wall-ahead");
    expect(s.collision.count).toBeGreaterThan(0);
    expect(s.collision.first_at_s).not.toBeNull();
    expect(s.linear_speed_mps).toBe(0);
  });

  it("does not tunnel a thin wall even at a high plan speed and clamped large frame deltas", () => {
    const plan = roverPlan({
      behavior: { obstacle_stop_distance_m: 0, forward_speed_fraction: 1 },
      simulation: { max_wheel_speed_mps: 50, wheel_base_m: 0.02 },
    });
    const thin: Obstacle[] = [{ kind: "wall", id: "thin", start: { x: 0.5, y: -1 }, end: { x: 0.5, y: 1 } }];
    let s = initSimulation(plan, thin);
    for (let i = 0; i < 100; i++) s = stepSimulation(s, 10, plan, thin);
    expect(s.pose.x).toBeLessThanOrEqual(0.5 - 0.01 + 1e-9);
    expect(s.pose.x).toBeCloseTo(0.49, 6);
    expect(s.collision.obstacle_id).toBe("thin");
  });

  it("stops against a small pole outside the sensor beam", () => {
    const plan = roverPlan({ simulation: { sensor_fov_deg: 0 }, behavior: { obstacle_stop_distance_m: 0.25 } });
    const pole: Obstacle[] = [{ kind: "circle", id: "pole", center: { x: 0.6, y: 0.06 }, radius_m: 0.01 }];
    const s = advanceSimulation(initSimulation(plan, pole), 60 * 20, plan, pole);
    expect(s.collision.obstacle_id).toBe("pole");
    expect(Math.hypot(s.pose.x - 0.6, s.pose.y - 0.06)).toBeGreaterThanOrEqual(R + 0.01 - 1e-6);
  });

  it("collides with boxes and polygons without penetration", () => {
    const plan = roverPlan({ behavior: { obstacle_stop_distance_m: 0 } });
    const box: Obstacle[] = [{ kind: "box", id: "box", min: { x: 0.4, y: -0.2 }, max: { x: 0.6, y: 0.2 } }];
    const sb = advanceSimulation(initSimulation(plan, box), 60 * 10, plan, box);
    expect(sb.pose.x).toBeCloseTo(0.4 - R, 6);
    const tri: Obstacle[] = [{ kind: "polygon", id: "tri", points: [{ x: 0.5, y: 0 }, { x: 0.8, y: -0.3 }, { x: 0.8, y: 0.3 }] }];
    const st = advanceSimulation(initSimulation(plan, tri), 60 * 10, plan, tri);
    expect(st.pose.x).toBeCloseTo(0.5 - R, 6);
    expect(st.collision.obstacle_id).toBe("tri");
  });

  it("keeps the rover inside a bounded arena", () => {
    const plan = roverPlan();
    const arena = arenaWalls(-1, -1, 1, 1);
    let s = initSimulation(plan, arena, 3, { turnDirection: "seeded" });
    for (let i = 0; i < 60 * 60; i++) {
      s = advanceSimulation(s, 1, plan, arena);
      expect(Math.abs(s.pose.x)).toBeLessThanOrEqual(1 - R + 1e-9);
      expect(Math.abs(s.pose.y)).toBeLessThanOrEqual(1 - R + 1e-9);
    }
  });

  it("reports an initial overlap at t=0 and does not move into the obstacle", () => {
    const plan = roverPlan({ behavior: { obstacle_stop_distance_m: 0 } });
    const box: Obstacle[] = [{ kind: "box", id: "b", min: { x: 0.05, y: -0.1 }, max: { x: 0.2, y: 0.1 } }];
    const s0 = initSimulation(plan, box);
    expect(s0.collision).toMatchObject({ active: true, obstacle_id: "b", first_at_s: 0 });
    expect(advanceSimulation(s0, 30, plan, box).pose.x).toBe(0);
  });
});
