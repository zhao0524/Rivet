import { describe, expect, it } from 'vitest';
import { buildDimensionsByCatalogId } from '../../../../lib/geometry';
import catalogJson from '../../../../lib/rivet/fixtures/sourced-seed-components.json';
import planJson from '../../../../lib/rivet/fixtures/sourced-rover-obstacle-v1.json';
import type { CatalogComponent } from '../../../../lib/rivet/types';
import { createAssemblyModel } from '../index';
import type { AssemblyPlan, Vec3 } from '../types';

const plan = planJson as unknown as AssemblyPlan;
const dims = buildDimensionsByCatalogId(catalogJson as unknown as CatalogComponent[]);
const model = createAssemblyModel(plan, { dimensionsByCatalogId: dims });
const off = (id: string): Vec3 => model.explodeOffsets[id];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const hidden = plan.components.filter((c) => c.render_overrides?.visible === false);
const visible = plan.components.filter((c) => c.render_overrides?.visible !== false);

describe('explode offsets on the sourced rover', () => {
  it('fixture has hidden kit items, including a long cable, to exercise the guards', () => {
    expect(hidden.length).toBeGreaterThan(0);
  });

  it('mirrored left/right parts separate symmetrically', () => {
    expect(off('motor-left-1')[0]).toBeCloseTo(-off('motor-right-1')[0], 6);
    expect(off('wheel-left-1')[0]).toBeCloseTo(-off('wheel-right-1')[0], 6);
    // Wheels clear past their motors.
    expect(Math.abs(off('wheel-right-1')[0])).toBeGreaterThan(Math.abs(off('motor-right-1')[0]));
  });

  it('never-rendered kit items stay with their parent and do not displace visible parts', () => {
    for (const c of hidden) expect(off(c.instance_id)).toEqual(off(c.parent_instance_id ?? 'chassis-1'));
    const withoutHidden = createAssemblyModel(
      { ...plan, components: visible },
      { dimensionsByCatalogId: dims },
    );
    for (const c of visible) expect(off(c.instance_id)).toEqual(withoutHidden.explodeOffsets[c.instance_id]);
  });

  it('every visible part except the chassis separates, by an amount proportional to the rover', () => {
    for (const c of visible) {
      const d = len(off(c.instance_id));
      if (c.instance_id === 'chassis-1') expect(d).toBe(0);
      else {
        expect(d).toBeGreaterThan(4);
        // Bounded by the rover's own size (~200 mm), not by a hidden 914 mm cable.
        expect(d).toBeLessThan(200);
      }
    }
  });

  it('directions follow roles: electronics up, sensor forward, caster down, wheels outward', () => {
    expect(off('controller-1')[1]).toBeGreaterThan(0);
    expect(off('driver-1')[1]).toBeGreaterThan(0);
    expect(off('power-motor-1')[1]).toBeGreaterThan(0);
    expect(off('sensor-1')[2]).toBeGreaterThan(0);
    expect(off('caster-1')[1]).toBeLessThan(0);
    expect(off('wheel-left-1')[0]).toBeLessThan(0);
  });

  it('is deterministic and never mutates the plan', () => {
    const before = JSON.stringify(plan);
    expect(createAssemblyModel(plan, { dimensionsByCatalogId: dims }).explodeOffsets).toEqual(model.explodeOffsets);
    expect(JSON.stringify(plan)).toBe(before);
  });
});
