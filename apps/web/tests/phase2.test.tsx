import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowProvider } from '../src/components/flow/FlowProvider';
import { ProjectShell } from '../src/components/flow/ProjectShell';
import { BuildStep } from '../src/components/steps/build/BuildStep';
import { firmwareStep, needsSafetyAck, stepParts } from '../src/components/steps/build/build-model';
import { BuyStep } from '../src/components/steps/buy/BuyStep';
import { buyTotals, groupByVendor, NO_VENDOR } from '../src/components/steps/buy/buy-model';
import { DoneStep } from '../src/components/steps/done/DoneStep';
import { getConceptExamplePlan, getSourcedCatalog, getSourcedRoverPlan, SOURCED_ROVER_BUILD_ID } from '../src/lib/fixtures';
import { buyLines, type BuyLine } from '../src/lib/flow/derive';
import { createProjectRecord, getProject, type ProjectRecord } from '../src/lib/flow/projects';
import { FixtureSource } from '../src/lib/rivet';

const push = vi.fn();
let pathname = '/p/p1/buy';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>();
  return {
    ...actual,
    Canvas: (props: { frameloop?: string }) => <div data-testid="r3f-canvas" data-frameloop={props.frameloop} />,
  };
});

const PROJECT_ID = 'p1';

function seed(patch: Partial<ProjectRecord> = {}) {
  const record = createProjectRecord({
    id: PROJECT_ID,
    prompt: 'A small rover that avoids obstacles',
    phase: 'ready',
    exampleId: SOURCED_ROVER_BUILD_ID,
    buildId: SOURCED_ROVER_BUILD_ID,
  });
  const full: ProjectRecord = { ...record, furthestStep: 'build', ...patch };
  window.localStorage.setItem('rivet.projects.v1', JSON.stringify([full]));
  return full;
}

async function renderStep(step: 'buy' | 'build' | 'done', children: ReactNode) {
  pathname = `/p/${PROJECT_ID}/${step}`;
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <FlowProvider>
        <ProjectShell id={PROJECT_ID}>{children}</ProjectShell>
      </FlowProvider>,
    );
  });
  return result;
}

const plan = getSourcedRoverPlan();
const catalog = getSourcedCatalog();
const lines = buyLines(plan, catalog);
const POWER_BANK = 'power.adafruit_usb_power_bank_5000_4288';

beforeEach(() => {
  window.localStorage.clear();
  push.mockReset();
  // jsdom has no WebGL; the stage probes for it on mount and logs otherwise.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  cleanup();
});

describe('Buy model', () => {
  it('excludes owned parts and reports unknown prices instead of counting them as zero', () => {
    const sample: BuyLine[] = [
      { ...lines[0]!, catalogId: 'a', unitPrice: 10, quantity: 2 },
      { ...lines[0]!, catalogId: 'b', unitPrice: null, quantity: 1 },
      { ...lines[0]!, catalogId: 'c', unitPrice: 5, quantity: 1 },
    ];
    expect(buyTotals(sample, [])).toEqual({ total: 25, unknownPriceCount: 1, toBuy: 3, owned: 0 });
    expect(buyTotals(sample, ['c'])).toEqual({ total: 20, unknownPriceCount: 1, toBuy: 2, owned: 1 });
    // Owning the unknown-price part removes it from the unknown count too.
    expect(buyTotals(sample, ['b']).unknownPriceCount).toBe(0);
  });

  it('groups lines without a verified listing under "No verified vendor", last', () => {
    const groups = groupByVendor(lines, []);
    expect(groups[groups.length - 1]!.vendor).toBe(NO_VENDOR);
    expect(groups[groups.length - 1]!.lines.map((l) => l.catalogId)).toEqual(['caster.sparkfun_shadow_nub']);
    expect(groups.slice(0, -1).every((g) => g.lines.every((l) => l.url))).toBe(true);
  });
});

