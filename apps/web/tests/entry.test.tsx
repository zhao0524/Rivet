import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../src/app/page';
import StudioPage from '../src/app/studio/page';
import { Studio } from '../src/components/studio';
import { SAMPLE_PROMPT } from '../src/components/studio/intake/BuildIntake';
import { FixtureSource } from '../src/lib/contracts';
import { isDevModeEnabled, readIntakeStart } from '../src/lib/dev-mode';

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
  vi.unstubAllEnvs();
});

async function renderAsync(ui: React.ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui);
  });
  return result;
}

describe('Landing page (#52)', () => {
  it('offers two one-click starts into the studio intake and does not render the studio', () => {
    const { container } = render(<HomePage />);
    expect(screen.getByTestId('home-page')).toBeDefined();
    expect(screen.getByTestId('home-start-upload').getAttribute('href')).toBe('/studio?start=upload');
    expect(screen.getByTestId('home-start-describe').getAttribute('href')).toBe('/studio?start=describe');
    expect(container.querySelector('[data-rivet="studio-shell"]')).toBeNull();
    expect(screen.queryByTestId('parts-panel')).toBeNull();
    expect(screen.queryByTestId('studio-inspector')).toBeNull();
  });

  it('renders exactly one 3D scene, labelled as a saved synthetic example', () => {
    render(<HomePage />);
    expect(screen.getAllByTestId('rover-scene')).toHaveLength(1);
    expect(screen.getByTestId('home-hero-stage').textContent).toContain('synthetic parts');
  });

  it('labels project families honestly and only links the supported one into the studio', () => {
    render(<HomePage />);
    expect(screen.getByTestId('family-badge-supported').textContent).toBe('Supported');
    expect(screen.getByTestId('family-badge-planned').textContent).toBe('Planned');
    expect(screen.getByTestId('family-badge-unsupported').textContent).toBe('Coming later');
    expect(within(screen.getByTestId('family-card-supported')).getByRole('link')).toBeDefined();
    expect(within(screen.getByTestId('family-card-planned')).queryByRole('link')).toBeNull();
    expect(within(screen.getByTestId('family-card-unsupported')).queryByRole('link')).toBeNull();
  });

  it('keeps the image disclosure in one sentence', () => {
    render(<HomePage />);
    expect(screen.getByText(/interpreted into a supported build, not reverse-engineered/)).toBeDefined();
  });
});

