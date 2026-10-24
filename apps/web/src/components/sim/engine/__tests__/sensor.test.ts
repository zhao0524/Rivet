import { describe, expect, it } from "vitest";
import { raycastFrontSensor, sensorRayAngles, type Obstacle } from "../index";
import { roverPlan } from "./fixtures";

const plan = roverPlan(); // range 1.0 m, fov 20 deg, footprint radius 0.078 m
const R = 0.078;
const origin = { x: 0, y: 0, theta: 0 };

describe("raycastFrontSensor", () => {
  it("measures distance from the front-mounted sensor to a wall", () => {
    const wall: Obstacle = { kind: "wall", id: "w", start: { x: 0.5, y: -1 }, end: { x: 0.5, y: 1 } };
    const r = raycastFrontSensor(origin, plan, [wall]);
    expect(r.distance_m).toBeCloseTo(0.5 - R, 12);
    expect(r.obstacle_id).toBe("w");
    expect(r.origin).toEqual({ x: R, y: 0 });
  });

  it("hits circles, boxes and polygons and reports the nearest", () => {
    const obstacles: Obstacle[] = [
      { kind: "circle", id: "c", center: { x: 0.7, y: 0 }, radius_m: 0.1 },
      { kind: "box", id: "b", min: { x: 0.4, y: -0.05 }, max: { x: 0.5, y: 0.05 } },
      { kind: "polygon", id: "p", points: [{ x: 0.3, y: -0.2 }, { x: 0.35, y: 0.2 }, { x: 0.25, y: 0.2 }] },
    ];
    expect(raycastFrontSensor(origin, plan, [obstacles[0]!]).distance_m).toBeCloseTo(0.6 - R, 12);
    expect(raycastFrontSensor(origin, plan, [obstacles[1]!]).distance_m).toBeCloseTo(0.4 - R, 12);
    const poly = raycastFrontSensor(origin, plan, [obstacles[2]!]);
    expect(poly.distance_m).not.toBeNull();
    expect(poly.distance_m!).toBeLessThan(0.3 - R);
    expect(raycastFrontSensor(origin, plan, obstacles).obstacle_id).toBe("p");
  });

  it("returns null beyond sensor_range_m and honours a changed range", () => {
    const wall: Obstacle = { kind: "wall", id: "w", start: { x: 1.2, y: -1 }, end: { x: 1.2, y: 1 } };
    expect(raycastFrontSensor(origin, plan, [wall]).distance_m).toBeNull();
    const longRange = roverPlan({ simulation: { sensor_range_m: 2 } });
    expect(raycastFrontSensor(origin, longRange, [wall]).distance_m).toBeCloseTo(1.2 - R, 12);
  });

  it("ignores obstacles behind the rover", () => {
    const wall: Obstacle = { kind: "wall", id: "w", start: { x: -0.3, y: -1 }, end: { x: -0.3, y: 1 } };
    expect(raycastFrontSensor(origin, plan, [wall]).distance_m).toBeNull();
  });

  it("detects within the approximate FOV but not outside it", () => {
    const at = (deg: number): Obstacle => {
      const a = (deg * Math.PI) / 180;
      return { kind: "circle", id: `c${deg}`, center: { x: R + 0.5 * Math.cos(a), y: 0.5 * Math.sin(a) }, radius_m: 0.01 };
    };
    expect(raycastFrontSensor(origin, plan, [at(9)]).distance_m).not.toBeNull();
    expect(raycastFrontSensor(origin, plan, [at(-9)]).distance_m).not.toBeNull();
    expect(raycastFrontSensor(origin, plan, [at(20)]).distance_m).toBeNull();
    const wide = roverPlan({ simulation: { sensor_fov_deg: 60 } });
    expect(raycastFrontSensor(origin, wide, [at(20)]).distance_m).not.toBeNull();
  });

  it("follows the rover heading", () => {
    const wall: Obstacle = { kind: "wall", id: "w", start: { x: -1, y: 0.6 }, end: { x: 1, y: 0.6 } };
    const r = raycastFrontSensor({ x: 0, y: 0, theta: Math.PI / 2 }, plan, [wall]);
    expect(r.distance_m).toBeCloseTo(0.6 - R, 12);
  });

  it("returns 0 when the sensor origin is inside a solid obstacle", () => {
    const box: Obstacle = { kind: "box", id: "b", min: { x: 0, y: -0.1 }, max: { x: 0.2, y: 0.1 } };
    expect(raycastFrontSensor(origin, plan, [box]).distance_m).toBe(0);
  });

  it("detects a small pole that falls between rays via the cone test", () => {
    const wide = roverPlan({ simulation: { sensor_fov_deg: 60 } });
    const a = (19 * Math.PI) / 180;
    const pole: Obstacle = { kind: "circle", id: "pole", center: { x: R + 0.5 * Math.cos(a), y: 0.5 * Math.sin(a) }, radius_m: 0.005 };
    const r = raycastFrontSensor(origin, wide, [pole], 3);
    expect(r.rays.every((ray) => ray.distance_m === null)).toBe(true);
    expect(r.distance_m).toBeCloseTo(0.495, 9);
  });

  it("detects a box corner inside the cone even when rays miss it", () => {
    const box: Obstacle = { kind: "box", id: "b", min: { x: 0.5, y: 0.03 }, max: { x: 0.7, y: 0.3 } };
    const r = raycastFrontSensor(origin, plan, [box], 1);
    expect(r.rays[0]!.distance_m).toBeNull();
    expect(r.distance_m).toBeCloseTo(Math.hypot(0.5 - R, 0.03), 9);
  });

  it("spreads rays evenly across the FOV", () => {
    const angles = sensorRayAngles(Math.PI / 6, 3);
    expect(angles[0]).toBeCloseTo(-Math.PI / 12, 12);
    expect(angles[1]).toBeCloseTo(0, 12);
    expect(angles[2]).toBeCloseTo(Math.PI / 12, 12);
    expect(sensorRayAngles(0, 9)).toEqual([0]);
    expect(raycastFrontSensor(origin, plan, [], 5).rays).toHaveLength(5);
  });
});