describe('Step 4 Buy', () => {
  it('shows the total from known prices and drops owned parts out of it', async () => {
    seed();
    await renderStep('buy', <BuyStep />);
    const total = await screen.findByTestId('buy-total-amount', {}, { timeout: 8000 });
    expect(total.textContent).toBe('$110.80');
    expect(screen.queryByTestId('buy-unknown-prices')).toBeNull();

    fireEvent.click(screen.getByTestId('buy-vendor-Adafruit').querySelector('button')!);
    fireEvent.click(screen.getByTestId(`buy-own-${POWER_BANK}`));
    await waitFor(() => expect(screen.getByTestId('buy-total-amount').textContent).toBe('$83.85'));
    expect(getProject(PROJECT_ID)?.ownedCatalogIds).toEqual([POWER_BANK]);
    expect(screen.getByTestId('buy-primary').textContent).toBe('Open cart');
  });

  it('turns the CTA into "Start building" once everything is owned', async () => {
    seed({ ownedCatalogIds: lines.map((l) => l.catalogId) });
    await renderStep('buy', <BuyStep />);
    const cta = await screen.findByTestId('buy-primary', {}, { timeout: 8000 });
    await waitFor(() => expect(cta.textContent).toBe('Start building'));
    expect(screen.getByTestId('buy-total-amount').textContent).toBe('$0.00');
    fireEvent.click(cta);
    expect(push).toHaveBeenCalledWith('/p/p1/build');
  });

  it('opens a cart that links only verified product pages and names the rest', async () => {
    seed();
    await renderStep('buy', <BuyStep />);
    await screen.findByTestId('buy-vendors', {}, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('buy-primary'));
    const dialog = await screen.findByTestId('buy-cart');
    const links = within(dialog).getAllByRole('link');
    const verified = lines.filter((l) => l.url);
    expect(links).toHaveLength(verified.length);
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\//);
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(within(dialog).getByTestId('buy-cart-no-vendor').textContent).toContain('nub caster');
    expect(within(dialog).queryByText(/Open all/)).toBeNull();
    fireEvent.click(within(dialog).getByTestId('buy-cart-continue'));
    expect(push).toHaveBeenCalledWith('/p/p1/build');
  });

  it('lists out-of-stock parts without inventing an alternative', async () => {
    seed();
    await renderStep('buy', <BuyStep />);
    const oos = await screen.findByTestId('buy-out-of-stock', {}, { timeout: 8000 });
    expect(oos.textContent).toContain('ESP32-DevKitC');
    expect(oos.textContent).toContain('No in-stock alternative found yet');
  });
});

