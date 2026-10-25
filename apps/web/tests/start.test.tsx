import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowProvider } from '../src/components/flow/FlowProvider';
import { ProjectShell } from '../src/components/flow/ProjectShell';
import { NewProjectScreen } from '../src/components/start/NewProjectScreen';
import { ClarifyScreen } from '../src/components/start/ClarifyScreen';
import { GenerateScreen } from '../src/components/start/GenerateScreen';
import { ProjectsScreen } from '../src/components/start/ProjectsScreen';
import { summarizeIntent, whereIs } from '../src/components/start/shared';
import { getSyntheticRoverIntent } from '../src/lib/fixtures';
import { createProjectRecord, getProject, saveProject, writeDraft } from '../src/lib/flow/projects';
import { useStudioPlanStore } from '../src/lib/plan-store';

const nav = { push: vi.fn(), replace: vi.fn(), pathname: '/', search: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// The 3D scene needs WebGL; the Generate screen only needs to know it rendered.
vi.mock('../src/components/three/RoverScene', () => ({
  RoverScene: (props: { assemblyMode?: string }) => <div data-testid="rover-scene" data-mode={props.assemblyMode} />,
}));

const startGeneration = vi.fn();
/** When set, replaces the store's startGeneration (e.g. to simulate an engine failure). */
let startOverride: (() => Promise<never>) | null = null;

/** A real store whose startGeneration is spied on, injected through FlowProvider. */
function SpiedFlow({ children }: { children: React.ReactNode }) {
  const store = useStudioPlanStore();
  startGeneration.mockImplementation(startOverride ?? store.startGeneration);
  return <FlowProvider store={{ ...store, startGeneration }}>{children}</FlowProvider>;
}

beforeEach(() => {
  localStorage.clear();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.pathname = '/';
  nav.search = '';
  startGeneration.mockReset();
  startOverride = null;
});
afterEach(cleanup);

async function renderIn(ui: React.ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<SpiedFlow>{ui}</SpiedFlow>);
  });
  return result;
}

