import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Studio, STUDIO_MODES } from '../src/components/studio';
import { FixtureSource } from '../src/lib/contracts';

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

// Flush the fixture source's async catalog/revision loads so state settles inside act().
async function renderStudio() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<Studio initialDataSource={new FixtureSource()} />);
  });
  return result;
}
const slot = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLElement>(`[data-slot="${name}"]`);

describe('Studio shell layout (#49)', () => {
  it('is a full-height shell: top bar, one-line banner, then a workspace whose panels scroll internally', async () => {
    const { container } = await renderStudio();
    const shell = container.querySelector<HTMLElement>('[data-rivet="studio-shell"]')!;

    expect(shell.classList.contains('rv-shell')).toBe(true);
    expect(shell.getAttribute('data-layout')).toBe('viewport');
    expect(Array.from(shell.children).map((el) => el.getAttribute('data-slot'))).toEqual([
      'header',
      'banner',
      'workspace',
    ]);
    for (const name of ['sidebar', 'inspector']) {
      expect(slot(container, name)!.classList.contains('rv-panel')).toBe(true);
    }
  });

  it('floats the toolbar over the scene instead of stacking it above', async () => {
    const { container } = await renderStudio();
    expect(slot(container, 'scene')!.contains(slot(container, 'toolbar'))).toBe(true);
  });

  it('shows the assembly timeline only in Assemble mode, so the scene gets the space otherwise', async () => {
    const { container } = await renderStudio();
    expect(slot(container, 'timeline')).toBeNull();
    fireEvent.click(screen.getByTestId('studio-mode-assemble'));
    expect(slot(container, 'timeline')).not.toBeNull();
  });
});

describe('Single navigation (#51)', () => {
  it('has exactly one mode navigation, in the top bar, and no inspector tabs or footer mode bar', async () => {
    const { container } = await renderStudio();
    const navs = screen.getAllByRole('navigation', { name: 'Studio modes' });
    expect(navs).toHaveLength(1);
    expect(slot(container, 'header')!.contains(navs[0]!)).toBe(true);
    expect(within(navs[0]!).getAllByRole('button').map((b) => b.textContent)).toEqual(
      STUDIO_MODES.map((m) => m.label),
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
    expect(screen.queryByTestId('inspector-tab-exports')).toBeNull();
  });

  it('marks the active mode and lets the mode decide what the right panel shows', async () => {
    await renderStudio();
    const expected: Record<string, string> = {
      design: 'part-inspector',
      inspect: 'inspector-bom-section',
      wiring: 'inspector-wiring-tab',
      assemble: 'inspector-assembly-steps',
      simulate: 'inspector-simulation',
    };
    for (const mode of STUDIO_MODES) {
      fireEvent.click(screen.getByTestId(`studio-mode-${mode.id}`));
      expect(screen.getByTestId(`studio-mode-${mode.id}`).getAttribute('aria-current')).toBe('page');
      expect(screen.getByTestId('studio-inspector').getAttribute('data-mode')).toBe(mode.id);
      expect(screen.getByTestId(expected[mode.id]!)).toBeDefined();
    }
  });

  it('never loses the selected part or the revision when switching modes', async () => {
    await renderStudio();
    fireEvent.click(screen.getByTestId('tree-select-driver-1'));
    const identity = screen.getByTestId('studio-build-identity').textContent;

    for (const mode of [...STUDIO_MODES.map((m) => m.id), 'design']) {
      fireEvent.click(screen.getByTestId(`studio-mode-${mode}`));
    }

    expect(screen.getByTestId('inspector-instance-id').textContent).toBe('driver-1');
    expect(screen.getByTestId('studio-build-identity').textContent).toBe(identity);
  });

  it('clicking an assembly step in the right panel scrubs the timeline to it', async () => {
    await renderStudio();
    fireEvent.click(screen.getByTestId('studio-mode-assemble'));
    fireEvent.click(screen.getByTestId('inspector-step-4'));
    expect(screen.getByTestId('rover-scene').getAttribute('data-assembly-mode')).toBe('step');
    expect(screen.getByTestId('inspector-step-4').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('timeline-active-step-details').textContent).toContain(
      'Place controller and driver',
    );
  });

  it('opens exports from a named Export button in a dialog that Escape closes', async () => {
    await renderStudio();
    const opener = screen.getByTestId('header-open-export');
    act(() => {
      opener.focus();
      fireEvent.click(opener);
    });

    const dialog = screen.getByRole('dialog', { name: 'Export build package' });
    expect(within(dialog).getByTestId('export-bom-csv')).toBeDefined();
    expect(within(dialog).getByTestId('estelle-grounding-panel')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('Responsive drawers (#55)', () => {
  it('opens the details drawer from the top bar so the inspector is reachable on narrow screens', async () => {
    const { container } = await renderStudio();
    const toggle = screen.getByTestId('shell-toggle-inspector');
    const inspector = slot(container, 'inspector')!;

    expect(toggle.getAttribute('aria-controls')).toBe(inspector.id);
    expect(inspector.getAttribute('data-open')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(inspector.getAttribute('data-open')).toBe('true');
    expect(within(inspector).getByTestId('studio-inspector')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inspector.getAttribute('data-open')).toBe('false');
  });

  it('shows one drawer at a time and closes on the scrim', async () => {
    const { container } = await renderStudio();
    fireEvent.click(screen.getByTestId('shell-toggle-sidebar'));
    expect(slot(container, 'sidebar')!.getAttribute('data-open')).toBe('true');

    fireEvent.click(screen.getByTestId('shell-toggle-inspector'));
    expect(slot(container, 'sidebar')!.getAttribute('data-open')).toBe('false');
    expect(slot(container, 'inspector')!.getAttribute('data-open')).toBe('true');

    fireEvent.click(container.querySelector('.rv-scrim')!);
    expect(slot(container, 'inspector')!.getAttribute('data-open')).toBe('false');
  });

  it('brings the details drawer forward when a part is selected', async () => {
    const { container } = await renderStudio();
    fireEvent.click(screen.getByTestId('shell-toggle-sidebar'));
    fireEvent.click(screen.getByTestId('tree-select-sensor-1'));
    expect(slot(container, 'sidebar')!.getAttribute('data-open')).toBe('false');
    expect(slot(container, 'inspector')!.getAttribute('data-open')).toBe('true');
  });
});