describe('Step 4 Buy for a concept model', () => {
  it('lists the suggested real parts with a badge and leaves body shapes out', async () => {
    const concept = getConceptExamplePlan();
    seed({ exampleId: concept.build_id, buildId: concept.build_id });
    await renderStep('buy', <BuyStep />);
    await screen.findByTestId('buy-suggested-notice', {}, { timeout: 8000 });
    const group = screen.getByTestId('buy-vendor-RaceDayQuads');
    fireEvent.click(group.querySelector('button')!);
    expect(within(group).getByTestId('buy-suggested-concept.flight-controller')).toBeDefined();
    expect(within(group).getByTestId('buy-line-link-concept.flight-controller').getAttribute('href')).toMatch(/^https:\/\/www\.racedayquads\.com\//);
    expect(screen.queryByTestId('buy-line-concept.body')).toBeNull();
    expect(screen.queryByTestId(`buy-vendor-${NO_VENDOR}`)).toBeNull();
  });
});

describe('Build model', () => {
  it('places the firmware card at the first step that mounts the controller board', () => {
    expect(firmwareStep(plan, catalog)).toBe(4);
  });

  it('gates steps with safety notes or power parts', () => {
    const steps = plan.assembly_steps;
    expect(needsSafetyAck(steps[0]!, stepParts(steps[0]!, plan, catalog))).toBe(false);
    expect(needsSafetyAck(steps[3]!, stepParts(steps[3]!, plan, catalog))).toBe(true);
    expect(needsSafetyAck({ ...steps[4]!, safety_notes: [] }, stepParts(steps[4]!, plan, catalog))).toBe(true);
  });
});

describe('Step 5 Build', () => {
  it('gates Next behind the safety checkbox and saves progress to the project', async () => {
    seed({ buildStep: 4 });
    await renderStep('build', <BuildStep />);
    const next = await screen.findByTestId('build-primary', {}, { timeout: 8000 });
    await waitFor(() => expect(screen.getByTestId('build-step-count').textContent).toBe('Step 4 of 11'));
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('build-firmware')).toBeDefined();
    expect((screen.getByTestId('build-firmware-download') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('build-safety-ack'));
    await waitFor(() => expect((screen.getByTestId('build-primary') as HTMLButtonElement).disabled).toBe(false));
    expect(getProject(PROJECT_ID)?.acknowledgedSteps).toEqual([4]);

    fireEvent.click(screen.getByTestId('build-primary'));
    await waitFor(() => expect(screen.getByTestId('build-step-count').textContent).toBe('Step 5 of 11'));
    expect(getProject(PROJECT_ID)?.buildStep).toBe(5);
    expect(screen.queryByTestId('build-firmware')).toBeNull();

    fireEvent.click(screen.getByTestId('build-back'));
    await waitFor(() => expect(getProject(PROJECT_ID)?.buildStep).toBe(4));
  });

  it('finishes on the last step and marks the project complete', async () => {
    seed({ buildStep: 11, acknowledgedSteps: [11] });
    await renderStep('build', <BuildStep />);
    const finish = await screen.findByTestId('build-primary', {}, { timeout: 8000 });
    await waitFor(() => expect(finish.textContent).toBe('Finish'));
    fireEvent.click(finish);
    expect(push).toHaveBeenCalledWith('/p/p1/done');
    expect(getProject(PROJECT_ID)?.completedAt).toBeTruthy();
  });

  it('marks a part missing from the overflow and shows it as a note on the step', async () => {
    seed({ buildStep: 1 });
    await renderStep('build', <BuildStep />);
    await screen.findByTestId('build-parts', {}, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('step-overflow'));
    fireEvent.click(screen.getByTestId('build-mark-missing'));
    fireEvent.click(await screen.findByTestId('build-missing-chassis-1'));
    fireEvent.click(screen.getByTestId('build-missing-confirm'));
    await waitFor(() => expect(screen.getByTestId('build-missing-note').textContent).toContain('Shadow Chassis'));
    expect(getProject(PROJECT_ID)?.missingCatalogIds).toEqual(['chassis.sparkfun_shadow_rob13301']);
  });
});

describe('Done', () => {
  it('summarises the build and keeps unresolved blockers visible', async () => {
    seed({ buildStep: 11, completedAt: new Date().toISOString(), missingCatalogIds: ['caster.sparkfun_shadow_nub'] });
    await renderStep('done', <DoneStep />);
    const parts = await screen.findByTestId('done-part-count', {}, { timeout: 8000 });
    expect(parts.textContent).toBe(String(plan.components.length));
    expect(screen.getByTestId('done-step-count').textContent).toBe('11');
    expect(screen.getByTestId('done-missing').textContent).toContain('nub caster');
    expect(screen.getByTestId('done-blockers').textContent).toContain('The left motor may not fit the frame');
    expect(screen.getByTestId('done-blockers').textContent).toContain('Not confirmed');
    expect(screen.getByTestId('done-primary').textContent).toBe('Share');
  });
});

describe('Iterate modal', () => {
  it('shows the engine reason when the edit is not accepted and keeps the text', async () => {
    seed();
    await renderStep('buy', <BuyStep />);
    await screen.findByTestId('buy-vendors', {}, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('step-overflow'));
    fireEvent.click(screen.getByTestId('buy-iterate'));
    const dialog = await screen.findByTestId('iterate');
    const apply = within(dialog).getByTestId('iterate-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(within(dialog).getAllByTestId('iterate-example')[0]!);
    const stop = 'Increase obstacle stop distance to 0.40 m';
    expect((within(dialog).getByTestId('iterate-text') as HTMLTextAreaElement).value).toBe(stop);
    expect(within(dialog).getAllByTestId('iterate-example')[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(apply.disabled).toBe(false);
    const edit = vi.spyOn(FixtureSource.prototype, 'edit');
    fireEvent.click(apply);
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect(edit.mock.calls[0]![1]).toMatchObject({
      instruction: stop,
      operation: { op: 'set_behavior_parameter', name: 'obstacle_stop_distance_m', value: 0.4 },
    });
    const reason = await screen.findByTestId('iterate-reason', {}, { timeout: 8000 });
    // Plain words first; the engine's own message stays under Details.
    expect(reason.textContent).toContain("Changes need Rivet's live engine, which isn't connected right now.");
    expect(reason.querySelector('details')!.textContent).toContain('edits cannot be validated in fixture mode');
    expect(reason.textContent).toContain(stop);
    // The trace shows the real outcome, timed from send to answer, and stays open.
    const trace = screen.getByTestId('iterate-thinking');
    expect(trace.querySelectorAll('li')).toHaveLength(1);
    expect(trace.textContent).toContain("Rivet didn't make this change");
    expect(screen.getByTestId('iterate-thinking-label').textContent).toMatch(/^Answered in \d/);
    expect(screen.getByTestId('iterate-thinking-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('iterate')).toBeDefined();
    expect((screen.getByTestId('iterate-text') as HTMLTextAreaElement).value).toBe(stop);
    expect(push).not.toHaveBeenCalledWith('/p/p1/review');
  });
});
