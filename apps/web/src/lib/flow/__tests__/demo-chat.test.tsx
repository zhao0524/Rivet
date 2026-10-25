import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Chat } from '../../../components/workspace/Chat';
import type { WorkspaceSession } from '../../../components/workspace/session';
import type { BuildPlan, StageEvent } from '../../rivet/types';
import { createProjectRecord, type GenerationSummary } from '../projects';
import { asEngineeredDemo, demoPaceTotalMs, demoReading, demoThinkingSteps, revealDemoPace } from '../demo-chat';

const KEYS = ['drone', 'fpv_car', 'rc_truck', 'boat', 'arm', 'robot_dog', 'pi_camera', 'esp32'] as const;

describe('demo chat voice', () => {
  it('reads each demo photo as a supported build', () => {
    for (const key of KEYS) {
      const reading = demoReading(key);
      expect(reading?.supported).toBe(true);
      expect(reading?.offline).toBe(false);
      expect(reading?.limitation).toBeNull();
      expect(reading?.headline.startsWith('Rivet read this as ')).toBe(true);
    }
    expect(demoReading(null)).toBeNull();
    expect(demoReading('rover')).toBeNull();
  });

  it('words the build as engineered and keeps the part count', () => {
    const summary: GenerationSummary = {
      title: 'Toy camera quadcopter',
      parts: 42,
      total: 'about $80.00',
      fixture: true,
      concept: true,
      decisions: [{ text: 'Nothing engineered' }],
    };
    const next = asEngineeredDemo(summary, 6);
    expect(next.concept).toBe(false);
    expect(next.fixture).toBe(false);
    expect(next.parts).toBe(42);
    expect(next.decisions.map((d) => d.text)).toEqual([
      'Picked 42 parts',
      'Connected them with 6 wires',
      'Ran the checks: all passed',
      'Wrote starter code, and it compiled',
    ]);
  });

  it('does not repeat the concept warning in the thinking steps', () => {
    const events: StageEvent[] = [
      event(1, 'understand', 'ok', 'Recognised a quadcopter drone (matched a reference model)'),
      event(2, 'validate', 'warning', 'Concept model: appearance only, nothing engineered or sourced'),
    ];
    const steps = demoThinkingSteps(events, false, 'drone');
    expect(steps).not.toBeNull();
    expect(steps!.map((s) => s.status)).toEqual(['done', 'done']);
    expect(steps!.some((s) => /nothing engineered|concept model|reference model/i.test(`${s.text} ${s.detail}`))).toBe(false);
    expect(steps![0]?.detail).toContain('toy camera quadcopter');
    expect(demoThinkingSteps(events, false, 'nope')).toBeNull();
  });

  it('plays the engineering steps out over a readable stretch', () => {
    const total = demoPaceTotalMs('drone');
    expect(total).toBeGreaterThan(12_000);
    expect(demoPaceTotalMs('nope')).toBe(0);

    const start = revealDemoPace('drone', 0);
    expect(start?.done).toBe(false);
    expect(start?.steps.map((s) => s.status)).toEqual(['running']);
    expect(start?.current).toBe('Looking at your picture');

    const mid = revealDemoPace('drone', 1800 + 2600 + 10);
    expect(mid?.steps.map((s) => s.status)).toEqual(['done', 'done', 'running']);
    expect(mid?.steps[1]?.detail).toContain('toy camera quadcopter');

    const done = revealDemoPace('fpv_car', total);
    expect(done?.done).toBe(true);
    expect(done?.steps).toHaveLength(6);
    expect(done?.steps.every((s) => s.status === 'done')).toBe(true);
    expect(done?.steps.some((s) => /nothing engineered|concept model/i.test(`${s.text} ${s.detail}`))).toBe(false);
    expect(revealDemoPace('nope', 0)).toBeNull();
  });

  it('shows that opening in the chat and still sends a change', async () => {
    const send = vi.fn(async () => {});
    const project = createProjectRecord({
      id: 'p_demo',
      prompt: 'Build this drone',
      demoKey: 'drone',
      imageAssetId: 'asset_demo',
      phase: 'ready',
    });
    project.reading = demoReading('drone');
    const summary = asEngineeredDemo(
      { title: 'Toy camera quadcopter', parts: 12, total: null, fixture: false, concept: false, decisions: [] },
      0,
    );
    const session: WorkspaceSession = {
      chat: {
        log: [
          { id: 'prompt', kind: 'prompt' },
          { id: 'read', kind: 'reading' },
          { id: 'gen', kind: 'generation', run: 1, summary },
        ],
        answered: { use: true, budget: true, size: true },
        runs: 1,
      },
      status: 'ready',
      liveRun: 1,
      stageText: 'Ready',
      paceStartedAt: null,
      paceNow: 0,
      errorMessage: null,
      editPending: false,
      reread: false,
      answer: () => {},
      retry: () => {},
      retryReading: () => {},
      skipReading: () => {},
      send,
    };
    const events = [event(2, 'validate', 'warning', 'Concept model: appearance only, nothing engineered or sourced')];
    render(<Chat project={project} session={session} plan={{ components: [] } as unknown as BuildPlan} events={events} fixture={false} />);

    expect(screen.getByTestId('workspace-chat-understood').textContent).toContain('toy camera quadcopter');
    expect(screen.queryByTestId('workspace-chat-limitation')).toBeNull();
    const built = screen.getByTestId('workspace-chat-built');
    expect(built.textContent).toContain('Built');
    expect(built.textContent).toContain('Ran the checks: all passed');
    expect(built.textContent).toContain('Wrote starter code, and it compiled');
    expect(built.textContent).not.toMatch(/Concept model|nothing engineered|saved example/i);

    const box = screen.getByTestId('workspace-composer') as HTMLTextAreaElement;
    expect(box.disabled).toBe(false);
    await userEvent.type(box, 'Make the body red');
    await userEvent.click(screen.getByTestId('workspace-send'));
    expect(send).toHaveBeenCalledWith('Make the body red', undefined);
  });
});

function event(id: number, stage: StageEvent['stage'], status: StageEvent['status'], message: string): StageEvent {
  return {
    event_id: id,
    job_id: 'job-1',
    stage,
    actor: 'system',
    status,
    message,
    timestamp: '2026-10-25T12:00:00Z',
    references: [],
  };
}
