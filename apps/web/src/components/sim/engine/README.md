# Rover simulation engine (C4 / C07)

**Simplified kinematic simulation.** A deterministic 2D differential-drive kinematic approximation
driven by the current `BuildPlan.behavior` and `BuildPlan.simulation`. It is **not** a physics model
and **not** a hardware safety certification. No React, Canvas or UI code lives here.

## API

```ts
import { initSimulation, stepSimulation, applySimEvent, getSnapshot, raycastFrontSensor } from "./engine";

let state = initSimulation(plan, obstacles, seed /* optional */, options /* optional */);
state = stepSimulation(state, frameDtSeconds, plan, obstacles); // pure; returns a new state
state = applySimEvent(state, { type: "DISABLE" });              // stops immediately
const snap = getSnapshot(state, plan);                          // JSON-serializable view
```

`plan` is any object with `behavior` and `simulation` in the `BuildPlan` shape (`SimPlan`).
Parameters are re-read from `plan` on every step, so plan edits (wheel base, threshold, speed) take effect at once.
An unusable plan (`kind: "none"`, `enabled: false`, non-positive dimensions, fraction > 1, ...) throws `SimConfigError`.

## Model

- Units: meters, seconds, radians; heading `theta` is counter-clockwise from +x on the 2D plane.
- `v = (vR + vL) / 2`, `omega = (vR - vL) / wheel_base_m`, explicit Euler integration of `x`, `y`, `theta`.
- Fixed 1/60 s timestep with an accumulator; each frame delta is clamped to `[0, 0.05]` s.
- Forward wheel speed = `forward_speed_fraction * max_wheel_speed_mps`; TURN spins in place at the same wheel speed.
- Footprint: circle of radius `wheel_base_m / 2`. The front sensor sits on its front edge.
- Sensor: rays across `sensor_fov_deg`, limited to `sensor_range_m`, plus a cone test for circles and polygon/wall vertices.
- Obstacles: `circle`, `wall` (segment), `box` (axis-aligned), `polygon`. `arenaWalls()` builds a bounded arena.
- Collision guard: translation is swept in sub-steps of at most a quarter of the footprint radius and bisected to contact,
  so thin walls cannot be tunneled. Contact stops the rover and is reported in `collision`.

## Behavior (`rover.obstacle_avoidance.v1`)

`FORWARD` → (range `< obstacle_stop_distance_m`) → `STOP` (one fixed step) → `TURN` (`turn_duration_ms`) → `FORWARD`.
`DISABLE` zeroes wheel speeds immediately and holds until `ENABLE`. Turn direction is `left` by default;
`right` or `seeded` (per-turn choice from the seeded PRNG) are options.

## Tests

Standalone until `apps/web` is bootstrapped (C0):

```bash
cd apps/web/src/components/sim/engine
npm install --no-package-lock
npx vitest run
npx tsc --noEmit -p tsconfig.json
```
