import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { decimateTrail } from "../PathTrail";
import {
  advanceWheelAngle,
  angularSpeed,
  computeArena,
  headingToYaw,
  isDisabledState,
  linearSpeed,
  resolveVisualConfig,
  sensorFanPositions,
  sensorHitSim,
  sensorOriginSim,
  sensorTone,
  simToWorld,
  snapshotToPose,
  wheelPositionsSim,
} from "../pose";
import type { SimSnapshot } from "../types";

const base: SimSnapshot = {
  x_m: 0,
  y_m: 0,
  theta_rad: 0,
  wheel_speed_left_mps: 0,
  wheel_speed_right_mps: 0,
  sensor_range_m: 1,
  sensor_distance_m: null,
  state: "FORWARD",
  trail: [],
  collision: false,
};

/** Applies the viewer's pose to a rover-local point and returns sim-plane coords. */
function localToSim(s: SimSnapshot, local: [number, number, number]): { x_m: number; y_m: number } {
  const pose = snapshotToPose(s);
  const obj = new THREE.Object3D();
  obj.position.set(...pose.position);
  obj.rotation.set(0, pose.yaw_rad, 0);
  obj.updateMatrixWorld(true);
  const w = new THREE.Vector3(...local).applyMatrix4(obj.matrixWorld);
  return { x_m: w.x, y_m: -w.z };
}

describe("snapshot to pose mapping", () => {
  it("maps meters directly onto the floor plane (sim y -> world -z)", () => {
    expect(simToWorld(1.25, -0.4)).toEqual([1.25, 0, 0.4]);
    const pose = snapshotToPose({ ...base, x_m: 2, y_m: 0.5, theta_rad: 0 });
    expect(pose.position).toEqual([2, 0, -0.5]);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 3, 2.4])("rover front (+z) points along heading theta=%s", (theta) => {
    const s = { ...base, x_m: 0.3, y_m: -0.2, theta_rad: theta };
    const front = localToSim(s, [0, 0, 1]);
    expect(front.x_m).toBeCloseTo(0.3 + Math.cos(theta), 9);
    expect(front.y_m).toBeCloseTo(-0.2 + Math.sin(theta), 9);
  });

  it("yaw is heading plus a quarter turn", () => {
    expect(headingToYaw(0)).toBeCloseTo(Math.PI / 2);
    expect(headingToYaw(1)).toBeCloseTo(1 + Math.PI / 2);
  });

  it("left wheel (+x local) sits on the left of the heading", () => {
    const s = { ...base, x_m: 1, y_m: 1, theta_rad: 0.7 };
    const wheels = wheelPositionsSim(s, 0.156);
    const left = localToSim(s, [0.078, 0, 0]);
    const right = localToSim(s, [-0.078, 0, 0]);
    expect(left.x_m).toBeCloseTo(wheels.left.x_m, 9);
    expect(left.y_m).toBeCloseTo(wheels.left.y_m, 9);
    expect(right.x_m).toBeCloseTo(wheels.right.x_m, 9);
    expect(right.y_m).toBeCloseTo(wheels.right.y_m, 9);
    // At theta=0 the left wheel is at +y.
    expect(wheelPositionsSim(base, 0.2).left.y_m).toBeCloseTo(0.1);
  });

  it("sensor ray ends at the reported return, or at full range when nothing is sensed", () => {
    const s = { ...base, x_m: 1, theta_rad: Math.PI / 2, sensor_distance_m: 0.3 };
    const origin = sensorOriginSim(s, 0.09);
    expect(origin.x_m).toBeCloseTo(1);
    expect(origin.y_m).toBeCloseTo(0.09);
    const hit = sensorHitSim(s, 0.09);
    expect(hit.y_m).toBeCloseTo(0.39);
    expect(sensorHitSim({ ...s, sensor_distance_m: null }, 0.09).y_m).toBeCloseTo(1.09);
    expect(sensorHitSim({ ...s, sensor_distance_m: 5 }, 0.09).y_m).toBeCloseTo(1.09);
  });

  it("sensor fan spans exactly the configured FOV and range", () => {
    const fan = sensorFanPositions(20, 1.2, 4);
    const half = (10 * Math.PI) / 180;
    expect(fan[3]).toBeCloseTo(Math.sin(-half) * 1.2);
    expect(fan[5]).toBeCloseTo(Math.cos(-half) * 1.2);
    const last = fan.length - 3;
    expect(fan[last]).toBeCloseTo(Math.sin(half) * 1.2);
    expect(fan[last + 2]).toBeCloseTo(Math.cos(half) * 1.2);
  });

  it("wheel spin follows v / r and rolls forward for positive speed", () => {
    expect(advanceWheelAngle(0, 0.1, 0.05, 0.5)).toBeCloseTo(1);
    expect(advanceWheelAngle(0, -0.1, 0.05, 0.5)).toBeCloseTo(-1);
    expect(advanceWheelAngle(0.5, 0.1, 0, 1)).toBe(0.5);
  });

  it("derives linear and angular speed from wheel speeds", () => {
    const s = { ...base, wheel_speed_left_mps: -0.1, wheel_speed_right_mps: 0.1 };
    expect(linearSpeed(s)).toBeCloseTo(0);
    expect(angularSpeed(s, 0.2)).toBeCloseTo(1);
  });

  it("classifies sensor tone against the stop threshold", () => {
    expect(sensorTone({ sensor_distance_m: null, sensor_range_m: 1 }, 0.25)).toBe("clear");
    expect(sensorTone({ sensor_distance_m: 0.5, sensor_range_m: 1 }, 0.25)).toBe("detected");
    expect(sensorTone({ sensor_distance_m: 0.2, sensor_range_m: 1 }, 0.25)).toBe("threshold");
    expect(sensorTone({ sensor_distance_m: 0.2, sensor_range_m: 1 }, null)).toBe("detected");
  });

  it("accepts DISABLE and DISABLED as disabled states", () => {
    expect(isDisabledState("DISABLE")).toBe(true);
    expect(isDisabledState("DISABLED")).toBe(true);
    expect(isDisabledState("STOP")).toBe(false);
  });

  it("auto arena contains all obstacles", () => {
    const a = computeArena(
      [
        { id: "a", kind: "circle", x_m: 2, y_m: 1, radius_m: 0.1 },
        { id: "b", kind: "box", x_m: -1, y_m: 0, width_m: 0.2, depth_m: 0.2 },
      ],
      null,
      0,
    );
    expect(a.max_x_m).toBeGreaterThanOrEqual(2.1);
    expect(a.min_x_m).toBeLessThanOrEqual(-1.1);
    expect(a.max_y_m).toBeGreaterThanOrEqual(1.1);
  });

  it("rejects non-positive config values", () => {
    const c = resolveVisualConfig({ wheel_base_m: 0, wheel_radius_m: -1 });
    expect(c.wheel_base_m).toBeGreaterThan(0);
    expect(c.wheel_radius_m).toBeGreaterThan(0);
    expect(resolveVisualConfig({ wheel_base_m: 0.2 }).wheel_base_m).toBe(0.2);
  });

  it("decimates long trails but keeps the newest point", () => {
    const trail = Array.from({ length: 5000 }, (_, i) => ({ x_m: i, y_m: 0 }));
    const out = decimateTrail(trail, 100);
    expect(out).toHaveLength(100);
    expect(out[0]).toEqual({ x_m: 0, y_m: 0 });
    expect(out[out.length - 1]).toEqual({ x_m: 4999, y_m: 0 });
  });
});
