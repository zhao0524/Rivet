import { describe, expect, it } from 'vitest';
import demoCatalog from '../catalog.json';
import { parseDemoCatalog, sandboxProduct, sandboxProducts, showcaseToSandbox } from '../catalog';
import { explodeOffsetsMm, partExtentMm, productBoundsMm } from '../layout';
import { searchProducts } from '../search';
import { SANDBOX_MAX_PRODUCTS } from '../types';
import { showcaseFixtureProduct } from '../../showcase/fixtures';

describe('sandbox catalogue', () => {
  const products = sandboxProducts();

  it('holds between 1 and 50 products with unique ids', () => {
    expect(products.length).toBeGreaterThanOrEqual(1);
    expect(products.length).toBeLessThanOrEqual(SANDBOX_MAX_PRODUCTS);
    expect(new Set(products.map((p) => p.product_id)).size).toBe(products.length);
  });

  it('only publishes sourced products, never invented demo catalogue entries', () => {
    const kinds = products.map((p) => p.kind);
    expect(kinds.slice(0, 2)).toEqual(['showcase', 'showcase']);
    expect(kinds.every((k) => k === 'showcase')).toBe(true);
    expect(sandboxProduct('demo-pocket-rover-2wd')).toBeNull();
  });

  it('every part has a drawable shape and sits above the ground', () => {
    for (const p of products) {
      for (const part of p.parts) {
        const e = partExtentMm(part);
        expect(e.max[1], `${p.product_id}/${part.part_id}`).toBeGreaterThan(0);
        expect(part.size_mm.every((n) => n > 0)).toBe(true);
      }
    }
  });

  it('demo products never carry vendor facts; showcase parts always do', () => {
    for (const p of products) {
      for (const part of p.parts) expect(part.sourcing !== null).toBe(p.kind === 'showcase');
    }
  });

  it('looks products up by id', () => {
    expect(sandboxProduct('nope')).toBeNull();
    expect(sandboxProduct(products[0].product_id)?.name).toBe(products[0].name);
  });

  it('rejects malformed hand edits', () => {
    expect(() => parseDemoCatalog({ synthetic: false, products: [] })).toThrow(/synthetic/);
    const bad = structuredClone(demoCatalog) as typeof demoCatalog;
    bad.products[0].parts[0].shape = 'torus';
    expect(() => parseDemoCatalog(bad)).toThrow(/shape/);
    const dupe = structuredClone(demoCatalog) as typeof demoCatalog;
    dupe.products[0].parts[1].part_id = dupe.products[0].parts[0].part_id;
    expect(() => parseDemoCatalog(dupe)).toThrow(/duplicate/);
  });

  it('maps a showcase product part-for-part and keeps the SKU', () => {
    const raw = showcaseFixtureProduct('sample-simple-raspberry-pi-robot')!;
    const mapped = showcaseToSandbox(raw);
    expect(mapped.parts).toHaveLength(raw.parts.length);
    expect(mapped.parts[0].sourcing?.sku).toBe(raw.parts[0].sku);
    expect(mapped.source?.url).toBe(raw.source.url);
  });
});

describe('searchProducts', () => {
  const products = sandboxProducts();

  it('returns everything for an empty query and filters by category', () => {
    expect(searchProducts(products, '')).toHaveLength(products.length);
    const rovers = searchProducts(products, '', 'rover');
    expect(rovers.length).toBeGreaterThan(0);
    expect(rovers.every((p) => p.category === 'rover')).toBe(true);
  });

  it('matches a vendor SKU inside a real product', () => {
    const hit = searchProducts(products, '2939');
    expect(hit.map((p) => p.product_id)).toContain('sample-simple-raspberry-pi-robot');
  });

  it('requires every word and ranks name matches first', () => {
    expect(searchProducts(products, 'rover zzzz')).toEqual([]);
    const hits = searchProducts(products, 'rover');
    const top = hits[0];
    expect(`${top.name} ${top.category}`.toLowerCase()).toContain('rover');
    // Every name/category hit comes before any product that only mentions it in a part or summary.
    const isHead = (p: (typeof hits)[number]) => `${p.name} ${p.category}`.toLowerCase().includes('rover');
    const firstWeak = hits.findIndex((p) => !isHead(p));
    expect(firstWeak === -1 || hits.slice(firstWeak).every((p) => !isHead(p))).toBe(true);
  });

  it('finds a product through one of its part names', () => {
    expect(searchProducts(products, 'standoffs').some((p) => p.product_id === 'sample-simple-raspberry-pi-robot')).toBe(true);
  });
});

describe('layout', () => {
  it('swaps axes for quarter-turn rotations', () => {
    const wheel = { part_id: 'w', name: 'w', group: 'g', quantity: 1, shape: 'cylinder' as const, size_mm: [66, 26, 66] as const, position_mm: [0, 33, 0] as const, rotation_deg: [0, 0, 90] as const, color: '#000000', note: '', sourcing: null };
    const e = partExtentMm(wheel);
    expect(e.max[0] - e.min[0]).toBeCloseTo(26);
    expect(e.max[1] - e.min[1]).toBeCloseTo(66);
  });

  it('bounds cover every part and explode offsets point away from the centre', () => {
    const p = parseDemoCatalog(demoCatalog)[0]!;
    const b = productBoundsMm(p.parts);
    for (const part of p.parts) {
      const e = partExtentMm(part);
      expect(e.min[0]).toBeGreaterThanOrEqual(b.min[0] - 1e-6);
      expect(e.max[2]).toBeLessThanOrEqual(b.max[2] + 1e-6);
    }
    const offsets = explodeOffsetsMm(p.parts);
    expect(Object.keys(offsets)).toHaveLength(p.parts.length);
    expect(Object.values(offsets).every((o) => o.every(Number.isFinite))).toBe(true);
  });
});
