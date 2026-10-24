// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssemblyTimelineControls, type AssemblyTimelineControlsProps } from '../AssemblyTimelineControls';

afterEach(cleanup);

function setup(over: Partial<AssemblyTimelineControlsProps> = {}) {
  const props: AssemblyTimelineControlsProps = {
    stepCount: 8,
    position: 3,
    playing: false,
    explode: 0.25,
    steps: [{ index: 3, title: 'Install the wheels and caster' }],
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onNext: vi.fn(),
    onBack: vi.fn(),
    onScrub: vi.fn(),
    onExplodeChange: vi.fn(),
    onReset: vi.fn(),
    ...over,
  };
  render(<AssemblyTimelineControls {...props} />);
  return props;
}

describe('AssemblyTimelineControls', () => {
  it('emits callbacks and holds no state', () => {
    const p = setup();
    expect(screen.getByText('Step 3 of 8 · Install the wheels and caster')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Play'));
    fireEvent.click(screen.getByLabelText('Next step'));
    fireEvent.click(screen.getByLabelText('Previous step'));
    fireEvent.click(screen.getByText('Full assembly'));
    fireEvent.change(screen.getByLabelText('Assembly step'), { target: { value: '4.5' } });
    fireEvent.change(screen.getByLabelText('Explode'), { target: { value: '0.8' } });
    expect(p.onPlay).toHaveBeenCalledOnce();
    expect(p.onNext).toHaveBeenCalledOnce();
    expect(p.onBack).toHaveBeenCalledOnce();
    expect(p.onReset).toHaveBeenCalledOnce();
    expect(p.onScrub).toHaveBeenCalledWith(4.5);
    expect(p.onExplodeChange).toHaveBeenCalledWith(0.8);
    expect((screen.getByLabelText('Assembly step') as HTMLInputElement).value).toBe('3');
  });

  it('shows pause while playing and disables back/next at the ends', () => {
    const p = setup({ playing: true, position: 0 });
    expect(screen.getByText('Prep · 0 of 8')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(p.onPause).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('Previous step') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    setup({ position: 8 });
    expect((screen.getByLabelText('Next step') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables step controls when the plan has no steps', () => {
    setup({ stepCount: 0, position: 0, explode: undefined, onExplodeChange: undefined });
    expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText('Explode')).toBeNull();
  });
});
