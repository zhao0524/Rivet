import { describe, expect, it } from "vitest";
import { framingCameraPosition, followCameraPosition } from "../SimScene";
import { EXAMPLE_ARENA } from "../examples";

describe("camera placement", () => {
  it("follow camera sits behind and above the rover for any heading", () => {
    const east = followCameraPosition({ x_m: 1, y_m: 0.5, theta_rad: 0 });
    expect(east[0]).toBeLessThan(1);
    expect(east[1]).toBeGreaterThan(0.2);

    const north = followCameraPosition({ x_m: 1, y_m: 0.5, theta_rad: Math.PI / 2 });
    // Sim +y is world -z, so "behind" a north-facing rover is larger world z.
    expect(north[2]).toBeGreaterThan(-0.5);
  });

  it("overview camera frames the course from above the floor", () => {
    const [, y, z] = framingCameraPosition(EXAMPLE_ARENA, 16 / 9);
    expect(y).toBeGreaterThan(1);
    expect(z).toBeGreaterThan(-EXAMPLE_ARENA.min_y_m);
  });
});
