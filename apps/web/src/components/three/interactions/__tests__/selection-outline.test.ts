import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { findPartNode, resolveOutlineTargets } from '../SelectionOutline';

function part(instanceId: string, meshes = 2): THREE.Group {
  const g = new THREE.Group();
  g.name = `part:${instanceId}`;
  g.userData = { partNode: true, instanceId };
  const visual = new THREE.Group();
  for (let i = 0; i < meshes; i++) visual.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  g.add(visual);
  return g;
}

describe('selection outline targets', () => {
  const scene = new THREE.Scene();
  const content = new THREE.Group();
  const wheel = part('wheel-left-1', 3); // tire + hub + hub cap
  const motor = part('motor-left-1');
  content.add(wheel, motor);
  // An unrelated object that happens to reuse the naming scheme is not a part.
  const impostor = new THREE.Object3D();
  impostor.name = 'part:ghost-1';
  content.add(impostor);
  scene.add(content);

  it('resolves an instance_id to its whole PartNode, so every mesh of the part is outlined', () => {
    const [target] = resolveOutlineTargets(scene, ['wheel-left-1']);
    expect(target).toBe(wheel);
    const meshes: THREE.Object3D[] = [];
    target.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o));
    expect(meshes).toHaveLength(3);
  });

  it('de-duplicates, keeps order, and skips unknown or non-part ids', () => {
    expect(resolveOutlineTargets(scene, ['motor-left-1', 'nope', 'wheel-left-1', 'motor-left-1', 'ghost-1'])).toEqual([
      motor,
      wheel,
    ]);
    expect(findPartNode(scene, 'ghost-1')).toBeNull();
    expect(resolveOutlineTargets(scene, [])).toEqual([]);
  });

  it('switching selection resolves only the new part', () => {
    expect(resolveOutlineTargets(scene, ['motor-left-1'])).toEqual([motor]);
    expect(resolveOutlineTargets(scene, ['wheel-left-1'])).toEqual([wheel]);
  });
});
