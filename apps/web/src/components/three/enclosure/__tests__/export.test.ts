import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getSourcedCatalog, getSourcedRoverPlan } from '../../../../lib/fixtures';
import { printFileContents, printFileName, printPlate } from '../export';
import { enclosureMeshes } from '../geometry';
import { computeEnclosure } from '../layout';

describe('print files for the printed body', async () => {
  const plan = getSourcedRoverPlan();
  const meshes = await enclosureMeshes(computeEnclosure(plan.components, getSourcedCatalog())!);

  it('lays every part on the plate, Z up, without overlaps', () => {
    const plate = printPlate(meshes);
    const boxes = plate.children.map((m) => new THREE.Box3().setFromObject(m));
    expect(boxes).toHaveLength(1 + meshes.posts.length);
    for (const b of boxes) expect(b.min.z).toBeCloseTo(0, 5);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(boxes[i]!.clone().expandByScalar(-0.01).intersectsBox(boxes[j]!)).toBe(false);
  });

  it('puts the shell roof-down, open side up, so it prints without supports', () => {
    const shell = plate().children[0]!;
    const g = (shell as THREE.Mesh).geometry;
    g.computeBoundingBox();
    const height = g.boundingBox!.max.z;
    const spec = computeEnclosure(plan.components, getSourcedCatalog())!;
    expect(height).toBeCloseTo(spec.shell.max[1] - spec.shell.min[1], 1);
    // The roof is solid, so the bottom layer (Z near 0) has more area than the open rim at the top.
    const pos = g.getAttribute('position');
    let low = 0;
    let high = 0;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z < 0.01) low++;
      if (z > height - 0.01) high++;
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
  });

  it('writes OBJ with one named object per part, and binary STL', () => {
    const obj = printFileContents(meshes, 'obj', plan.title) as string;
    expect(obj).toContain('# Units: millimetres');
    expect(obj).toContain('o body_shell');
    expect(obj.match(/^o /gm)).toHaveLength(1 + meshes.posts.length);
    const stl = new DataView(printFileContents(meshes, 'stl', plan.title) as ArrayBuffer);
    const triangles = stl.getUint32(80, true);
    expect(triangles).toBeGreaterThan(0);
    expect(stl.byteLength).toBe(84 + triangles * 50);
    expect(printFileName(plan.build_id, plan.revision, 'obj')).toMatch(/-printed-body\.obj$/);
  });

  function plate() {
    return printPlate(meshes);
  }
});
