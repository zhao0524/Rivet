import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowProvider } from '../src/components/flow/FlowProvider';
import { NewProjectScreen } from '../src/components/start/NewProjectScreen';
import { ProjectsScreen } from '../src/components/start/ProjectsScreen';
import { createProjectRecord, readDraft, saveProject } from '../src/lib/flow/projects';
import { SAMPLE_PROJECTS, sampleOpenedAt, thumbnailFor } from '../src/lib/flow/samples';
import { useStudioPlanStore } from '../src/lib/plan-store';

const nav = { push: vi.fn(), replace: vi.fn(), search: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/new',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

function Flow({ children }: { children: React.ReactNode }) {
  const store = useStudioPlanStore();
  return <FlowProvider store={store}>{children}</FlowProvider>;
}

async function renderIn(ui: React.ReactElement) {
  await act(async () => {
    render(<Flow>{ui}</Flow>);
  });
}

beforeEach(() => {
  localStorage.clear();
  nav.push.mockReset();
  nav.search = '';
});
afterEach(cleanup);

function seed() {
  const older = { ...createProjectRecord({ id: 'p_old', prompt: 'An older rover', title: 'Older rover', phase: 'clarify' }), updatedAt: new Date(Date.now() - 86_400_000).toISOString() };
  const newer = { ...createProjectRecord({ id: 'p_new', prompt: 'Build a small rover', title: 'Newer rover', phase: 'ready', buildId: 'b' }), furthestStep: 'parts' as const };
  saveProject(older);
  saveProject(newer);
}

describe('/new recent projects gallery', () => {
  it("lists the user's projects newest first, then the samples", async () => {
    seed();
    await renderIn(<NewProjectScreen />);
    const list = await screen.findByTestId('new-gallery-list');
    await waitFor(() => expect(list.querySelectorAll('li[data-kind]').length).toBe(2 + SAMPLE_PROJECTS.length));
    const kinds = Array.from(list.querySelectorAll('li[data-kind]')).map((li) => li.getAttribute('data-kind'));
    expect(kinds.slice(0, 2)).toEqual(['project', 'project']);
    expect(kinds.slice(2).every((k) => k === 'sample')).toBe(true);
    const items = within(list).getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Newer rover');
    expect(items[0]!.textContent).toContain('Step 1 of 2');
    expect(items[1]!.textContent).toContain('Older rover');
  });

  it('lists published builds under Community builds, tagged Published', async () => {
    saveProject({ ...createProjectRecord({ id: 'p_pub', prompt: 'x', title: 'Wall-dodging rover', phase: 'ready' }), publishedAt: new Date().toISOString() });
    saveProject(createProjectRecord({ id: 'p_private', prompt: 'y', title: 'Private rover', phase: 'ready' }));
    await renderIn(<NewProjectScreen />);
    const community = await screen.findByTestId('new-community-list');
    expect(community.textContent).toContain('Wall-dodging rover');
    expect(community.textContent).toContain('Published');
    expect(community.textContent).not.toContain('Private rover');
  });

  it('tags every sample, and only samples, with "Sample"', async () => {
    seed();
    await renderIn(<NewProjectScreen />);
    for (const s of SAMPLE_PROJECTS) {
      const card = await screen.findByTestId(`new-sample-card-${s.id}`);
      expect(within(card).getByText('Sample')).toBeTruthy();
    }
    expect(within(screen.getByTestId('new-card-p_new')).queryByText('Sample')).toBeNull();
  });

  it('the rover sample opens the saved example as a ready project in its workspace', async () => {
    await renderIn(<NewProjectScreen />);
    fireEvent.click(await screen.findByTestId('new-sample-example'));
    const all = JSON.parse(localStorage.getItem('rivet.projects.v1') ?? '[]') as Array<Record<string, unknown>>;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ exampleId: 'rivet-intent-rover-001', buildId: 'rivet-intent-rover-001', phase: 'ready' });
    expect(nav.push).toHaveBeenCalledWith(`/p/${all[0]!.id}/workspace`);
  });

  it('a non-rover sample fills the prompt and focuses it, without creating a project', async () => {
    await renderIn(<NewProjectScreen />);
    const drone = SAMPLE_PROJECTS.find((s) => s.id === 'quadcopter')!;
    const card = await screen.findByTestId('new-sample-card-quadcopter');
    expect(card.textContent).toContain('Drones are coming later. Rivet will build the closest rover.');
    await act(async () => {
      fireEvent.click(within(card).getByRole('button'));
    });
    await waitFor(() => expect((screen.getByTestId('new-prompt-input') as HTMLTextAreaElement).value).toBe(drone.prompt));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('new-prompt-input')));
    expect(readDraft()?.text).toBe(drone.prompt);
    expect(localStorage.getItem('rivet.projects.v1')).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByTestId('new-status').textContent).toContain('Quadcopter drone');
  });

  it('cards are focusable links or buttons with accessible names', async () => {
    seed();
    await renderIn(<NewProjectScreen />);
    await screen.findByTestId('new-card-p_new');
    expect(screen.getByRole('link', { name: 'Open Newer rover' }).getAttribute('href')).toBe('/p/p_new');
    expect(screen.getByRole('button', { name: 'Open the sample Obstacle-avoiding rover' })).toBeTruthy();
    for (const s of SAMPLE_PROJECTS.filter((x) => x.action.kind === 'prefill')) {
      const btn = screen.getByRole('button', { name: `Start from this idea: ${s.title}` });
      act(() => btn.focus());
      expect(document.activeElement).toBe(btn);
    }
  });
});

