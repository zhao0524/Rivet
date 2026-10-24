import { describe, expect, it } from 'vitest';
import sharedCatalog from '../../../fixtures/catalog/seed-components.json';
import sharedIntent from '../../../fixtures/intent/rover_obstacle_v1.json';
import sharedPlan from '../../../fixtures/plans/rover_obstacle_v1.json';
import scenario from '../../../fixtures/sim/obstacle-scenario.json';
import runtimeIntent from '../src/lib/rivet/fixtures/synthetic-intent-rover-obstacle-v1.json';
import runtimePlan from '../src/lib/rivet/fixtures/synthetic-rover-obstacle-v1.json';
import runtimeCatalog from '../src/lib/rivet/fixtures/synthetic-seed-components.json';
import { advanceSimulation, extractSimPlan, initSimulation } from '../src/components/sim';
import type { Obstacle } from '../src/components/sim/engine/types';
import type { BuildPlan } from '../src/lib/rivet/types';

describe('shared fixtures/ (INT-2)', () => {
  it('runtime synthetic copies bundled with the app match the shared fixtures exactly', () => {
    expect(runtimePlan).toEqual(sharedPlan);
    expect(runtimeCatalog).toEqual(sharedCatalog);
    expect(runtimeIntent).toEqual(sharedIntent);
  });

  it('the simulation engine reproduces the obstacle scenario transitions exactly', () => {
    expect(scenario.plan_fixture).toBe('plans/rover_obstacle_v1.json');
    const extracted = extractSimPlan(sharedPlan as unknown as BuildPlan);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const obstacles = scenario.obstacles as Obstacle[];
    const run = () => {
      const start = initSimulation(extracted.simPlan, obstacles, scenario.seed, {
        initialPose: scenario.start_pose,
        turnDirection: scenario.turn_direction as 'left',
        sensorRayCount: scenario.sensor_ray_count,
      });
      return advanceSimulation(start, scenario.run_ticks, extracted.simPlan, obstacles);
    };
    const end = run();

    expect(end.transitions.map(({ from, to, tick, reason }) => ({ from, to, tick, reason }))).toEqual(
      scenario.expected.transitions.map(({ from, to, tick, reason }) => ({ from, to, tick, reason })),
    );
    end.transitions.forEach((t, i) => {
      expect(t.time_s).toBeCloseTo(scenario.expected.transitions[i].time_s, 9);
      expect(t.time_s).toBeCloseTo(t.tick * scenario.fixed_dt_s, 9);
    });
    expect(end.behavior.state).toBe(scenario.expected.final_state);
    expect(end.collision.count).toBe(scenario.expected.collision_count);
    expect(run()).toEqual(end);
  });
});
