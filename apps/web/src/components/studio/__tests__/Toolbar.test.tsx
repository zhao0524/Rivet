import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toolbar, type ToolbarProps } from '../Toolbar';

afterEach(() => {
  cleanup();
});

function props(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    assemblyMode: 'assembled',
    explodeAmount: 0,
    onAssemblyModeChange: vi.fn(),
    onExplodeAmountChange: vi.fn(),
    selectedInstanceId: null,
    selectedLabel: null,
    isolatedInstanceId: null,
    hiddenCount: 0,
    isSelectedHidden: false,
    onFitCamera: vi.fn(),
    onSelectCameraPreset: vi.fn(),
    onToggleIsolateSelected: vi.fn(),
    onExitIsolation: vi.fn(),
    onToggleHideSelected: vi.fn(),
    onShowAllHidden: vi.fn(),
    showWiring: false,
    onToggleWiring: vi.fn(),
    showMounts: false,
    onToggleMounts: vi.fn(),
    wireframe: false,
    onToggleWireframe: vi.fn(),
    showGrid: true,
    onToggleGrid: vi.fn(),
    showDebug: false,
    onToggleDebug: vi.fn(),
    themeMode: 'dark',
    onToggleTheme: vi.fn(),
    ...overrides,
  };
}

const visibleControls = () =>
  Array.from(screen.getByRole('toolbar').querySelectorAll('button, select, input')).filter(
    (el) => !el.closest('[role="menu"]'),
  );

describe('Toolbar (#50)', () => {
  it('shows at most 6 controls by default and no part actions without a selection', () => {
    render(<Toolbar {...props()} />);
    expect(visibleControls().length).toBeLessThanOrEqual(6);
    expect(screen.queryByTestId('toolbar-isolate')).toBeNull();
    expect(screen.queryByTestId('toolbar-hide-selected')).toBeNull();
    expect(screen.queryByTestId('toolbar-explode-slider')).toBeNull();
  });

  it('shows the Spread slider only while exploded', () => {
    render(<Toolbar {...props({ assemblyMode: 'exploded', explodeAmount: 0.75 })} />);
    expect(screen.getByTestId('toolbar-explode-slider')).toBeDefined();
    expect(visibleControls().length).toBeLessThanOrEqual(6);
  });

  it('shows Isolate and Hide next to the selected part name', () => {
    const p = props({ selectedInstanceId: 'driver-1', selectedLabel: 'TB6612 breakout' });
    render(<Toolbar {...p} />);
    const group = screen.getByRole('group', { name: 'Selected part' });
    expect(group.textContent).toContain('TB6612 breakout');
    fireEvent.click(within(group).getByTestId('toolbar-isolate'));
    fireEvent.click(within(group).getByTestId('toolbar-hide-selected'));
    expect(p.onToggleIsolateSelected).toHaveBeenCalledTimes(1);
    expect(p.onToggleHideSelected).toHaveBeenCalledTimes(1);
  });

  it('applies a camera preset from the view dropdown', () => {
    const p = props();
    render(<Toolbar {...p} />);
    fireEvent.change(screen.getByTestId('toolbar-camera-select'), { target: { value: 'top' } });
    expect(p.onSelectCameraPreset).toHaveBeenCalledWith({ azimuthDeg: 0, elevationDeg: 82 });
  });

  it('reaches every secondary control in two clicks through the View menu, with the same callbacks', () => {
    const p = props({ hiddenCount: 2, isolatedInstanceId: 'driver-1', showDevControls: true });
    render(<Toolbar {...p} />);
    const cases: Array<[string, keyof ToolbarProps]> = [
      ['toolbar-toggle-steps', 'onAssemblyModeChange'],
      ['toolbar-toggle-wiring', 'onToggleWiring'],
      ['toolbar-toggle-mounts', 'onToggleMounts'],
      ['toolbar-toggle-grid', 'onToggleGrid'],
      ['toolbar-toggle-theme', 'onToggleTheme'],
      ['toolbar-toggle-debug', 'onToggleDebug'],
      ['toolbar-exit-isolate', 'onExitIsolation'],
      ['toolbar-show-all', 'onShowAllHidden'],
    ];
    for (const [testId, callback] of cases) {
      if (!screen.queryByRole('menu')) fireEvent.click(screen.getByTestId('toolbar-view-menu'));
      fireEvent.click(screen.getByTestId(testId));
      expect(p[callback]).toHaveBeenCalled();
    }
  });

  it('keeps developer-only render stats out of the View menu unless dev controls are on (#54)', () => {
    render(<Toolbar {...props()} />);
    fireEvent.click(screen.getByTestId('toolbar-view-menu'));
    expect(screen.queryByTestId('toolbar-toggle-debug')).toBeNull();
  });

  it('reports toggle state in the menu', () => {
    render(<Toolbar {...props({ showGrid: true, showMounts: false })} />);
    fireEvent.click(screen.getByTestId('toolbar-view-menu'));
    expect(screen.getByTestId('toolbar-toggle-grid').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('toolbar-toggle-mounts').getAttribute('aria-checked')).toBe('false');
  });

  it('is keyboard accessible: ArrowDown opens the menu, arrows move, Escape closes and returns focus', () => {
    render(<Toolbar {...props()} />);
    const menuButton = screen.getByTestId('toolbar-view-menu');
    menuButton.focus();

    fireEvent.keyDown(menuButton, { key: 'ArrowDown' });
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitemcheckbox');
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(menuButton);
  });
});
