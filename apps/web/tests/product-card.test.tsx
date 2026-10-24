import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProductCard } from '../src/components/studio/panels/ProductCard';
import { BOMPanel } from '../src/components/studio/panels/BOMPanel';
import { summarizeBuild } from '../src/components/studio/panels/product';
import type { BuildPlan } from '../src/components/studio/panels/types';
import { parseBuildPlan, parseCatalogComponents } from '../src/lib/rivet/validate';
import rawPlan from '../src/lib/rivet/fixtures/sourced-rover-obstacle-v1.json';
import rawCatalog from '../src/lib/rivet/fixtures/sourced-seed-components.json';

afterEach(cleanup);
const catalog = parseCatalogComponents(rawCatalog);
const makePlan = () => parseBuildPlan(structuredClone(rawPlan)) as unknown as BuildPlan;
it('keeps sourced parts distinct from fallback interpretation', () => {
  const plan = makePlan();
  plan.provenance.generation_mode = 'fallback';
  render(<ProductCard plan={plan} catalog={catalog} catalogId={plan.bom.items[0].catalog_id} />);
  expect(screen.queryByTestId('inspector-synthetic-notice')).toBeNull();
});
it('removes a newly broken link from both purchase surfaces without rewriting the saved BOM', () => {
  const plan = makePlan();
  const item = plan.bom.items.find(i => i.link_status === 'verified_product')!;
  const original = structuredClone(item);
  plan.provenance.sourcing = { synthetic: false, synthetic_catalog_ids: [], unverified_link_count: 0, sku_missing_count: 0,
    link_checks: { [item.catalog_id]: { status: 'broken', checked_at: '2026-10-24', catalog_verified_at: '2026-10-24', verified_at: '2026-10-24', fresh: true, flags: [], detail: 'HTTP 404' } } };
  render(<><ProductCard plan={plan} catalog={catalog} catalogId={item.catalog_id} /><BOMPanel plan={plan} catalog={catalog} onSelectInstance={vi.fn()} /></>);
  expect(screen.getByTestId('product-vendor-link').getAttribute('data-link-status')).toBe('not_available');
  expect(screen.getByTestId('inspector-link-status').textContent).toBe('No link available');
  expect(screen.getByTestId('inspector-link-purchase').hasAttribute('href')).toBe(false);
  expect(screen.getByTestId(`bom-link-${item.catalog_id}`).hasAttribute('href')).toBe(false);
  expect(summarizeBuild(plan, catalog).buyList.some(i => i.catalogId === item.catalog_id)).toBe(false);
  expect(item).toEqual(original);
});
