import { describe, expect, it } from "vitest";
import { EXAMPLE_OBSTACLES, EXAMPLE_SNAPSHOTS, EXAMPLE_VISUAL_CONFIG } from "../examples";
import { sensorOriginSim } from "../pose";
import type { SimObstacle, SimSnapshot } from "../types";

/** Test-only center-ray check so the hand-authored examples stay geometrically honest. */
function rayDistance(s: SimSnapshot, obstacles: readonly SimObstacle[]): number | null {
  const o = sensorOriginSim(s, EXAMPLE_VISUAL_CONFIG.sensor_offset_m);
  const dx = Math.cos(s.theta_rad);
  const dy = Math.sin(s.theta_rad);
  let best = Infinity;
  for (const ob of obstacles) {
    if (ob.kind === "circle") {
      const fx = o.x_m - ob.x_m;
      const fy = o.y_m - ob.y_m;
      const b = fx * dx + fy * dy;
      const c = fx * fx + fy * fy - ob.radius_m * ob.radius_m;
      const disc = b * b - c;
      if (disc >= 0) {
        const t = -b - Math.sqrt(disc);
        if (t >= 0) best = Math.min(best, t);
      }
    } else {
      const r = -(ob.rotation_rad ?? 0);
      const px = (o.x_m - ob.x_m) * Math.cos(r) - (o.y_m - ob.y_m) * Math.sin(r);
      const py = (o.x_m - ob.x_m) * Math.sin(r) + (o.y_m - ob.y_m) * Math.cos(r);
      const qx = dx * Math.cos(r) - dy * Math.sin(r);
      const qy = dx * Math.sin(r) + dy * Math.cos(r);
      let tmin = -Infinity;
      let tmax = Infinity;
      for (const [p, q, h] of [
        [px, qx, ob.width_m / 2],
        [py, qy, ob.depth_m / 2],
      ] as const) {
        if (Math.abs(q) < 1e-12) {
          if (Math.abs(p) > h) tmin = Infinity;
        } else {
          const t1 = (-h - p) / q;
          const t2 = (h - p) / q;
          tmin = Math.max(tmin, Math.min(t1, t2));
          tmax = Math.min(tmax, Math.max(t1, t2));
        }
      }
      if (tmin <= tmax && tmin >= 0) best = Math.min(best, tmin);
    }
  }
  return best <= s.sensor_range_m ? best : null;
}

describe("example snapshots", () => {
  it("have unique ids and cover every FSM state plus a collision", () => {
    const ids = EXAMPLE_SNAPSHOTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const states = new Set(EXAMPLE_SNAPSHOTS.map((e) => e.snapshot.state));
    for (const s of ["FORWARD", "STOP", "TURN", "DISABLED"]) expect(states.has(s)).toBe(true);
    expect(EXAMPLE_SNAPSHOTS.some((e) => e.snapshot.collision)).toBe(true);
  });

  it.each(EXAMPLE_SNAPSHOTS.map((e) => [e.id, e.snapshot] as const))(
    "%s: sensor distance matches obstacle geometry",
    (_, s) => {
      const expected = rayDistance(s, EXAMPLE_OBSTACLES);
      if (expected === null) expect(s.sensor_distance_m).toBeNull();
      else expect(s.sensor_distance_m).toBeCloseTo(expected, 2);
    },
  );

  it.each(EXAMPLE_SNAPSHOTS.map((e) => [e.id, e.snapshot] as const))("%s: trail ends at the rover", (_, s) => {
    const last = s.trail[s.trail.length - 1];
    expect(last.x_m).toBeCloseTo(s.x_m, 3);
    expect(last.y_m).toBeCloseTo(s.y_m, 3);
  });

  it("stop example is inside the behavior threshold and forward examples are outside it", () => {
    const stop = EXAMPLE_SNAPSHOTS.find((e) => e.id === "stop-threshold")!.snapshot;
    expect(stop.sensor_distance_m!).toBeLessThan(EXAMPLE_VISUAL_CONFIG.stop_distance_m!);
    for (const e of EXAMPLE_SNAPSHOTS.filter((x) => x.snapshot.state === "FORWARD")) {
      const d = e.snapshot.sensor_distance_m;
      if (d !== null) expect(d).toBeGreaterThan(EXAMPLE_VISUAL_CONFIG.stop_distance_m!);
    }
  });
});
