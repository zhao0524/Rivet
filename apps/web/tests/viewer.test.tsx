import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Studio } from '../src/components/studio';
import { FixtureSource, SYNTHETIC_ROVER_BUILD_ID } from '../src/lib/contracts';
import { getSyntheticCatalog, getSyntheticRoverPlan } from '../src/lib/fixtures';

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

describe('3D Studio, Inspector, Timeline, Wiring & Edit Integration (C1–C7)', () => {
  it('renders the fixture rover in Studio with honest provenance, component tree, selection -> inspector & BOM sync', () => {
    render(<Studio initialDataSource={new FixtureSource()} />);

    // Provenance banner shows "Saved synthetic example"
    const banner = screen.getByTestId('provenance-trust-banner');
    expect(banner.getAttribute('data-trust-label')).toBe('Saved synthetic example');
    expect(banner.getAttribute('data-synthetic')).toBe('true');

    // Every component in the plan appears in the component tree
    const plan = getSyntheticRoverPlan();
    for (const comp of plan.components) {
      expect(screen.getByTestId(`tree-item-${comp.instance_id}`)).toBeDefined();
    }

    // Select driver-1 in the tree -> PartInspector displays driver-1 catalog data & honest null purchase link
    fireEvent.click(screen.getByTestId('tree-select-driver-1'));
    expect(screen.getByTestId('inspector-instance-id').textContent).toBe('driver-1');
    expect(screen.getByTestId('inspector-catalog-id').textContent).toBe('demo.tb6612');
    expect(screen.getByTestId('inspector-manufacturer').textContent).toBe('SYNTHETIC DEMO ONLY');
    expect(screen.getByTestId('inspector-price').textContent).toBe('Unknown');
    expect(screen.getByTestId('inspector-link-purchase').tagName).toBe('SPAN');
    expect(screen.getByTestId('inspector-link-purchase').textContent).toBe('Not available');

    // Switch to BOM tab -> row for demo.tb6612 is marked selected
    fireEvent.click(screen.getByTestId('inspector-tab-bom'));
    const driverRow = screen.getByTestId('bom-row-demo.tb6612');
    expect(driverRow.getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('bom-total-unavailable')).toBeDefined();
  });

  it('synchronizes exploded view, assembly step timeline, wiring mode, and simulation mode', () => {
    render(<Studio initialDataSource={new FixtureSource()} />);

    const scene = screen.getByTestId('rover-scene');
    expect(scene.getAttribute('data-assembly-mode')).toBe('assembled');

    // Toggle explode mode from toolbar
    fireEvent.click(screen.getByTestId('toolbar-toggle-explode'));
    expect(scene.getAttribute('data-assembly-mode')).toBe('exploded');

    // Scrub to Step 4 ("Place controller and driver") via timeline pill
    fireEvent.click(screen.getByTestId('timeline-step-pill-4'));
    expect(scene.getAttribute('data-assembly-mode')).toBe('step');
    const stepDetails = screen.getByTestId('timeline-active-step-details');
    expect(stepDetails.textContent).toContain('Place controller and driver');

    // Clicking a step part badge selects that part in the inspector
    fireEvent.click(screen.getByTestId('timeline-step-instance-controller-1'));
    expect(screen.getByTestId('inspector-instance-id').textContent).toBe('controller-1');

    // Switch to Wiring mode -> opens wiring tab with netlist and approximate disclosure
    fireEvent.click(screen.getByTestId('studio-mode-wiring'));
    expect(screen.getByTestId('inspector-wiring-tab')).toBeDefined();
    expect(screen.getByTestId('wiring-counts').textContent).toContain(
      '2 of 2 electrical connections drawn',
    );
    expect(screen.getByTestId('wiring-approximate')).toBeDefined();

    // Switch to Simulate mode -> mounts SimView with simplified kinematic simulation disclaimer
    fireEvent.click(screen.getByTestId('studio-mode-simulate'));
    expect(screen.getByTestId('sim-view-container')).toBeDefined();
    expect(screen.getByTestId('sim-disclaimer').textContent).toContain(
      'Simplified kinematic simulation',
    );
  });

  it('preserves immutable revision on rejected fixture edit and loads new revision when multi-revision source accepts', async () => {
    const rev1 = getSyntheticRoverPlan();
    const rev2 = structuredClone(rev1);
    rev2.revision = 2;
    rev2.behavior!.parameters.obstacle_stop_distance_m = 0.4;

    const multiFixture = new FixtureSource({
      catalog: getSyntheticCatalog(),
      plans: [rev1, rev2],
      defaultBuildId: SYNTHETIC_ROVER_BUILD_ID,
    });

    render(<Studio initialDataSource={multiFixture} />);

    // Starts at latest revision (2)
    await waitFor(() => {
      expect(screen.getByTestId('studio-build-identity').textContent).toContain('rev 2');
    });

    // Switch back to revision 1 using ProjectRevisionPicker
    await act(async () => {
      fireEvent.change(screen.getByTestId('revision-select'), { target: { value: '1' } });
    });
    expect(screen.getByTestId('studio-build-identity').textContent).toContain('rev 1');

    // Switch back to revision 2 and propose an edit in fixture mode -> rejected honestly without mutating revision 2
    await act(async () => {
      fireEvent.change(screen.getByTestId('revision-select'), { target: { value: '2' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('preset-edit-sensor-higher'));
    });

    const outcome = screen.getByTestId('edit-outcome-banner');
    expect(outcome.getAttribute('data-accepted')).toBe('false');
    expect(outcome.textContent).toContain('edits cannot be validated in fixture mode');
  });
});