describe('/studio?start= opens the intake with the chosen input (#52)', () => {
  it('reads only the two supported starts', () => {
    expect(readIntakeStart({ start: 'upload' })).toBe('upload');
    expect(readIntakeStart({ start: 'describe' })).toBe('describe');
    expect(readIntakeStart({ start: 'other' })).toBeNull();
    expect(readIntakeStart({})).toBeNull();
  });

  it('describe: intake dialog is open with the prompt focused', async () => {
    await renderAsync(<StudioPage searchParams={{ start: 'describe' }} />);
    const dialog = screen.getByRole('dialog', { name: 'New build' });
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/what should it do/i));
  });

  it('upload: intake dialog is open with the image picker focused', async () => {
    await renderAsync(<StudioPage searchParams={{ start: 'upload' }} />);
    const dialog = screen.getByRole('dialog', { name: 'New build' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Choose image' }));
  });

  it('no start: studio opens without the intake', async () => {
    await renderAsync(<StudioPage searchParams={{}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Single intake flow (#53)', () => {
  const renderStudio = () => renderAsync(<Studio initialDataSource={new FixtureSource()} />);

  it('renders exactly one entry point for a new build', async () => {
    await renderStudio();
    const entries = screen
      .getAllByRole('button')
      .filter((b) => /new build|upload image|upload \/ prompt/i.test(b.textContent ?? ''));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.getAttribute('data-testid')).toBe('header-toggle-intake');
    expect(screen.queryByTestId('open-intake-button')).toBeNull();
  });

  it('opens as a modal outside the studio layout, so opening and closing never moves the studio', async () => {
    const { container } = await renderStudio();
    const shell = container.querySelector<HTMLElement>('[data-rivet="studio-shell"]')!;
    const before = Array.from(shell.children).map((el) => el.getAttribute('data-slot'));

    fireEvent.click(screen.getByTestId('header-toggle-intake'));
    const dialog = screen.getByRole('dialog', { name: 'New build' });
    expect(shell.contains(dialog)).toBe(false);
    expect(Array.from(shell.children).map((el) => el.getAttribute('data-slot'))).toEqual(before);
    expect(shell.querySelector('[data-slot="intake-overlay"]')).toBeNull();

    fireEvent.click(within(dialog).getByTestId('intake-dialog-close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(Array.from(shell.children).map((el) => el.getAttribute('data-slot'))).toEqual(before);
  });

  it('orders image, then prompt with a sample quick fill, then Generate; budget sits under Constraints', async () => {
    await renderStudio();
    fireEvent.click(screen.getByTestId('header-toggle-intake'));
    const dialog = screen.getByRole('dialog');
    const order = [
      within(dialog).getByRole('group', { name: /reference image/i }),
      within(dialog).getByLabelText(/what should it do/i),
      within(dialog).getByTestId('intake-constraints'),
      within(dialog).getByRole('button', { name: 'Review interpretation' }),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(dialog).getByTestId('intake-constraints').hasAttribute('open')).toBe(false);
    expect(within(within(dialog).getByTestId('intake-constraints')).getByLabelText(/max budget/i)).toBeDefined();

    fireEvent.click(within(dialog).getByTestId('intake-sample-prompt'));
    expect((within(dialog).getByLabelText(/what should it do/i) as HTMLTextAreaElement).value).toBe(SAMPLE_PROMPT);
  });

  it('shows saved examples as cards with a status badge and closes into the studio when one opens', async () => {
    await renderStudio();
    fireEvent.click(screen.getByTestId('header-toggle-intake'));
    const card = screen.getByTestId('saved-example-card-rivet-synthetic-rover-fixture');
    expect(card.textContent).toContain('Needs review');
    expect(card.textContent).toContain('not supplier verified');

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: /^Open / }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Developer controls (#54)', () => {
  it('default header: title and a plain-language status chip, no raw ids or data-source toggle', async () => {
    await renderAsync(<Studio initialDataSource={new FixtureSource()} />);
    expect(screen.getByTestId('studio-build-title').textContent).toBe('Synthetic starter rover (NOT SOURCED)');
    expect(screen.getByTestId('studio-status-chip').textContent).toBe('Needs review');
    expect(screen.queryByTestId('studio-build-identity')).toBeNull();
    expect(screen.queryByTestId('developer-menu')).toBeNull();
    expect(screen.queryByTestId('datasource-mode-fixture')).toBeNull();
    expect(screen.getByRole('banner').textContent).not.toContain('rivet-synthetic-rover-fixture');
  });

  it('shows revisions as "Revision N" without the build id', async () => {
    await renderAsync(<Studio initialDataSource={new FixtureSource()} />);
    const history = screen.getByTestId('revision-history');
    expect(history.textContent).not.toContain('rivet-synthetic-rover-fixture');
    expect(screen.getByTestId('revision-history-1').textContent).toMatch(/^Revision 1 · latest/);
  });

  it('?dev=1 shows the Developer menu with the data source switch and raw identity', async () => {
    await renderAsync(<StudioPage searchParams={{ dev: '1' }} />);
    expect(screen.getByTestId('studio-build-identity').textContent).toContain('rev 1');
    fireEvent.click(screen.getByTestId('developer-menu'));
    expect(screen.getByTestId('datasource-mode-fixture').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('datasource-mode-http').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('dev-toggle-stats')).toBeDefined();
  });

  it('dev mode turns on via ?dev=1 or NEXT_PUBLIC_RIVET_DEV_UI', () => {
    expect(isDevModeEnabled({})).toBe(false);
    expect(isDevModeEnabled({ dev: '1' })).toBe(true);
    expect(isDevModeEnabled(new URLSearchParams('dev=true'))).toBe(true);
    expect(isDevModeEnabled({ dev: '0' })).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_RIVET_DEV_UI', 'true');
    expect(isDevModeEnabled({})).toBe(true);
  });
});
