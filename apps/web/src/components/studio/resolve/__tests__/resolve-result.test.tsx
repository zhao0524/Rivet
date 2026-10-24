import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ResolveResultView } from '../ResolveResultView';
import { makeResolveFixtures } from '../../../../lib/resolve/fixtures';
import type { ResolveResult } from '../../../../lib/resolve/types';

afterEach(cleanup);

const NOW = new Date('2026-10-24T18:00:00Z');
const FIXTURES = makeResolveFixtures(NOW);

function show(result: ResolveResult) {
  render(<ResolveResultView result={result} now={NOW} />);
}

const status = (partId: string) => within(screen.getByTestId(`resolve-part-${partId}`)).getByTestId('part-status');

describe('ResolveResultView copy (plan section 4)', () => {
  it('exact match names the product and sources every part', () => {
    show(FIXTURES.exact_match);
    expect(screen.getByTestId('resolve-result').dataset.outcome).toBe('exact_match');
    expect(screen.getByTestId('resolve-headline').textContent).toBe(
      'We found this product: Example Aero Scout Mini quadcopter',
    );
    expect(screen.getByTestId('resolve-sku').textContent).toContain('EA-SCOUT-MINI');
    expect(status('motor').textContent).toBe('Verified');
    expect(status('gps').textContent).toBe('Not found');
    expect(screen.getByTestId('no-source-gps')).toBeTruthy();
    expect(screen.getByTestId('resolve-part-counts').textContent).toBe('3 verified · 0 inferred · 1 not confirmed');
    expect(screen.queryByTestId('resolve-downgrade-notice')).toBeNull();
    expect(screen.queryByTestId('resolve-typical')).toBeNull();
  });

  it('partial match counts what it could not confirm and keeps typical parts separate', () => {
    show(FIXTURES.partial_match);
    expect(screen.getByTestId('resolve-headline').textContent).toBe(
      'We found the product but could not confirm 4 of 6 parts',
    );
    expect(status('frame').textContent).toBe('Inferred');
    expect(status('esc').textContent).toBe('Sources disagree');
    const typical = screen.getByTestId('resolve-typical');
    expect(typical.textContent).toContain('What similar products use');
    expect(typical.textContent).toContain('not parts of your product');
    // The typical camera must never appear in the user's own parts list.
    expect(screen.getByTestId('resolve-parts').textContent).not.toContain('12 MP');
  });

  it('no match offers alternatives and never shows a product number', () => {
    show(FIXTURES.no_match_with_alternatives);
    expect(screen.getByTestId('resolve-headline').textContent).toBe('We could not find this exact product');
    expect(screen.queryByTestId('resolve-sku')).toBeNull();
    expect(screen.queryByTestId('resolve-parts')).toBeNull();
    expect(screen.getByTestId('resolve-alternatives').textContent).toContain('Pocket 4 drone');
    expect(screen.getByTestId('resolve-typical').textContent).toContain('2 of 2 verified comparable drones');
  });

  it('unsupported explains itself and offers no parts or alternatives', () => {
    show(FIXTURES.unsupported);
    expect(screen.getByTestId('resolve-headline').textContent).toBe('This is not something Rivet can break into parts');
    expect(screen.getByTestId('resolve-result').textContent).toContain('landscape');
    expect(screen.getByTestId('resolve-unsupported-help').textContent).toContain('What to upload instead');
    expect(screen.queryByTestId('resolve-parts')).toBeNull();
    expect(screen.queryByTestId('resolve-alternatives')).toBeNull();
    expect(screen.queryByTestId('resolve-typical')).toBeNull();
  });
});

describe('ResolveResultView source popover', () => {
  it('shows the link, host tier and fetched date, and opens only on request', () => {
    show(FIXTURES.exact_match);
    expect(screen.queryByTestId('source-popover-motor')).toBeNull();
    fireEvent.click(screen.getByTestId('source-toggle-motor'));
    const pop = screen.getByTestId('source-popover-motor');
    expect(pop.querySelector('a')?.getAttribute('href')).toContain('/shop/m1103');
    expect(pop.textContent).toContain('Distributor');
    expect(pop.textContent).toContain('2026-10-23');
    fireEvent.click(screen.getByTestId('source-toggle-motor'));
    expect(screen.queryByTestId('source-popover-motor')).toBeNull();
  });

  it('says a teardown source cannot count as verified, and lists both sides of a conflict', () => {
    show(FIXTURES.partial_match);
    fireEvent.click(screen.getByTestId('source-toggle-frame'));
    expect(screen.getByTestId('source-popover-frame').textContent).toContain('cannot count as verified');
    fireEvent.click(screen.getByTestId('source-toggle-esc'));
    expect(screen.getByTestId('source-popover-esc').querySelectorAll('a')).toHaveLength(2);
  });
});

describe('ResolveResultView will not repeat a claim the evidence does not support', () => {
  it('shows an out-of-date source as Out of date, not Verified, and says why', () => {
    show(FIXTURES.partial_match);
    const row = screen.getByTestId('resolve-part-props');
    expect(row.dataset.claimedStatus).toBe('verified');
    expect(row.dataset.status).toBe('stale');
    expect(status('props').textContent).toBe('Out of date');
    expect(screen.getByTestId('resolve-downgrade-props').textContent).toContain('freshness window');
    expect(screen.getByTestId('resolve-downgrade-notice').textContent).toContain('1 part claims more than');
  });

  it('refuses the exact-match headline when a part is not confirmed or unavailable', () => {
    show({
      ...FIXTURES.exact_match,
      parts: [{ part_id: 'esc', name: 'Speed controller', status: 'conflict', evidence: FIXTURES.partial_match.parts[2].evidence }],
    });
    const result = screen.getByTestId('resolve-result');
    expect(result.dataset.claimedOutcome).toBe('exact_match');
    expect(result.dataset.outcome).toBe('partial_match');
    expect(screen.getByTestId('resolve-headline').textContent).toContain('could not confirm 1 of 1 parts');
    expect(screen.getByTestId('resolve-downgrade-notice').textContent).toContain('shown as a partial match');
  });

  it('does not say the product was found when its own number is unconfirmed', () => {
    const product = FIXTURES.exact_match.product!;
    show({
      ...FIXTURES.exact_match,
      product: { ...product, evidence: [{ ...product.evidence[0], extractor: 'llm-extract' }] },
    });
    const headline = screen.getByTestId('resolve-headline').textContent ?? '';
    expect(headline).toBe('We think this is Example Aero Scout Mini quadcopter, but we could not confirm it');
    expect(headline).not.toContain('We found');
  });
});

describe('ResolveResultView empty states', () => {
  it('says so when the product publishes no parts list', () => {
    show({ ...FIXTURES.exact_match, parts: [] });
    expect(screen.getByTestId('resolve-no-parts').textContent).toContain('No parts list is published');
  });

  it('says so when no comparable product could be verified', () => {
    show({ ...FIXTURES.no_match_with_alternatives, alternatives: [] });
    expect(screen.getByTestId('resolve-no-alternatives').textContent).toContain('No comparable product');
  });

  it('suggests nothing when there is no sourced reference for typical parts', () => {
    show({ ...FIXTURES.no_match_with_alternatives, typical: [] });
    expect(screen.getByTestId('resolve-no-typical').textContent).toContain('we are not suggesting anything');
  });
});