describe('A1 Prompt', () => {
  it('creates the project under the draft id and goes to clarify', async () => {
    writeDraft({ id: 'p_draft1', text: 'A tiny rover that avoids chairs' });
    await renderIn(<NewProjectScreen />);
    const input = await screen.findByTestId('new-prompt-input');
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe('A tiny rover that avoids chairs'));
    fireEvent.click(screen.getByTestId('new-prompt-submit'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/p/p_draft1/clarify'));
    const project = getProject('p_draft1');
    expect(project?.phase).toBe('clarify');
    expect(project?.prompt).toBe('A tiny rover that avoids chairs');
    expect(project?.title).toBe('A tiny rover that avoids chairs');
    expect(localStorage.getItem('rivet.draft.v1')).toBeNull();
  });

  it('prefills from ?prompt= and updates an existing project instead of duplicating it', async () => {
    saveProject(createProjectRecord({ id: 'p_again', prompt: 'old prompt', phase: 'clarify' }));
    nav.search = 'draft=p_again&prompt=new%20prompt';
    await renderIn(<NewProjectScreen />);
    const input = await screen.findByTestId('new-prompt-input');
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe('new prompt'));
    fireEvent.click(screen.getByTestId('new-prompt-submit'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/p/p_again/clarify'));
    const all = JSON.parse(localStorage.getItem('rivet.projects.v1') ?? '[]') as unknown[];
    expect(all).toHaveLength(1);
    expect(getProject('p_again')?.prompt).toBe('new prompt');
  });
});

describe('A2 Clarify', () => {
  function seed(id: string) {
    saveProject(createProjectRecord({ id, prompt: 'Build a small rover that avoids obstacles', phase: 'clarify' }));
    nav.pathname = `/p/${id}/clarify`;
  }

  it('asks three questions, maps the budget choice and ends on Generate', async () => {
    seed('p_cl1');
    await renderIn(
      <ProjectShell id="p_cl1">
        <ClarifyScreen />
      </ProjectShell>,
    );
    await screen.findByTestId('clarify-understood');
    expect(screen.getByTestId('clarify-progress').textContent).toBe('Question 1 of 3');
    expect(screen.getByTestId('clarify-offline')).toBeTruthy();
    expect(getProject('p_cl1')?.intentId).toBe('intent-rover-001');
    fireEvent.click(screen.getByTestId('clarify-next'));
    expect(screen.getByTestId('clarify-progress').textContent).toBe('Question 2 of 3');
    fireEvent.click(screen.getByTestId('clarify-budget-50'));
    fireEvent.click(screen.getByTestId('clarify-next'));
    expect(getProject('p_cl1')?.clarify.max_budget).toBe(50);
    expect(screen.getByTestId('clarify-progress').textContent).toBe('Question 3 of 3');
    expect(screen.getByTestId('clarify-next').textContent).toContain('Generate');
    fireEvent.click(screen.getByTestId('clarify-next'));
    const project = getProject('p_cl1');
    expect(project?.phase).toBe('generating');
    expect(project?.clarify).toMatchObject({ max_budget: 50, max_length_mm: null, interpretation_choice: 'as_interpreted' });
    expect(nav.push).toHaveBeenCalledWith('/p/p_cl1/generate');
  });

  it('"Skip the rest" goes straight to Generate with defaults', async () => {
    seed('p_cl2');
    await renderIn(
      <ProjectShell id="p_cl2">
        <ClarifyScreen />
      </ProjectShell>,
    );
    await screen.findByTestId('clarify-understood');
    fireEvent.click(screen.getByTestId('clarify-skip'));
    expect(getProject('p_cl2')?.phase).toBe('generating');
    expect(getProject('p_cl2')?.clarify).toMatchObject({ max_budget: null, max_length_mm: null });
    expect(nav.push).toHaveBeenCalledWith('/p/p_cl2/generate');
  });

  it('a custom budget needs a number before Next is enabled', async () => {
    seed('p_cl3');
    await renderIn(
      <ProjectShell id="p_cl3">
        <ClarifyScreen />
      </ProjectShell>,
    );
    await screen.findByTestId('clarify-understood');
    fireEvent.click(screen.getByTestId('clarify-next'));
    fireEvent.click(screen.getByTestId('clarify-budget-custom'));
    expect((screen.getByTestId('clarify-next') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('clarify-budget-amount'), { target: { value: '75' } });
    fireEvent.click(screen.getByTestId('clarify-next'));
    expect(getProject('p_cl3')?.clarify.max_budget).toBe(75);
  });
});

describe('A3 Generate', () => {
  it('starts generation once, shows the real event, then Review marks the project ready', async () => {
    saveProject(createProjectRecord({ id: 'p_gen1', prompt: 'Build a small rover that avoids obstacles', phase: 'generating' }));
    nav.pathname = '/p/p_gen1/generate';
    await renderIn(
      <ProjectShell id="p_gen1">
        <GenerateScreen />
      </ProjectShell>,
    );
    const review = await screen.findByTestId('generate-review');
    expect(startGeneration).toHaveBeenCalledTimes(1);
    expect(startGeneration.mock.calls[0][0]).toMatchObject({
      input: { kind: 'text', image_asset_id: null, user_text: 'Build a small rover that avoids obstacles' },
      requirements: { max_budget: null, currency: 'USD' },
    });
    expect(screen.getByTestId('generate-tape').textContent).toContain('no live generation ran');
    expect(screen.getByTestId('generate-fixture-note')).toBeTruthy();
    expect(screen.getByTestId('generate-done').textContent).toMatch(/\d+\s*parts/);
    expect(screen.queryByTestId('generate-cancel')).toBeNull();
    fireEvent.click(review);
    const project = getProject('p_gen1');
    expect(project?.phase).toBe('ready');
    expect(project?.buildId).toBeTruthy();
    expect(project?.furthestStep).toBe('review');
    expect(nav.push).toHaveBeenCalledWith('/p/p_gen1/review');
  });

  it('shows the engine error and Resume starts generation again', async () => {
    startOverride = () => Promise.reject(new Error('Engine offline'));
    saveProject(createProjectRecord({ id: 'p_gen3', prompt: 'rover', phase: 'generating' }));
    nav.pathname = '/p/p_gen3/generate';
    await renderIn(
      <ProjectShell id="p_gen3">
        <GenerateScreen />
      </ProjectShell>,
    );
    const error = await screen.findByTestId('generate-error');
    expect(error.textContent).toContain('Engine offline');
    expect(screen.queryByTestId('generate-review')).toBeNull();
    expect(startGeneration).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-resume'));
    });
    expect(startGeneration).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('generate-cancel'));
    expect(getProject('p_gen3')?.phase).toBe('clarify');
    expect(nav.push).toHaveBeenCalledWith('/p/p_gen3/clarify');
  });

  it('shows the done state without starting a job when the project is already ready', async () => {
    saveProject(
      createProjectRecord({
        id: 'p_gen2',
        prompt: 'x',
        phase: 'ready',
        exampleId: 'rivet-intent-rover-001',
        buildId: 'rivet-intent-rover-001',
      }),
    );
    nav.pathname = '/p/p_gen2/generate';
    await renderIn(
      <ProjectShell id="p_gen2">
        <GenerateScreen />
      </ProjectShell>,
    );
    await screen.findByTestId('generate-review');
    expect(startGeneration).not.toHaveBeenCalled();
  });
});

