import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getSourcedCatalog, getSourcedRoverPlan, getSyntheticCatalog, getSyntheticRoverPlan } from '../../../../lib/fixtures';
import { enclosureMeshes, MANIFOLD_VERSION } from '../geometry';
import { computeEnclosure } from '../layout';

/** Edges used by one triangle (holes) or by more than two (non-manifold). Both break slicing. */
function badEdges(g: THREE.BufferGeometry) {
  const idx = g.index!.array;
  const count = new Map<string, number>();
  for (let i = 0; i < idx.length; i += 3) {
    for (const [a, b] of [[idx[i]!, idx[i + 1]!], [idx[i + 1]!, idx[i + 2]!], [idx[i + 2]!, idx[i]!]]) {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  return [...count.values()].filter((n) => n !== 2).length;
}

describe.each([
  ['synthetic', getSyntheticRoverPlan(), getSyntheticCatalog()],
  ['sourced', getSourcedRoverPlan(), getSourcedCatalog()],
] as const)('printed parts for the %s rover', (_name, plan, catalog) => {
  const spec = computeEnclosure(plan.components, catalog)!;

  it('are closed, watertight solids that fit the layout', async () => {
    const { shell, posts } = await enclosureMeshes(spec);
    for (const part of [shell, ...posts]) {
      expect(part.solid.index!.count).toBeGreaterThan(0);
      expect(badEdges(part.solid)).toBe(0);
    }
    shell.solid.computeBoundingBox();
    const bb = shell.solid.boundingBox!;
    for (let i = 0; i < 3; i++) {
      expect(bb.min.getComponent(i)).toBeGreaterThanOrEqual(spec.shell.min[i]! - 0.01);
      expect(bb.max.getComponent(i)).toBeLessThanOrEqual(spec.shell.max[i]! + 0.01);
    }
    expect(posts).toHaveLength(spec.posts.length);
  });

  it('gets a car profile: a sloped hood at the front', () => {
    expect(spec.slopes.map((s) => s.id)).toContain('hood');
  });
});

describe('Manifold runtime served from /public', () => {
  it('is the same build as the installed package', () => {
    const pkg = join(__dirname, '../../../../../node_modules/manifold-3d');
    const served = join(__dirname, `../../../../../public/wasm/manifold-${MANIFOLD_VERSION}`);
    const hash = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
    for (const file of ['manifold.js', 'manifold.wasm']) expect(hash(join(served, file))).toBe(hash(join(pkg, file)));
    expect(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version).toBe(MANIFOLD_VERSION);
  });
});
