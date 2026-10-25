import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attentionChecks,
  cleanEngineMessage,
  decisionSummary,
  eventSteps,
  eventsElapsedMs,
  partNames,
  phaseStates,
} from '../src/components/start/shared';
import { Thinking, formatElapsed, type ThinkingStep } from '../src/components/system/Thinking';
import { TreeView, type TreeNode } from '../src/components/system/TreeView';
import { getSourcedCatalog, getSourcedRoverPlan } from '../src/lib/fixtures';
import { partRows } from '../src/lib/flow/derive';
import type { StageEvent } from '../src/lib/rivet/types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const STEPS: ThinkingStep[] = [
  { id: 'a', text: 'Reading your idea', detail: 'Rover with a distance sensor', status: 'done' },
  { id: 'b', text: 'Choosing parts from the catalog', status: 'running' },
];

describe('Thinking', () => {
  it('shows only the steps it is given, newest lit while running', () => {
    render(<Thinking running steps={STEPS} testId="t" />);
    const items = within(screen.getByTestId('t-steps')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Reading your ideaRover with a distance sensor', 'Choosing parts from the catalog']);
    expect(items[1]!.hasAttribute('data-now')).toBe(true);
    expect(items[0]!.hasAttribute('data-now')).toBe(false);
    expect(screen.getByTestId('t-label').textContent).toBe('Thinking');
    expect(screen.getByTestId('t-toggle').getAttribute('aria-expanded')).toBe('true');
    // No timer adds steps on its own.
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(within(screen.getByTestId('t-steps')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('folds into the real elapsed time when done and reopens on click', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Thinking running steps={STEPS} testId="t" />);
    const done = STEPS.map((s) => ({ ...s, status: 'done' as const }));
    rerender(<Thinking running={false} steps={done} elapsedMs={4200} testId="t" />);
    expect(screen.getByTestId('t-label').textContent).toBe('Thought for 4s');
    act(() => {
      vi.advanceTimersByTime(800);
    });
    const toggle = screen.getByTestId('t-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('stays open when a step failed, and marks it with text, not only color', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Thinking running steps={STEPS} testId="t" />);
    const failed: ThinkingStep[] = [STEPS[0]!, { id: 'b', text: 'Choosing parts from the catalog', detail: 'No motor fits', status: 'failed' }];
    rerender(<Thinking running={false} steps={failed} elapsedMs={1500} testId="t" />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('t-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('t-steps').textContent).toContain("Didn't work");
  });

  it('uses the given done label, and Replay re-shows the recorded steps without adding any', () => {
    vi.useFakeTimers();
    const onReplay = vi.fn();
    render(<Thinking running={false} steps={STEPS} doneLabel="Loaded instantly" onReplay={onReplay} defaultOpen testId="t" />);
    expect(screen.getByTestId('t-label').textContent).toBe('Loaded instantly');
    fireEvent.click(screen.getByTestId('t-replay'));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('t-steps').querySelectorAll('li')).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(460);
    });
    expect(screen.getByTestId('t-steps').querySelectorAll('li')).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(460);
      });
    }
    expect(screen.getByTestId('t-steps').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByTestId('t-label').textContent).toBe('Loaded instantly');
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(40)).toBe('0.1s');
    expect(formatElapsed(420)).toBe('0.4s');
    expect(formatElapsed(12_400)).toBe('12s');
    expect(formatElapsed(125_000)).toBe('2m 5s');
  });
});

const TREE: TreeNode[] = [
  {
    id: 'parts',
    label: 'Choosing parts',
    status: 'done',
    children: [
      { id: 'm', label: 'Motor', detail: 'Turns a wheel' },
      { id: 's', label: 'Sensor', status: 'warning' },
    ],
  },
  { id: 'check', label: 'Checking it works', status: 'running', children: [{ id: 'c1', label: 'Fit' }] },
  { id: 'code', label: 'Writing the code', status: 'pending' },
];

