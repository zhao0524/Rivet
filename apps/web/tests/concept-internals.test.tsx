import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Studio } from '../src/components/studio';
import { FixtureSource } from '../src/lib/contracts';
import { getConceptExamplePlan } from '../src/lib/fixtures';

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>();
  return {
    ...actual,
    Canvas: (props: { frameloop?: string }) => <div data-testid="r3f-canvas" data-frameloop={props.frameloop} />,
  };
});

afterEach(cleanup);

describe('concept model internal components', () => {
  const plan = getConceptExamplePlan();
  const internal = plan.components.filter((c) => c.render_overrides?.internal === true);
  const visible = plan.components.filter((c) => c.render_overrides?.internal !== true);

  it('the saved drone concept carries inferred internals (flight controller, ESCs, PDB, receiver)', () => {
    const labels = internal.filter((c) => c.role !== 'wire').map((c) => String(c.render_overrides.label));
    expect(labels).toEqual(expect.arrayContaining(['Flight controller', 'Power distribution board', 'Radio receiver']));
    expect(labels.filter((l) => l.includes('ESC'))).toHaveLength(4);
    expect(plan.verification.findings.some((f) => f.rule_id === 'concept.internals_inferred')).toBe(true);
  });

  it('the parts list marks internal parts as inside and inferred, and only those', async () => {
    render(<Studio initialDataSource={new FixtureSource({ plans: [plan] })} />);
    await waitFor(() => expect(screen.getByTestId(`tree-select-${internal[0].instance_id}`)).toBeTruthy());
    for (const c of internal) {
      expect(screen.getByTestId(`tree-select-${c.instance_id}`).textContent).toContain('inside, inferred');
    }
    for (const c of visible) {
      expect(screen.getByTestId(`tree-select-${c.instance_id}`).textContent).not.toContain('inside, inferred');
    }
  });
});