describe('A0 Projects', () => {
  it('shows the empty state, and "See an example" opens a ready example project', async () => {
    await renderIn(<ProjectsScreen />);
    await screen.findByTestId('projects-empty');
    fireEvent.click(screen.getByTestId('projects-example'));
    const all = JSON.parse(localStorage.getItem('rivet.projects.v1') ?? '[]') as Array<Record<string, unknown>>;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ exampleId: 'rivet-intent-rover-001', buildId: 'rivet-intent-rover-001', phase: 'ready', furthestStep: 'review', title: 'Indoor obstacle rover (example)' });
    expect(nav.push).toHaveBeenCalledWith(`/p/${all[0]!.id}`);
  });

  it('lists projects with where they are and deletes after confirmation', async () => {
    saveProject({ ...createProjectRecord({ id: 'p_a', prompt: 'rover one', phase: 'ready', buildId: 'b' }), furthestStep: 'wiring' });
    await renderIn(<ProjectsScreen />);
    const card = await screen.findByTestId('projects-card-p_a');
    expect(card.textContent).toContain('Step 3 of 5 · Wiring & firmware');
    fireEvent.click(screen.getByTestId('projects-menu-p_a'));
    fireEvent.click(screen.getByTestId('projects-delete'));
    await screen.findByTestId('projects-delete-modal');
    fireEvent.click(screen.getByTestId('projects-delete-confirm'));
    await waitFor(() => expect(getProject('p_a')).toBeNull());
  });
});

describe('wording', () => {
  it('describes where a project is and summarizes an intent without raw ids', () => {
    expect(whereIs(createProjectRecord({ prompt: 'x', phase: 'clarify' }))).toBe('Clarifying');
    expect(whereIs(createProjectRecord({ prompt: 'x', phase: 'generating' }))).toBe('Generating');
    expect(whereIs({ ...createProjectRecord({ prompt: 'x', phase: 'ready' }), furthestStep: 'done' })).toBe('Done');
    const s = summarizeIntent(getSyntheticRoverIntent());
    expect(s.headline).toBe('Rivet read this as an indoor rover that drives around and avoids obstacles.');
    expect(s.facts.join(' ')).toContain('two independently driven wheels and a forward distance sensor');
    expect(s.facts.join(' ')).not.toContain('board.esp32');
    expect(s.unknowns).toContain('Still unknown');
  });
});
