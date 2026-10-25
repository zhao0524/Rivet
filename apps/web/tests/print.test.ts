import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { printableLines, stlFileName } from '../src/components/steps/buy/print-model';
import { getConceptExamplePlan } from '../src/lib/fixtures';
import { buyLines } from '../src/lib/flow/derive';
import { partGeometry, printPlateObj, printPlateStl } from '../src/lib/print/stl';

const SHAPES = ['box', 'rounded_box', 'cylinder', 'tube', 'sphere', 'hemisphere', 'cone', 'capsule', 'torus', 'propeller', 'wheel'];

/** Triangle count from a binary STL, checking the length matches the header. */
function triangles(stl: ArrayBuffer): number {
  const count = new DataView(stl).getUint32(80, true);
  expect(stl.byteLength).toBe(84 + 50 * count);
  return count;
}

describe('3D print files', () => {
  it('picks concept shapes without a link or price, never boards, batteries or wires', () => {
    const plan = getConceptExamplePlan();
    const catalog = plan.concept_catalog ?? [];
    const ids = printableLines(buyLines(plan, catalog), catalog).map((p) => p.line.catalogId);
    expect(ids).toEqual(expect.arrayContaining(['concept.body', 'concept.cover', 'concept.landing-leg']));
    expect(ids.some((id) => /battery|flight-controller|esc|wire|motor/.test(id))).toBe(false);
  });

  it('prints the plastic around electronics (a dome, a ring, a panel) but never the sensor itself', () => {
    const plan = getConceptExamplePlan();
    const base = (plan.concept_catalog ?? []).find((c) => c.catalog_id === 'concept.cover')!;
    const as = (id: string, model: string) => ({ ...base, catalog_id: id, identity: { ...base.identity, model, category: 'sensor' } });
    const catalog = [as('concept.lidar-dome', 'Lidar dome'), as('concept.face-sensor', 'Face sensor'), as('concept.face-ring', 'Face sensor ring')];
    const line = (catalogId: string, name: string) => ({
      catalogId, name, quantity: 1, unitPrice: null, url: null, vendor: '', inStock: 'unknown' as const, checkedAt: null, fabricated: false, suggested: false,
    });
    const ids = printableLines(
      [line('concept.lidar-dome', 'Lidar dome'), line('concept.face-sensor', 'Face sensor'), line('concept.face-ring', 'Face sensor ring')],
      catalog,
    ).map((p) => p.line.catalogId);
    expect(ids).toEqual(['concept.lidar-dome', 'concept.face-ring']);
  });

  it('writes the same plate as OBJ text with vertices and faces', () => {
    const obj = printPlateObj([{ shape: 'rounded_box', size: { x: 40, y: 12, z: 30 }, count: 2 }]);
    expect(obj.startsWith('# Rivet custom part')).toBe(true);
    expect((obj.match(/^v /gm) ?? []).length).toBeGreaterThan(8);
    expect((obj.match(/^f /gm) ?? []).length).toBeGreaterThan(12);
  });

  it.each(SHAPES)('builds a %s at its catalog size', (shape) => {
    const group = new THREE.Group();
    for (const g of partGeometry(shape, { x: 40, y: 12, z: 30 })) group.add(new THREE.Mesh(g));
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    const [lo, hi] = [Math.min(size.x, size.y, size.z), Math.max(size.x, size.y, size.z)];
    expect(lo).toBeGreaterThan(3);
    expect(hi).toBeLessThanOrEqual(40.5);
  });

  it('lays every copy on one plate, Z up and resting on the bed', () => {
    const one = triangles(printPlateStl([{ shape: 'box', size: { x: 10, y: 20, z: 30 }, count: 1 }]));
    expect(one).toBe(12);
    const stl = printPlateStl([
      { shape: 'box', size: { x: 10, y: 20, z: 30 }, count: 3 },
      { shape: 'cylinder', size: { x: 15, y: 5, z: 15 }, count: 2 },
    ]);
    expect(triangles(stl)).toBeGreaterThan(36);
    // The box's Y (20 mm, model up) becomes Z; nothing sits below the bed.
    const view = new DataView(stl);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let t = 0; t < 36; t += 1) {
      for (let v = 0; v < 3; v += 1) {
        const z = view.getFloat32(84 + t * 50 + 12 + v * 12 + 8, true);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    expect(minZ).toBeCloseTo(0, 3);
    expect(maxZ).toBeCloseTo(20, 3);
  });

  it('names files after the build and part', () => {
    expect(stlFileName('concept-abc', 'Landing leg / rear')).toBe('concept-abc-landing-leg-rear.stl');
  });
});
