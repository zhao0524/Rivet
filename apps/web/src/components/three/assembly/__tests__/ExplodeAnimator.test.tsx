import ReactThreeTestRenderer from '@react-three/test-renderer';
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { PartAssembly } from '../../parts';
import type { PoseOverride } from '../../parts/types';
import { roverCatalog, roverPlan } from '../../parts/__tests__/rover-fixture';
import { ExplodeAnimator, createAssemblyModel } from '../index';
import type { AssemblyPlan } from '../types';

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const offsets = createAssemblyModel(roverPlan as unknown as AssemblyPlan).explodeOffsets;
const overrides: Record<string, PoseOverride> = Object.fromEntries(
  roverPlan.components.map((c) => [
    c.instance_id,
    { position_mm: c.pose.position_mm, rotation_deg: c.pose.rotation_deg, explode_offset_mm: offsets[c.instance_id] },
  ]),
);

const scene = (target: number) => (
  <ExplodeAnimator target={target}>
    <PartAssembly plan={roverPlan} catalog={roverCatalog} poseOverrides={overrides} />
  </ExplodeAnimator>
);

const node = (r: Renderer, id: string) =>
  r.scene.find((n) => n.instance.userData?.partNode === true && n.instance.userData.instanceId === id)
    .instance as THREE.Object3D;

/** Run frames until the spring has comfortably settled. */
const settle = (r: Renderer) => r.advanceFrames(90, 1 / 60);

function expectAt(r: Renderer, progress: number) {
  for (const c of roverPlan.components) {
    const o = offsets[c.instance_id];
    const p = c.pose.position_mm;
    const actual = node(r, c.instance_id).position.toArray();
    for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(p[i] + o[i] * progress, 9);
  }
}

describe('ExplodeAnimator with PartAssembly', () => {
  it('role offsets separate the rover: chassis stays, wheels go sideways, electronics up, sensor forward', () => {
    expect(offsets['chassis-1']).toEqual([0, 0, 0]);
    expect(offsets['wheel-left-1'][0]).toBeLessThan(0);
    expect(offsets['wheel-right-1'][0]).toBeGreaterThan(0);
    expect(offsets['controller-1'][1]).toBeGreaterThan(0);
    expect(offsets['driver-1'][1]).toBeGreaterThan(0);
    expect(offsets['sensor-1'][2]).toBeGreaterThan(0);
    expect(offsets['caster-1'][1]).toBeLessThan(0);
  });

  it('animates to the full explode, then returns to the exact canonical poses', async () => {
    const before = clone(roverPlan);
    const r = await ReactThreeTestRenderer.create(scene(0));
    expectAt(r, 0);

    await r.update(scene(1));
    await r.advanceFrames(6, 1 / 60);
    const mid = node(r, 'wheel-right-1').position.x;
    const start = roverPlan.components.find((c) => c.instance_id === 'wheel-right-1')!.pose.position_mm[0];
    const end = start + offsets['wheel-right-1'][0];
    // Partway, not snapped to either end.
    expect(mid).toBeGreaterThan(start);
    expect(mid).toBeLessThan(end);

    await settle(r);
    expectAt(r, 1);

    await r.update(scene(0));
    await settle(r);
    expectAt(r, 0);
    for (const c of roverPlan.components) expect(node(r, c.instance_id).position.toArray()).toEqual(c.pose.position_mm);
    expect(roverPlan).toEqual(before);
  });

  it('rapid toggles reverse smoothly and leave no positional drift', async () => {
    const r = await ReactThreeTestRenderer.create(scene(0));
    for (let i = 0; i < 12; i++) {
      await r.update(scene(i % 2 === 0 ? 1 : 0));
      await r.advanceFrames(1 + (i % 4), 1 / 60);
    }
    await r.update(scene(0));
    await settle(r);
    for (const c of roverPlan.components) expect(node(r, c.instance_id).position.toArray()).toEqual(c.pose.position_mm);
  });

  it('moves each part as one rigid node: child meshes keep their local transforms and rotation is preserved', async () => {
    const r = await ReactThreeTestRenderer.create(scene(0));
    const wheel = node(r, 'wheel-left-1');
    const snapshot = () => {
      const out: number[][] = [];
      wheel.traverse((o) => {
        if (o !== wheel) out.push([...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()]);
      });
      return out;
    };
    const children = snapshot();
    const rotation = wheel.rotation.toArray();
    await r.update(scene(1));
    await settle(r);
    expect(snapshot()).toEqual(children);
    expect(wheel.rotation.toArray()).toEqual(rotation);
    expect(wheel.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('a part keeps working and is pickable while exploded', async () => {
    const r = await ReactThreeTestRenderer.create(scene(1));
    // Mounted directly at the target: no animation on first render.
    expectAt(r, 1);
    expect(node(r, 'controller-1').visible).toBe(true);
  });
});
