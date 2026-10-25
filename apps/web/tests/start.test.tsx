import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowProvider } from '../src/components/flow/FlowProvider';
import { ProjectShell } from '../src/components/flow/ProjectShell';
import { NewProjectScreen } from '../src/components/start/NewProjectScreen';
import { ProjectsScreen } from '../src/components/start/ProjectsScreen';
import { WorkspaceScreen } from '../src/components/workspace/WorkspaceScreen';
import { summarizeIntent, whereIs } from '../src/components/start/shared';
import { getSyntheticRoverIntent } from '../src/lib/fixtures';
import { createProjectRecord, getProject, saveProject, writeDraft } from '../src/lib/flow/projects';
import { STEPS } from '../src/lib/flow/steps';
import { useStudioPlanStore } from '../src/lib/plan-store';

const nav = { push: vi.fn(), replace: vi.fn(), pathname: '/', search: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// The 3D scene needs WebGL; the workspace only needs to know it rendered.
vi.mock('../src/components/three/RoverScene', () => ({
  RoverScene: (props: { assemblyMode?: string }) => <div data-testid="rover-scene" data-mode={props.assemblyMode} />,
}));

const startGeneration = vi.fn();
/** When set, replaces the store's startGeneration (e.g. to simulate an engine failure). */
let startOverride: (() => Promise<never>) | null = null;

/** When set, the data source reads every prompt as this unsupported family. */
let unsupportedFamily: string | null = null;

/** A real store whose startGeneration is spied on, injected through FlowProvider. */
function SpiedFlow({ children }: { children: React.ReactNode }) {
  const store = useStudioPlanStore();
  startGeneration.mockImplementation(startOverride ?? store.startGeneration);
  const base = store.dataSource;
  const dataSource =
    unsupportedFamily && base.interpret
      ? Object.assign(Object.create(base) as typeof base, {
          interpret: async (...args: Parameters<NonNullable<typeof base.interpret>>) => {
            const res = await base.interpret!(...args);
            return {
              ...res,
              intent: { ...res.intent, project_family: unsupportedFamily! },
              supported: false,
              limitation: {
                code: 'UNSUPPORTED_PROJECT_FAMILY',
                message: `Projects of family '${unsupportedFamily}' are not supported in this version`,
                details: {},
              },
            };
          },
        })
      : base;
  return <FlowProvider store={{ ...store, dataSource, startGeneration }}>{children}</FlowProvider>;
}

beforeEach(() => {
  localStorage.clear();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.pathname = '/';
  nav.search = '';
  startGeneration.mockReset();
  startOverride = null;
  unsupportedFamily = null;
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
  it('creates the project under the draft id and goes straight to the workspace', async () => {
    writeDraft({ id: 'p_draft1', text: 'A tiny rover that avoids chairs' });
    await renderIn(<NewProjectScreen />);
    const input = await screen.findByTestId('new-prompt-input');
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe('A tiny rover that avoids chairs'));
    fireEvent.click(screen.getByTestId('new-prompt-submit'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/p/p_draft1/workspace'));
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
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/p/p_again/workspace'));
    const all = JSON.parse(localStorage.getItem('rivet.projects.v1') ?? '[]') as unknown[];
    expect(all).toHaveLength(1);
    expect(getProject('p_again')?.prompt).toBe('new prompt');
  });
});

describe('Workspace', () => {
  function seed(id: string, extra: Partial<Parameters<typeof createProjectRecord>[0]> = {}) {
    saveProject(createProjectRecord({ id, prompt: 'Build a small rover that avoids obstacles', phase: 'clarify', ...extra }));
    nav.pathname = `/p/${id}/workspace`;
  }

  async function open(id: string) {
    return renderIn(
      <ProjectShell id={id}>
        <WorkspaceScreen />
      </ProjectShell>,
    );
  }

  it('goes straight from the prompt to a build, then asks about budget and size in the chat', async () => {
    seed('p_ws1');
    await open('p_ws1');
    // Three panels: the build guide and components, the model, the chat.
    expect(screen.getByTestId('workspace-left')).toBeTruthy();
    expect(screen.getByTestId('workspace-stage')).toBeTruthy();
    expect(screen.getByTestId('workspace-chat-prompt').textContent).toContain('Build a small rover that avoids obstacles');

    await screen.findByTestId('workspace-question-budget', {}, { timeout: 8000 });
    expect(startGeneration).toHaveBeenCalledTimes(1);
    expect(startGeneration.mock.calls[0][0]).toMatchObject({
      intent_id: 'intent-rover-001',
      input: { kind: 'text', image_asset_id: null, user_text: 'Build a small rover that avoids obstacles' },
      requirements: { max_budget: null, currency: 'USD', max_length_mm: null },
    });
    const project = getProject('p_ws1');
    expect(project?.phase).toBe('ready');
    expect(project?.buildId).toBeTruthy();
    // What Rivet read, honestly labelled offline, and what it built, read from the plan.
    expect(screen.getByTestId('workspace-chat-offline').textContent).toContain("isn't connected");
    expect(screen.getByTestId('workspace-chat-understood').textContent).not.toMatch(/board\.|esp32_|differential_drive/);
    expect(screen.getByTestId('workspace-chat-built').textContent).toMatch(/Picked \d+ parts/);
    // The Build tab starts with every step closed; later steps stay locked until reached.
    expect(screen.getByTestId('workspace-guide-buy-toggle').getAttribute('aria-expanded')).toBe('false');
    expect((screen.getByTestId('workspace-guide-build-toggle') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('workspace-guide-buy-toggle'));
    expect(screen.getByTestId('workspace-guide-buy-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(getProject('p_ws1')?.guideStarted).toBe(true);

    // A budget that changes the build starts a new run with it.
    await act(async () => {
      fireEvent.click(screen.getByTestId('workspace-answer-budget-50'));
    });
    expect(getProject('p_ws1')?.clarify.max_budget).toBe(50);
    await screen.findByTestId('workspace-question-size', {}, { timeout: 8000 });
    expect(startGeneration).toHaveBeenCalledTimes(2);
    expect(startGeneration.mock.calls[1][0]).toMatchObject({ requirements: { max_budget: 50 } });

    // A custom size needs a number before it can be set.
    fireEvent.click(screen.getByTestId('workspace-answer-size-custom'));
    expect((screen.getByTestId('workspace-answer-size-set') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('workspace-answer-size-amount'), { target: { value: '300' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('workspace-answer-size-set'));
    });
    await screen.findByTestId('workspace-chat-wrap', {}, { timeout: 8000 });
    expect(startGeneration).toHaveBeenCalledTimes(3);
    expect(startGeneration.mock.calls[2][0]).toMatchObject({ requirements: { max_budget: 50, max_length_mm: 300 } });
    expect(getProject('p_ws1')?.chat?.answered).toEqual({ budget: true, size: true });
  }, 20_000);

  it('an answer that changes nothing does not rebuild', async () => {
    seed('p_ws2');
    await open('p_ws2');
    await screen.findByTestId('workspace-question-budget', {}, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('workspace-answer-budget-none'));
    await screen.findByTestId('workspace-question-size', {}, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('workspace-answer-size-none'));
    await screen.findByTestId('workspace-chat-wrap', {}, { timeout: 8000 });
    expect(startGeneration).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('an idea Rivet cannot engineer builds a 3D model first, then asks what to use', async () => {
    unsupportedFamily = 'drone';
    seed('p_ws3');
    await open('p_ws3');
    await screen.findByTestId('workspace-question-use', {}, { timeout: 8000 });
    expect(screen.getByTestId('workspace-chat-limitation')).toBeTruthy();
    expect(startGeneration.mock.calls[0][0]).toMatchObject({ interpretation_choice: 'concept_model' });
    await act(async () => {
      fireEvent.click(screen.getByTestId('workspace-answer-rover'));
    });
    await screen.findByTestId('workspace-question-budget', {}, { timeout: 8000 });
    expect(startGeneration).toHaveBeenCalledTimes(2);
    expect(startGeneration.mock.calls[1][0]).toMatchObject({ interpretation_choice: 'closest_supported_rover' });
  }, 20_000);

  it('a toy car reading starts from the engineered rover', async () => {
    unsupportedFamily = 'rc_car';
    seed('p_ws4');
    await open('p_ws4');
    await screen.findByTestId('workspace-question-use', {}, { timeout: 8000 });
    expect(startGeneration.mock.calls[0][0]).toMatchObject({ interpretation_choice: 'closest_supported_rover' });
  }, 20_000);

  it('shows the engine error in the chat and on the stage, and Try again starts again', async () => {
    startOverride = () => Promise.reject(new Error('Engine offline'));
    seed('p_ws5');
    await open('p_ws5');
    const failed = await screen.findByTestId('workspace-chat-failed', {}, { timeout: 8000 });
    expect(failed.textContent).toContain('Engine offline');
    expect(screen.getByTestId('workspace-failed')).toBeTruthy();
    expect(screen.getByTestId('workspace-status').textContent).toBe('Stopped');
    expect(startGeneration).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByTestId('workspace-chat-retry'));
    });
    await waitFor(() => expect(startGeneration).toHaveBeenCalledTimes(2));
  }, 20_000);

  it('opens a ready project without generating, and picking a part shows it', async () => {
    seed('p_ws6', { phase: 'ready', exampleId: 'rivet-intent-rover-001', buildId: 'rivet-intent-rover-001' });
    await open('p_ws6');
    await screen.findByTestId('workspace-chat-wrap', {}, { timeout: 8000 });
    expect(startGeneration).not.toHaveBeenCalled();
    expect(screen.getByTestId('workspace-chat-built').textContent).toMatch(/Picked \d+ parts/);
    expect(screen.queryByTestId('workspace-question-budget')).toBeNull();
    // Build tab: step 1 Buy, step 2 Build. No review, parts or wiring steps.
    for (const gone of ['review', 'parts', 'wiring']) expect(screen.queryByTestId(`workspace-guide-${gone}`)).toBeNull();
    fireEvent.click(screen.getByTestId('workspace-guide-buy-toggle'));
    expect(screen.getByTestId('workspace-buy-total').textContent).toContain('$110.80');
    expect(screen.getByTestId('workspace-guide-buy-next').textContent).toBe('Continue to Build');
    // Ticking a part you own takes it off the total.
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(getProject('p_ws6')?.ownedCatalogIds).toHaveLength(1);
    expect(screen.getByTestId('workspace-buy-total').textContent).not.toContain('$110.80');
    fireEvent.click(screen.getByTestId('workspace-guide-buy-next'));
    expect(getProject('p_ws6')?.furthestStep).toBe('build');

    // Parts tab: every component, where to buy it, and the printed body to export.
    fireEvent.click(screen.getByTestId('workspace-tab-left-parts'));
    const parts = screen.getByTestId('workspace-parts');
    expect(parts.textContent).toContain('To buy');
    expect(parts.textContent).toContain('Printed body');
    fireEvent.click(screen.getByTestId('workspace-component-printed-body'));
    expect(screen.getByTestId('workspace-export-obj')).toBeTruthy();
    fireEvent.click(screen.getByTestId('workspace-component-board.esp32_devkitc_v4_wroom32e'));
    expect(screen.getByTestId('workspace-component-buy').textContent).toContain('Buy at Adafruit');
    const picked = await screen.findByTestId('workspace-picked', {}, { timeout: 4000 });
    expect(picked.textContent).toContain('ESP32');

    // Save build saves; Save and publish puts it in the community gallery.
    fireEvent.click(screen.getByTestId('workspace-save'));
    await waitFor(() => expect(getProject('p_ws6')?.savedAt).toBeTruthy());
    fireEvent.click(screen.getByTestId('workspace-publish'));
    fireEvent.change(await screen.findByTestId('publish-title'), { target: { value: 'Wall-dodging rover' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('publish-confirm'));
    });
    await waitFor(() => expect(getProject('p_ws6')).toMatchObject({ title: 'Wall-dodging rover', publishedAt: expect.any(String) }));
  }, 20_000);
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
    expect(card.textContent).toContain('Step 1 of 2 · Buy');
    fireEvent.click(screen.getByTestId('projects-menu-p_a'));
    fireEvent.click(screen.getByTestId('projects-delete'));
    await screen.findByTestId('projects-delete-modal');
    fireEvent.click(screen.getByTestId('projects-delete-confirm'));
    await waitFor(() => expect(getProject('p_a')).toBeNull());
  });
});

describe('wording', () => {
  it('describes where a project is and summarizes an intent without raw ids', () => {
    expect(whereIs(createProjectRecord({ prompt: 'x', phase: 'clarify' }))).toBe('Reading your idea');
    expect(whereIs(createProjectRecord({ prompt: 'x', phase: 'generating' }))).toBe('Building');
    expect(whereIs({ ...createProjectRecord({ prompt: 'x', phase: 'ready' }), furthestStep: 'done' })).toBe('Done');
    const s = summarizeIntent(getSyntheticRoverIntent());
    expect(s.headline).toBe('Rivet read this as an indoor rover that drives around and avoids obstacles.');
    expect(s.facts.join(' ')).toContain('two independently driven wheels and a forward distance sensor');
    expect(s.facts.join(' ')).not.toContain('board.esp32');
    expect(s.unknowns).toContain('Still unknown');
  });
});
