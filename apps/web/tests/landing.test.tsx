import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../src/app/page';
import { listProjects, readAccount, saveAccount } from '../src/lib/flow/projects';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>();
  return {
    ...actual,
    Canvas: (props: { frameloop?: string }) => <div data-testid="r3f-canvas" data-frameloop={props.frameloop} />,
  };
});

beforeEach(() => {
  push.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function typePrompt(text: string) {
  fireEvent.change(screen.getByTestId('home-prompt-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('home-prompt-submit'));
}

describe('Landing page (M1, Guest preview, M2)', () => {
  it('renders the shared PromptBox in the hero: plain example prompts, a picture upload and "Build it"', () => {
    render(<HomePage />);
    expect(screen.getByTestId('home-page')).toBeDefined();
    expect(screen.getByTestId('home-prompt')).toBeDefined();
    expect(screen.getByTestId('home-prompt-submit').textContent).toContain('Build it');
    const examples = within(screen.getByRole('group', { name: 'Example prompts' })).getAllByRole('button');
    expect(examples).toHaveLength(2);
    for (const b of examples) expect(b.textContent).not.toMatch(/beginner|intermediate|advanced/i);
    fireEvent.click(examples[1]!);
    expect((screen.getByTestId('home-prompt-input') as HTMLTextAreaElement).value).toBe('Help me build a drone from scratch');
    expect(screen.getByTestId('home-prompt-upload').textContent).toContain('Upload a picture');
    expect(screen.queryByText(/No prompt in mind/)).toBeNull();
    expect(screen.getByText('Built at SOON')).toBeDefined();
    const nav = screen.getByTestId('open-studio-link');
    expect(nav.getAttribute('href')).toBe('/new');
    expect(screen.getByTestId('theme-toggle')).toBeDefined();
  });

  it('Build it opens the guest preview, Save and continue opens M2, email continues to /new?draft=<id>', async () => {
    render(<HomePage />);
    typePrompt('A desk rover that stops before a wall');

    const preview = await screen.findByTestId('guest-preview');
    expect(preview.textContent).toContain('A desk rover that stops before a wall');
    expect(preview.textContent).toContain('Rover · supported today');
    expect(preview.textContent).toContain('Parts list');
    expect(preview.textContent).toContain('Wiring');
    expect(preview.textContent).toContain('Starter code');
    expect(preview.textContent).toContain('Step-by-step build');
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('preview-continue'));
    const save = await screen.findByTestId('save-modal');
    expect(save.textContent).toMatch(/saved in this browser/i);
    expect(save.textContent).toMatch(/not live yet/i);

    // Invalid email shows an inline error and does not navigate.
    fireEvent.change(screen.getByTestId('save-email'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('save-continue-email'));
    expect(screen.getByRole('alert').textContent).toMatch(/email/i);
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('save-email'), { target: { value: 'becca@umich.edu' } });
    fireEvent.click(screen.getByTestId('save-continue-email'));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const href = push.mock.calls[0]![0] as string;
    expect(href).toMatch(/^\/new\?draft=p_[a-z0-9]+$/);
    const draft = JSON.parse(window.localStorage.getItem('rivet.draft.v1')!) as { id: string; text: string };
    expect(href).toBe(`/new?draft=${draft.id}`);
    expect(draft.text).toBe('A desk rover that stops before a wall');
    expect(readAccount()).toMatchObject({ email: 'becca@umich.edu', provider: 'email' });
  });

  it('Continue with Google stores a google account and continues', async () => {
    render(<HomePage />);
    typePrompt('Rover');
    fireEvent.click(await screen.findByTestId('preview-continue'));
    fireEvent.click(await screen.findByTestId('save-continue-google'));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(readAccount()).toMatchObject({ email: 'Google account', provider: 'google' });
  });

  it('skips M2 when a local account already exists', async () => {
    saveAccount({ email: 'x@y.z', provider: 'email', savedAt: new Date().toISOString() });
    render(<HomePage />);
    typePrompt('Rover');
    fireEvent.click(await screen.findByTestId('preview-continue'));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0]![0]).toMatch(/^\/new\?draft=/);
    expect(screen.queryByTestId('save-modal')).toBeNull();
  });

  it('See an example saves a ready example project and opens its review step', () => {
    render(<HomePage />);
    fireEvent.click(screen.getByTestId('home-see-example'));
    const projects = listProjects();
    expect(projects).toHaveLength(1);
    const p = projects[0]!;
    expect(p).toMatchObject({
      phase: 'ready',
      exampleId: 'rivet-intent-rover-001',
      buildId: 'rivet-intent-rover-001',
      title: 'Indoor obstacle rover (example)',
    });
    expect(push).toHaveBeenCalledWith(`/p/${p.id}/review`);
  });

  it('shows one 3D scene in the scroll demo, with a six-step build overview', () => {
    render(<HomePage />);
    const section = screen.getByTestId('home-assembly-scroll');
    expect(screen.getByTestId('home-hero-stage')).toBeDefined();
    expect(section.querySelectorAll('[data-testid="rover-scene"]')).toHaveLength(1);
    expect(section.querySelectorAll('.mk-build__step')).toHaveLength(6);
  });

  it('shows three gallery samples, each tagged and honest about what Rivet builds', () => {
    render(<HomePage />);
    const ids = ['obstacle-rover', 'quadcopter', 'electric-car'];
    for (const id of ids) {
      const card = screen.getByTestId(`showcase-sample-${id}`);
      expect(card.textContent).toContain('Sample');
      expect(card.querySelector('button')).not.toBeNull();
    }
    expect(screen.getByTestId('showcase-sample-obstacle-rover').textContent).toContain('Opens a finished example');
    expect(screen.getByTestId('showcase-sample-quadcopter').textContent).toContain('Rivet will build the closest rover.');
  });

  it('shows the 3D workspace on the review card and the real parts list on the bench card', () => {
    const { container } = render(<HomePage />);
    const [review, bench] = Array.from(container.querySelectorAll('.mk-path'));
    expect(review!.querySelector('[data-testid="home-workspace"]')).not.toBeNull();
    expect(review!.querySelector('.mk-path__list')).toBeNull();
    const parts = bench!.querySelector('.mk-ticker')!;
    expect(parts.textContent).toContain('$110.80');
    expect(parts.textContent).toContain('SparkFun');
    expect(parts.textContent).toContain('$15.00');
    expect(container.textContent).not.toContain('Saved examples open instantly');
  });

  it('puts the build-today copy above the three samples', () => {
    const { container } = render(<HomePage />);
    const head = container.querySelector('#families .mk-showcase__head')!;
    const grid = container.querySelector('#families .mk-showcase__grid')!;
    expect(head.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no longer links to the retired /studio route', () => {
    const { container } = render(<HomePage />);
    const studio = Array.from(container.querySelectorAll('a[href]')).filter((a) =>
      a.getAttribute('href')!.startsWith('/studio'),
    );
    expect(studio).toHaveLength(0);
  });

  it('reads in plain words: no schema terms or unexplained acronyms in the copy', () => {
    const { container } = render(<HomePage />);
    const text = container.textContent ?? '';
    for (const word of [/\bBOM\b/, /schema/i, /\brevision/i, /fixture/i, /synthetic/i, /verification/i, /differential/i, /kinematic/i]) {
      expect(text).not.toMatch(word);
    }
    // ESP32 always comes with a plain gloss.
    expect(text).toContain('ESP32 controller board');
  });
});
