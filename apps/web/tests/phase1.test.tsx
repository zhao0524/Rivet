(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowProvider } from '../src/components/flow/FlowProvider';
import { ProjectShell } from '../src/components/flow/ProjectShell';
import { PartsStep } from '../src/components/steps/parts/PartsStep';
import { ReviewStep, reviewBlockers } from '../src/components/steps/review/ReviewStep';
import { WiringStep } from '../src/components/steps/wiring/WiringStep';
import { createProjectRecord, type ProjectRecord } from '../src/lib/flow/projects';
import { blockers, partRows } from '../src/lib/flow/derive';
import { SOURCED_ROVER_BUILD_ID, getConceptExamplePlan, getSourcedCatalog, getSourcedRoverPlan } from '../src/lib/fixtures';
import { FixtureSource } from '../src/lib/rivet';
import { useStudioPlanStore } from '../src/lib/plan-store';

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: '/p/p_test/review', search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// jsdom has no WebGL; keep the stage on its fallback path without the getContext noise.
vi.mock('../src/components/three/stage/webgl', () => ({
  detectWebGLSupport: () => true,
  resetWebGLSupportCache: () => undefined,
  prefersReducedMotion: () => false,
}));

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>();
  return {
    ...actual,
    Canvas: (props: { frameloop?: string }) => <div data-testid="r3f-canvas" data-frameloop={props.frameloop} />,
  };
});

const PROJECT_ID = 'p_test';

function seedProject(patch: Partial<ProjectRecord> = {}): ProjectRecord {
  const record = createProjectRecord({
    id: PROJECT_ID,
    prompt: 'A small indoor rover that avoids obstacles',
    phase: 'ready',
    exampleId: SOURCED_ROVER_BUILD_ID,
    buildId: SOURCED_ROVER_BUILD_ID,
    assumptions: ['Runs indoors on a flat floor'],
    ...patch,
  });
  const full = { ...record, furthestStep: 'build' as const, ...patch };
  window.localStorage.setItem('rivet.projects.v1', JSON.stringify([full]));
  return full;
}

