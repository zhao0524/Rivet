import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SimView,
  advanceSimulation,
  applySimEvent,
  engineSnapshotToVisualSnapshot,
  extractSimPlan,
  extractVisualConfigFromPlan,
  getSnapshot,
  initSimulation,
  visualObstaclesToEngineObstacles,
} from '../src/components/sim';
import { getSyntheticRoverPlan } from '../src/lib/fixtures';

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>();
  return {
    ...actual,
    Canvas: (props: { frameloop?: string }) => (
      <div data-testid="r3f-canvas" data-frameloop={props.frameloop} />
    ),
  };
});

afterEach(() => {
  cleanup();
});

describe('Simulation Engine + Visual Integration (C4 / C7)', () => {
  it('bridges BuildPlan, engine obstacles (including rotated boxes), and visual snapshots accurately', () => {
    const plan = getSyntheticRoverPlan();
    const extracted = extractSimPlan(plan);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const obstacles = visualObstaclesToEngineObstacles(
      [
        { id: 'wall-1', kind: 'box', x_m: 0.85, y_m: 0, width_m: 0.1, depth_m: 1.0 },
        { id: 'rot-box', kind: 'box', x_m: 1.5, y_m: 0.5, width_m: 0.2, depth_m: 0.2, rotation_rad: 0.4 },
        { id: 'pillar', kind: 'circle', x_m: 0.5, y_m: -0.6, radius_m: 0.1 },
      ],
      { min_x_m: -0.5, max_x_m: 2.0, min_y_m: -1.0, max_y_m: 1.0 },
    );

    expect(obstacles.find((o) => o.id === 'wall-1')?.kind).toBe('box');
    expect(obstacles.find((o) => o.id === 'rot-box')?.kind).toBe('polygon');
    expect(obstacles.find((o) => o.id === 'pillar')?.kind).toBe('circle');
    expect(obstacles.filter((o) => o.kind === 'wall')).toHaveLength(4);

    let state = initSimulation(extracted.simPlan, obstacles, 42);
    state = advanceSimulation(state, 420, extracted.simPlan, obstacles);
    const engineSnap = getSnapshot(state, extracted.simPlan);

    // Must have detected the wall at x=0.85, entered STOP and TURN, and never passed through the wall
    expect(engineSnap.transitions.some((t) => t.to === 'STOP')).toBe(true);
    expect(engineSnap.transitions.some((t) => t.to === 'TURN')).toBe(true);
    expect(engineSnap.collision.active).toBe(false);

    const visualSnap = engineSnapshotToVisualSnapshot(engineSnap);
    expect(visualSnap.x_m).toBeCloseTo(engineSnap.pose.x, 8);
    expect(visualSnap.y_m).toBeCloseTo(engineSnap.pose.y, 8);
    expect(visualSnap.theta_rad).toBeCloseTo(engineSnap.pose.theta, 8);
    expect(visualSnap.state).toBe(engineSnap.state);
    expect(visualSnap.sensor_range_m).toBe(1.0);

    const visualConfig = extractVisualConfigFromPlan(plan);
    expect(visualConfig.wheel_base_m).toBe(0.156);
    expect(visualConfig.wheel_radius_m).toBe(0.0325);
    expect(visualConfig.stop_distance_m).toBe(0.25);

    const disabledState = applySimEvent(state, { type: 'DISABLE' });
    const disabledVisual = engineSnapshotToVisualSnapshot(getSnapshot(disabledState, extracted.simPlan));
    expect(disabledVisual.state).toBe('DISABLED');
    expect(disabledVisual.wheel_speed_left_mps).toBe(0);
    expect(disabledVisual.wheel_speed_right_mps).toBe(0);
  });

  it('renders SimView, steps forward deterministically, and responds to Disable/Enable and plan edits', () => {
    const plan = getSyntheticRoverPlan();
    const { rerender } = render(<SimView plan={plan} initialScenarioId="wall-ahead" />);

    expect(screen.getByTestId('sim-disclaimer').textContent).toContain(
      'Simplified kinematic simulation',
    );
    expect(screen.getByTestId('sim-readout-state').textContent).toBe('FORWARD');
    expect(screen.getByTestId('sim-plan-params').textContent).toContain('stop: 0.25 m');

    // Step forward deterministically
    const stepBtn = screen.getByTestId('sim-control-step');
    fireEvent.click(stepBtn);
    expect(screen.getByTestId('sim-plan-params').textContent).toContain('t = 0.10 s');

    // Disable motors -> state becomes DISABLED immediately
    fireEvent.click(screen.getByTestId('sim-control-disable'));
    expect(screen.getByTestId('sim-readout-state').textContent).toBe('DISABLED');

    // Re-enable motors -> state returns to FORWARD
    fireEvent.click(screen.getByTestId('sim-control-enable'));
    expect(screen.getByTestId('sim-readout-state').textContent).toBe('FORWARD');

    // Update plan with edited stop distance and wheelbase -> reflected immediately in SimView
    const editedPlan = structuredClone(plan);
    editedPlan.revision = 2;
    editedPlan.behavior!.parameters.obstacle_stop_distance_m = 0.42;
    editedPlan.simulation.wheel_base_m = 0.18;
    rerender(<SimView plan={editedPlan} initialScenarioId="wall-ahead" />);

    expect(screen.getByTestId('sim-plan-params').textContent).toContain('stop: 0.42 m');
    expect(screen.getByTestId('sim-plan-params').textContent).toContain('wheelbase: 0.18 m');
  });
});
