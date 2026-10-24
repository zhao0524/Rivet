import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Studio } from '../src/components/studio';
import { FixtureSource } from '../src/lib/contracts';

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
});

async function renderStudio(source = new FixtureSource()) {
  await act(async () => {
    render(<Studio initialDataSource={source} />);
  });
  return source;
}

const insideClosedDetails = (el: Element) => {
  const details = el.closest('details');
  return !!details && !details.open;
};

describe('Left panel: prompt, change request, history (#56)', () => {
  it('shows the original prompt saved with the example and its constraints', async () => {
    await renderStudio();
    const request = screen.getByTestId('request-summary');
    expect(within(request).getByTestId('request-prompt').textContent).toBe(
      '“Build a small rover that avoids obstacles”',
    );
    expect(request.textContent).toContain('Saved with the example');
    expect(within(request).getByRole('img', { name: 'No reference image' })).toBeDefined();
    expect(request.textContent).toContain('No budget limit');
    expect(request.textContent).toContain('Distance sensing');
  });

  it('lets the follow-up demo prompt be typed without opening anything and sends it through the edit flow', async () => {
    const source = await renderStudio();
    const edit = vi.spyOn(source, 'edit');
    const input = screen.getByTestId('change-request-input');
    expect(insideClosedDetails(input)).toBe(false);
    expect(screen.getByLabelText('Ask for a change')).toBe(input);

    fireEvent.change(input, { target: { value: 'Make it cheaper and move the sensor higher' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('change-request-submit'));
    });

    expect(edit).toHaveBeenCalledWith('rivet-synthetic-rover-fixture', {
      base_revision: 1,
      instruction: 'Make it cheaper and move the sensor higher',
      operation: undefined,
    });
    const outcome = screen.getByTestId('edit-outcome-banner');
    expect(outcome.getAttribute('data-accepted')).toBe('false');
    expect(outcome.textContent).toContain('revision 1 is unchanged');
  });

  it('disables Request change until something is typed', async () => {
    await renderStudio();
    expect((screen.getByTestId('change-request-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the operation selectors under a collapsed Advanced section', async () => {
    await renderStudio();
    const advanced = screen.getByTestId('advanced-edit');
    expect(advanced.tagName).toBe('DETAILS');
    expect((advanced as HTMLDetailsElement).open).toBe(false);
    expect(advanced.contains(screen.getByTestId('edit-operation-select'))).toBe(true);
  });

  it('lists revision history with the current revision marked', async () => {
    await renderStudio();
    const item = screen.getByTestId('revision-history-1');
    expect(item.getAttribute('aria-current')).toBe('true');
    expect(item.textContent).toContain('Needs review');
  });

  it('makes the parts list a collapsible "Parts (N)" section with per-row actions', async () => {
    await renderStudio();
    const tree = screen.getByTestId('component-tree');
    expect(tree.tagName).toBe('DETAILS');
    expect(tree.querySelector('summary')!.textContent).toBe('Parts (11)');
    const row = screen.getByTestId('tree-item-driver-1');
    expect(row.querySelector('.rv-tree-row__actions')!.contains(screen.getByTestId('tree-hide-driver-1'))).toBe(true);

    fireEvent.click(screen.getByTestId('tree-select-driver-1'));
    expect(row.getAttribute('data-selected')).toBe('true');
  });
});

describe('Inspector empty state (#56)', () => {
  it('explains how to inspect and summarizes status and cost, flagging unpriced parts', async () => {
    await renderStudio();
    const empty = screen.getByTestId('inspector-empty-state');
    expect(empty.textContent).toContain('Click any part in the 3D view to see its SKU, price, and fit checks');
    expect(screen.getByTestId('overview-status').textContent).toContain('Needs review');
    expect(screen.getByTestId('overview-blocking').textContent).toContain('2 blocking findings unresolved');
    expect(screen.getByTestId('overview-price').textContent).toContain('Unknown');
    expect(screen.getByTestId('overview-unpriced').textContent).toBe('9 of 9 lines with no price');
  });

  it('is replaced by part details once a part is selected', async () => {
    await renderStudio();
    fireEvent.click(screen.getByTestId('tree-select-sensor-1'));
    expect(screen.queryByTestId('inspector-empty-state')).toBeNull();
    expect(screen.getByTestId('inspector-instance-id').textContent).toBe('sensor-1');
  });
});

describe('Trust banner (#57)', () => {
  it('is one short line that still says the parts are synthetic and checks are unresolved', async () => {
    await renderStudio();
    const banner = screen.getByTestId('provenance-trust-banner');
    expect(banner.getAttribute('data-trust-label')).toBe('Saved synthetic example');
    expect(banner.getAttribute('data-synthetic')).toBe('true');
    expect(screen.getByTestId('trust-banner-summary').textContent).toBe(
      'Saved example · synthetic parts, not sourced · 2 blocking checks unresolved',
    );
    expect(screen.queryByTestId('trust-banner-details')).toBeNull();
  });

  it('keeps the full detail behind a Details disclosure', async () => {
    await renderStudio();
    const toggle = screen.getByTestId('trust-banner-details-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = screen.getByTestId('trust-banner-details');
    expect(details.textContent).toContain('Components are synthetic placeholders, not sourced parts');
    expect(details.textContent).toContain('Loaded from a saved build, not freshly generated');
  });
});