describe('/projects uses the same cards', () => {
  it('renders Edge-light cards with the overflow menu outside the link', async () => {
    seed();
    await renderIn(<ProjectsScreen />);
    const card = await screen.findByTestId('projects-card-p_new');
    expect(card.classList.contains('elc')).toBe(true);
    const link = within(card).getByRole('link', { name: 'Open Newer rover' });
    const menu = screen.getByTestId('projects-menu-p_new');
    expect(link.contains(menu)).toBe(false);
    // newest first
    const ids = Array.from(screen.getByTestId('projects-list').querySelectorAll('[data-testid^="projects-card-"]')).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['projects-card-p_new', 'projects-card-p_old']);
  });
});

describe('samples data', () => {
  it('has one buildable rover; the rest say what Rivet will do instead', () => {
    const examples = SAMPLE_PROJECTS.filter((s) => s.action.kind === 'example');
    expect(examples.map((s) => s.family)).toEqual(['rover']);
    for (const s of SAMPLE_PROJECTS.filter((x) => x.action.kind === 'prefill')) expect(s.note).toContain('closest rover');
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(sampleOpenedAt({ openedHoursAgo: 48 }, now)).toBe('2026-10-22T12:00:00.000Z');
    expect(thumbnailFor({ prompt: 'a drone', phase: 'ready', buildId: 'x', exampleId: null })).toBe('/projects/obstacle-rover.webp');
    expect(thumbnailFor({ prompt: 'a quadcopter drone', phase: 'clarify', buildId: null, exampleId: null })).toBe('/projects/quadcopter.webp');
    expect(thumbnailFor({ prompt: '', phase: 'ready', buildId: 'x', exampleId: null, imagePreviewUrl: '/api/assets/a1/preview' })).toBe('/api/assets/a1/preview');
    // A project started from a featured community build shows that build's card, built or not.
    expect(thumbnailFor({ prompt: 'A camera on a pan-tilt mount that can turn to look around the room', phase: 'ready', buildId: 'x', exampleId: null })).toBe('/projects/camera-turret.webp');
    expect(thumbnailFor({ prompt: 'a desk robot arm with a gripper that can pick up small blocks.', phase: 'ready', buildId: 'x', exampleId: null })).toBe('/projects/robot-arm.webp');
    expect(thumbnailFor({ prompt: '', phase: 'ready', buildId: 'x', exampleId: null, imageThumbnail: 'data:image/jpeg;base64,AA', imagePreviewUrl: '/api/assets/a1/preview' })).toBe('data:image/jpeg;base64,AA');
  });
});
