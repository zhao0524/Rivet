import { describe, expect, it } from 'vitest';
import { getSourcedCatalog, getSourcedRoverPlan, getSyntheticCatalog, getSyntheticRoverPlan } from '../../../../lib/fixtures';
import { CLEARANCE_MM, computeEnclosure, partBox, topHeightAt, WALL_MM, type Box } from '../layout';

const overlap = (a: Box, b: Box) => [0, 1, 2].every((i) => a.max[i] > b.min[i] && b.max[i] > a.min[i]);

const PLANS = [
  ['synthetic', getSyntheticRoverPlan(), getSyntheticCatalog()],
  ['sourced', getSourcedRoverPlan(), getSourcedCatalog()],
] as const;

describe.each(PLANS)('printed body for the %s rover', (_name, plan, catalog) => {
  const spec = computeEnclosure(plan.components, catalog)!;
  const byId = new Map(catalog.map((c) => [c.catalog_id, c]));
  const box = (id: string) => partBox(plan.components.find((c) => c.instance_id === id)!, byId);
  const role = (r: string) => plan.components.filter((c) => c.role === r && c.render_overrides?.visible !== false);

  it('exists and rests on the chassis deck', () => {
    expect(spec).not.toBeNull();
    expect(spec.shell.min[1]).toBeCloseTo(box(role('chassis')[0]!.instance_id).max[1]);
  });

  it('closes over every board and pack above the deck, with clearance under the roof and slopes', () => {
    for (const c of plan.components) {
      if (['chassis', 'wheel', 'caster', 'motor', 'accessory'].includes(c.role) || c.render_overrides?.visible === false) continue;
      const b = partBox(c, byId);
      if (b.max[1] <= spec.shell.min[1]) continue;
      expect(b.max[1] + CLEARANCE_MM + WALL_MM).toBeLessThanOrEqual(spec.shell.max[1] + 1e-6);
      for (const z of [b.min[2], b.max[2]]) expect(b.max[1] + CLEARANCE_MM + WALL_MM).toBeLessThanOrEqual(topHeightAt(spec, z) + 1e-6);
      expect(b.min[0]).toBeGreaterThanOrEqual(spec.shell.min[0] + WALL_MM);
      expect(b.max[0]).toBeLessThanOrEqual(spec.shell.max[0] - WALL_MM);
    }
  });

  it('leaves the wheels outside and opens a window for each distance sensor', () => {
    for (const w of role('wheel')) expect(overlap(box(w.instance_id), spec.shell)).toBe(false);
    for (const s of role('distance_sensor')) {
      const win = spec.cutouts.find((c) => c.id === `window-${s.instance_id}`)!;
      expect(win.max[2]).toBeGreaterThan(spec.shell.max[2]);
      expect(overlap(win, box(s.instance_id))).toBe(true);
    }
  });

  it('cuts an opening or shaft hole for each motor that rises above the deck', () => {
    for (const m of role('motor')) {
      const above = box(m.instance_id).max[1] > spec.shell.min[1];
      expect(spec.cutouts.some((c) => c.id === `axle-${m.instance_id}`)).toBe(above);
    }
  });

  it('puts standoffs only where they run into no other part', () => {
    const parts = plan.components.filter((c) => c.role !== 'chassis' && c.render_overrides?.visible !== false);
    for (const p of spec.posts) {
      expect(p.yTop).toBeGreaterThan(p.yBottom);
      const column: Box = { min: [p.x - p.radius, p.yBottom, p.z - p.radius], max: [p.x + p.radius, p.yTop, p.z + p.radius] };
      for (const c of parts) if (c.instance_id !== p.forInstanceId) expect(overlap(column, partBox(c, byId))).toBe(false);
    }
  });

  it('is stable for the same layout', () => {
    expect(computeEnclosure(plan.components, catalog)!.key).toBe(spec.key);
  });
});

describe('printed body without a chassis', () => {
  it('is not made up', () => {
    const plan = getSyntheticRoverPlan();
    expect(computeEnclosure(plan.components.filter((c) => c.role !== 'chassis'), getSyntheticCatalog())).toBeNull();
  });
});