/** The app's own store (offline fixtures) around the project shell, as in the (app) layout. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <FlowProvider>
      <ProjectShell id={PROJECT_ID}>{children}</ProjectShell>
    </FlowProvider>
  );
}

/** FlowProvider with a store bound to a custom fixture source (for plans the saved rovers do not have). */
function CustomShell({ children, source }: { children: React.ReactNode; source: FixtureSource }) {
  const store = useStudioPlanStore({ initialDataSource: source });
  return (
    <FlowProvider store={store}>
      <ProjectShell id={PROJECT_ID}>{children}</ProjectShell>
    </FlowProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  nav.push.mockReset();
  nav.pathname = `/p/${PROJECT_ID}/review`;
  nav.search = '';
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

describe('Review', () => {
  it('shows recovery actions when a saved project refers to an unavailable build', async () => {
    seedProject({ exampleId: null, buildId: 'missing-build' });
    render(<Shell><ReviewStep /></Shell>);
    const error = await screen.findByTestId('project-load-error');
    expect(within(error).getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(within(error).getByRole('link', { name: 'Back to projects' }).getAttribute('href')).toBe('/projects');
    expect(screen.queryByTestId('review-primary')).toBeNull();
  });
  it('keeps unknown fit checks visible and offers inspection for the saved example', async () => {
    seedProject();
    render(
      <Shell>
        <ReviewStep />
      </Shell>,
    );
    const plan = getSourcedRoverPlan();
    const expected = blockers(plan);
    expect(expected.length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getAllByTestId('review-blocker')).toHaveLength(expected.length));
    const cards = screen.getAllByTestId('review-blocker');
    for (const card of cards) {
      expect(within(card).queryByTestId('review-fix')).toBeNull();
      expect(within(card).getByTestId('review-inspect')).toBeDefined();
      expect(within(card).getByText('Needs verification')).toBeDefined();
    }
    // Advisory warnings (e.g. motor brown-out) never appear on Review.
    expect(screen.queryByText(/brown-out/)).toBeNull();
    // The TT motor fit finding leads with a plain headline naming the part; the engine's message stays as detail.
    expect(screen.getByText('The left motor may not fit the frame')).toBeDefined();
    expect(screen.getByText('The right motor may not fit the frame')).toBeDefined();
    for (const f of expected) expect(screen.getAllByText(f.message, { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Fit evidence')).toBeNull();
    expect(screen.getAllByText('learn.sparkfun.com').length).toBe(2);
    // CTA stays enabled but says what is unresolved.
    const cta = screen.getByTestId('review-primary');
    expect(cta.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText(/2 problems are still open/)).toBeDefined();
    // Offline honesty, in plain words.
    expect(screen.getByTestId('review-saved-note').textContent).toContain("Rivet didn't design it from your words");
  });

  it('with no blockers, confirms it in one line and the CTA is the only action', async () => {
    const plan = getSourcedRoverPlan();
    plan.verification.findings = plan.verification.findings.filter((f) => f.result === 'PASS');
    seedProject();
    const source = new FixtureSource({ catalog: getSourcedCatalog(), plans: [plan], defaultBuildId: plan.build_id });
    render(
      <CustomShell source={source}>
        <ReviewStep />
      </CustomShell>,
    );
    await waitFor(() => expect(screen.getByTestId('review-empty')).toBeDefined());
    expect(screen.queryAllByTestId('review-blocker')).toHaveLength(0);
    expect(screen.queryByText(/still open/)).toBeNull();
    fireEvent.click(screen.getByTestId('review-primary'));
    expect(nav.push).toHaveBeenCalledWith(`/p/${PROJECT_ID}/parts`);
    const saved = JSON.parse(window.localStorage.getItem('rivet.projects.v1')!)[0] as ProjectRecord;
    expect(saved.reviewDone).toBe(true);
  });

  it('a component without a catalog entry becomes a "Needs a part" blocker', () => {
    const plan = getSourcedRoverPlan();
    const catalog = getSourcedCatalog().filter((c) => c.catalog_id !== plan.components[1]!.catalog_id);
    const list = reviewBlockers(plan, catalog);
    expect(list.some((b) => b.kind === 'needs-part' && b.finding.rule_id === 'parts.missing_catalog_entry')).toBe(true);
  });

  it('sends the saved example to its real part details instead of offering a doomed edit', async () => {
    seedProject();
    render(
      <Shell>
        <ReviewStep />
      </Shell>,
    );
    await waitFor(() => expect(screen.getAllByTestId('review-blocker').length).toBeGreaterThan(0));
    const [first] = screen.getAllByTestId('review-blocker');
    const link = within(first!).getByTestId('review-inspect');
    expect(link.getAttribute('href')).toBe(`/p/${PROJECT_ID}/parts?part=motor-left-1`);
    // The card is still there with its one button.
    expect(screen.getAllByTestId('review-blocker').length).toBe(2);
    expect(within(first!).queryByTestId('review-fix')).toBeNull();
  });

  it('shows a concept model as a 3D view with what it is, not as an unfixable blocker', async () => {
    const concept = getConceptExamplePlan();
    seedProject({ exampleId: concept.build_id, buildId: concept.build_id, prompt: 'A camera drone' });
    render(
      <Shell>
        <ReviewStep />
      </Shell>,
    );
    await waitFor(() => expect(screen.getByTestId('review-concept')).toBeDefined());
    expect(screen.getByText('3D model of a quadcopter drone')).toBeDefined();
    expect(screen.getByTestId('review-viewport')).toBeDefined();
    expect(screen.queryAllByTestId('review-blocker')).toHaveLength(0);
    expect(screen.queryByText(/unresolved/)).toBeNull();
    // The example has inferred internal parts, so the X-ray toggle is offered.
    const xray = screen.getByTestId('review-xray');
    expect(xray.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(xray);
    expect(xray.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('review-primary'));
    expect(nav.push).toHaveBeenCalledWith(`/p/${PROJECT_ID}/parts`);
  });
});

describe('Concept models in later steps', () => {
  it('Wiring lists the inferred wires and offers no simulation or firmware', async () => {
    const concept = getConceptExamplePlan();
    seedProject({ exampleId: concept.build_id, buildId: concept.build_id, prompt: 'A camera drone' });
    render(
      <Shell>
        <WiringStep />
      </Shell>,
    );
    await waitFor(() => expect(screen.getByTestId('wiring-concept')).toBeDefined());
    const wires = concept.components.filter((c) => c.role === 'wire');
    expect(within(screen.getByTestId('wiring-concept-list')).getAllByRole('listitem')).toHaveLength(wires.length);
    expect(screen.getByText(/Battery → Power distribution board/)).toBeDefined();
    expect(screen.queryByTestId('wiring-open-sim')).toBeNull();
    fireEvent.click(screen.getByTestId('wiring-tab-firmware'));
    expect(screen.getByTestId('firmware-concept')).toBeDefined();
  });
});

describe('Parts', () => {
  it('renders grouped rows and opens the spec drawer with source tags and honest gaps', async () => {
    seedProject();
    nav.pathname = `/p/${PROJECT_ID}/parts`;
    render(
      <Shell>
        <PartsStep />
      </Shell>,
    );
    await waitFor(() => expect(screen.getByTestId('parts-group-frame')).toBeDefined());
    expect(screen.getByTestId('parts-group-drive')).toBeDefined();
    expect(screen.getByTestId('parts-group-control')).toBeDefined();
    // Hidden accessories (jumper wires, batteries) are not placed parts, so they do not get rows.
    const plan = getSourcedRoverPlan();
    const visible = partRows(plan, getSourcedCatalog());
    expect(screen.getAllByTestId(/^parts-row-/).length).toBe(visible.length);
    // The count says where those accessories went, so Parts, Buy and Done do not look like they disagree.
    const hidden = plan.components.length - visible.length;
    expect(hidden).toBeGreaterThan(0);
    expect(screen.getByTestId('parts-hidden-note').textContent).toContain(`plus ${hidden} small items`);
    expect(screen.getByTestId('parts-hidden-note').textContent).toContain('listed in Buy');
    // Every sourced part is a procedural shape, so every row says so.
    expect(screen.getAllByText(/Simple 3D shape/).length).toBe(visible.length);
    // Plain group names, and the source-tag legend.
    expect(screen.getByTestId('parts-group-drive').textContent).toContain('Wheels & motors');
    expect(screen.getByTestId('parts-group-control').textContent).toContain('Brains');
    expect(screen.getByTestId('spec-legend').textContent).toContain('AI estimate');

    fireEvent.click(screen.getByTestId('parts-row-controller-1'));
    const drawer = await screen.findByTestId('spec-drawer');
    expect(within(drawer).getAllByTestId('spec-source').length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText('Not in datasheet').length).toBeGreaterThan(0);
    expect(within(drawer).getByTestId('spec-datasheet')).toBeDefined();
    expect(within(drawer).queryByText(/Swap/)).toBeNull();
    expect(within(drawer).getByText(/Checked /)).toBeDefined();
    // The out-of-stock warning shows in the drawer, not as a banner on the page.
    expect(within(drawer).getByTestId('spec-warnings')).toBeDefined();
    fireEvent.click(within(drawer).getByTestId('spec-close'));
    await waitFor(() => expect(screen.queryByTestId('spec-drawer')).toBeNull());
  });

  it('honors ?part= by preselecting the row and opening its drawer', async () => {
    seedProject();
    nav.pathname = `/p/${PROJECT_ID}/parts`;
    nav.search = 'part=motor-left-1';
    render(
      <Shell>
        <PartsStep />
      </Shell>,
    );
    const drawer = await screen.findByTestId('spec-drawer');
    expect(within(drawer).getByText(/TT Motor/i)).toBeDefined();
    expect(screen.getByTestId('parts-row-motor-left-1').getAttribute('aria-current')).toBe('true');
  });
});

describe('Wiring & code', () => {
  it('lists connections, switches tabs, and disables the download with a reason offline', async () => {
    seedProject();
    nav.pathname = `/p/${PROJECT_ID}/wiring`;
    render(
      <Shell>
        <WiringStep />
      </Shell>,
    );
    await waitFor(() => expect(screen.getByTestId('wiring-list')).toBeDefined());
    const plan = getSourcedRoverPlan();
    const electrical = plan.connections.filter((c) => c.kind === 'electrical').length;
    expect(screen.getAllByTestId(/^wiring-row-/).length).toBe(electrical);
    expect(screen.getAllByText('Wire positions are approximate').length).toBeGreaterThan(0);
    // Rows lead with what the wire does; pin names sit in the secondary line.
    expect(screen.getByTestId('wiring-row-wire-motor-left-pwm').textContent).toContain('how fast to spin the left motor');
    expect(screen.getByTestId('wiring-row-wire-motor-left-pwm').textContent).toContain('gpio25');
    expect(screen.getByTestId('wiring-row-wire-i2c-sda').textContent).toContain('Reads distance from the distance sensor');

    fireEvent.click(screen.getByTestId('wiring-tab-firmware'));
    expect(screen.getByTestId('wiring-tab-firmware').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('firmware-pinmap')).toBeDefined();
    expect(screen.getByText('i2c_sda')).toBeDefined();
    expect(screen.getByTestId('firmware-pin-motor_left_pwm').textContent).toContain('Left motor speed');
    expect(screen.getByTestId('firmware-compile-status').textContent).toMatch(/Not checked yet/);
    expect(screen.getByTestId('firmware-details').textContent).toContain(plan.firmware.target);
    const download = screen.getByTestId('firmware-download');
    expect(download.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('firmware-download-reason').textContent).toMatch(/live engine/);
    expect(screen.getByTestId('wiring-primary').hasAttribute('disabled')).toBe(false);
  });

  it('opens the simulation modal with an Approximate label and a Run CTA', async () => {
    seedProject();
    nav.pathname = `/p/${PROJECT_ID}/wiring`;
    render(
      <Shell>
        <WiringStep />
      </Shell>,
    );
    await waitFor(() => expect(screen.getByTestId('wiring-open-sim').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('wiring-open-sim'));
    const modal = await screen.findByTestId('sim-modal');
    expect(within(modal).getByTestId('sim-approximate')).toBeDefined();
    expect(within(modal).getByTestId('sim-limits')).toBeDefined();
    // Before the first Run the stage says what it is waiting for instead of sitting empty.
    expect(within(modal).getByTestId('sim-idle').textContent).toMatch(/Press Run/);
    fireEvent.click(within(modal).getByTestId('sim-run'));
    expect(await within(modal).findByTestId('sim-view-container')).toBeDefined();
    expect(within(modal).queryByTestId('sim-idle')).toBeNull();
  });
});