describe('TreeView', () => {
  function Harness({ onSelect }: { onSelect: (id: string) => void }) {
    const [sel, setSel] = useState<string | null>(null);
    return (
      <TreeView
        nodes={TREE}
        label="Build"
        selectedId={sel}
        onSelect={(n) => {
          setSel(n.id);
          onSelect(n.id);
        }}
      />
    );
  }

  it('has tree roles, aria-expanded and status text', () => {
    render(<Harness onSelect={() => undefined} />);
    const tree = screen.getByRole('tree', { name: 'Build' });
    const items = within(tree).getAllByRole('treeitem');
    expect(items[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(items[0]!.getAttribute('aria-level')).toBe('1');
    expect(within(tree).getAllByRole('group').length).toBe(2);
    expect(tree.textContent).toContain('In progress');
    expect(tree.textContent).toContain('Not started');
    // Only one row is in the tab order.
    expect(items.filter((i) => i.tabIndex === 0)).toHaveLength(1);
  });

  it('moves with arrows, opens with Right, closes with Left and selects with Enter', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const tree = screen.getByRole('tree');
    const item = (label: string) => within(tree).getAllByRole('treeitem').find((i) => i.querySelector('.tv-name')?.textContent === label)!;
    const parts = item('Choosing parts');
    parts.focus();
    fireEvent.keyDown(parts, { key: 'ArrowRight' });
    expect(parts.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(parts, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(item('Motor'));
    fireEvent.keyDown(item('Motor'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('Sensor'));
    fireEvent.keyDown(item('Sensor'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('s');
    expect(item('Sensor').getAttribute('aria-selected')).toBe('true');
    expect(item('Motor').getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(item('Sensor'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(parts);
    fireEvent.keyDown(parts, { key: 'ArrowLeft' });
    expect(parts.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(parts, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('Checking it works'));
    fireEvent.keyDown(item('Checking it works'), { key: 'End' });
    expect(document.activeElement).toBe(item('Writing the code'));
    // Folders are not selectable; Enter toggles them.
    expect(item('Checking it works').hasAttribute('aria-selected')).toBe(false);
    fireEvent.keyDown(item('Writing the code'), { key: 'ArrowUp' });
    fireEvent.keyDown(item('Checking it works'), { key: 'Enter' });
    expect(item('Checking it works').getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking a folder toggles it; clicking a row selects it', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Checking it works'));
    const check = screen.getByText('Checking it works').closest('[role="treeitem"]')!;
    expect(check.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByText('Fit'));
    expect(onSelect).toHaveBeenCalledWith('c1');
  });
});

/* A live run, simulated in the test only: real-shaped events through the same wording the screen uses. */
function ev(id: number, stage: StageEvent['stage'], status: StageEvent['status'], message: string, sec: number): StageEvent {
  return {
    event_id: id,
    job_id: 'job_x',
    stage,
    actor: 'planner',
    status,
    message,
    timestamp: new Date(Date.UTC(2026, 9, 24, 12, 0, sec)).toISOString(),
    references: [],
  };
}

describe('generation wording from events', () => {
  const events: StageEvent[] = [
    ev(1, 'understand', 'running', 'Parsing intent_id intent-rover-001', 0),
    ev(2, 'understand', 'ok', 'Indoor rover with distance_sensing', 2),
    ev(3, 'catalog_selection', 'running', 'Scoring board.esp32_devkitc_v4 candidates', 3),
    ev(4, 'catalog_selection', 'ok', 'Picked 17 parts', 9),
    ev(5, 'validate', 'warning', 'motor-left-1 on chassis-1.motor_left: fit not documented', 12),
  ];

  it('one plain step per stage, engine message without ids, newest still running', () => {
    const steps = eventSteps(events.slice(0, 3), { live: true, fixture: false });
    expect(steps.map((s) => s.text)).toEqual(['Reading your idea', 'Choosing parts from the catalog']);
    expect(steps[0]!.detail).toBe('Indoor rover with distance sensing');
    expect(steps[1]!.status).toBe('running');
    expect(steps[1]!.detail).not.toContain('board.');
    const done = eventSteps(events, { live: false, fixture: false });
    expect(done.map((s) => s.status)).toEqual(['done', 'done', 'warning']);
    expect(eventsElapsedMs(events)).toBe(12_000);
    expect(eventsElapsedMs(events.slice(0, 1))).toBeNull();
  });

  it('renders a live run in Thinking with only those steps', () => {
    const steps = eventSteps(events.slice(0, 3), { live: true, fixture: false });
    render(<Thinking running steps={steps} testId="live" />);
    expect(screen.getByTestId('live-steps').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByTestId('live-steps').textContent).not.toMatch(/intent-rover-001|board\.esp32/);
  });

  it('phase states follow the events: done, running, pending', () => {
    const p = phaseStates(events.slice(0, 3), { live: true, finished: false, failed: false, fixture: false });
    expect(p.understand.status).toBe('done');
    expect(p.parts.status).toBe('running');
    expect(p.place.status).toBe('pending');
    expect(p.code.detail).toBe('Not started yet');
    const fx = phaseStates([], { live: false, finished: true, failed: false, fixture: true });
    expect(fx.parts.status).toBeUndefined();
    expect(fx.parts.detail).toBe('From the saved example');
  });

  it('the saved example event is worded plainly', () => {
    const fx = ev(1, 'complete', 'ok', 'Saved example loaded from checked-in fixture; no live generation ran.', 0);
    const steps = eventSteps([fx], { live: false, fixture: true });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.text).toBe('Opened a saved example');
    expect(steps[0]!.detail).not.toMatch(/fixture/);
  });

  it('cleans ids out of engine messages using part names', () => {
    const names = new Map([['motor-left-1', 'TT motor']]);
    expect(cleanEngineMessage('motor-left-1 on chassis-1.motor_left: fit not documented', names)).toBe('TT motor on chassis 1 motor left: fit not documented');
    expect(cleanEngineMessage('power-motor-1.v_out -> driver-1.vm')).toBe('power motor 1 v out to driver 1 vm');
    expect(cleanEngineMessage('Picked 17 parts from catalog v2026.10, at 2.4 V')).toBe('Picked 17 parts from catalog v2026.10, at 2.4 V');
  });

  it('summarizes what the saved plan decided from the plan itself', () => {
    const plan = getSourcedRoverPlan();
    const catalog = getSourcedCatalog();
    const decided = decisionSummary(plan, catalog);
    const parts = partRows(plan, catalog).length;
    expect(decided.find((d) => d.id === 'parts')!.text).toMatch(new RegExp(`^Picked ${parts} parts`));
    expect(decided.find((d) => d.id === 'wires')!.text).toBe(`Connected them with ${plan.connections.length} wires`);
    const total = plan.verification.findings.length;
    const passed = plan.verification.findings.filter((f) => f.result === 'PASS').length;
    expect(decided.find((d) => d.id === 'checks')!.text).toBe(`Ran ${total} checks: ${passed} passed, ${total - passed} need your eyes`);
    expect(decided.find((d) => d.id === 'steps')!.text).toBe(`Planned ${plan.assembly_steps.length} assembly steps`);
    const checks = attentionChecks(plan, partNames(partRows(plan, catalog)));
    expect(checks[0]!.blocking).toBe(true);
    expect(checks.map((c) => c.title).join(' ')).not.toMatch(/[a-z]+\.[a-z_]+/);
  });
});
