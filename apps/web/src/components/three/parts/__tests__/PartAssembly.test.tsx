import ReactThreeTestRenderer from '@react-three/test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { PartAssembly, resolveRecipe, resolveSide, toRadians } from '..';
import type { PartPlan, PlanComponentOccurrence } from '../types';
import { roverCatalog, roverPlan } from './rover-fixture';

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;

const partNodes = (r: Renderer) => r.scene.findAll((n) => n.instance.userData?.partNode === true);
const byInstance = (r: Renderer, id: string) => {
  const hits = partNodes(r).filter((n) => n.instance.userData.instanceId === id);
  expect(hits).toHaveLength(1);
  return hits[0];
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const withUnknown: PartPlan = {
  ...roverPlan,
  components: [
    ...roverPlan.components,
    {
      instance_id: 'mystery-1',
      catalog_id: 'demo.not_in_catalog',
      role: 'accessory',
      pose: { position_mm: [10, 50, -5], rotation_deg: [0, 45, 0] },
      render_overrides: {},
    },
  ],
};

function expectPose(node: THREE.Object3D, c: Pick<PlanComponentOccurrence, 'pose'>) {
  expect(node.position.toArray()).toEqual(c.pose.position_mm);
  const [rx, ry, rz] = toRadians(c.pose.rotation_deg);
  expect(node.rotation.x).toBeCloseTo(rx, 9);
  expect(node.rotation.y).toBeCloseTo(ry, 9);
  expect(node.rotation.z).toBeCloseTo(rz, 9);
  expect(node.rotation.order).toBe('XYZ');
}

describe('PartAssembly', () => {
  it('renders every plan occurrence exactly once as a PartNode, including repeats and unknown parts', async () => {
    const r = await ReactThreeTestRenderer.create(<PartAssembly plan={withUnknown} catalog={roverCatalog} />);
    const nodes = partNodes(r);
    const ids = nodes.map((n) => n.instance.userData.instanceId);
    expect(ids).toHaveLength(withUnknown.components.length);
    expect(new Set(ids)).toEqual(new Set(withUnknown.components.map((c) => c.instance_id)));

    const motors = nodes.filter((n) => n.instance.userData.catalogId === 'demo.tt_motor');
    const wheels = nodes.filter((n) => n.instance.userData.catalogId === 'demo.wheel');
    expect(motors.map((n) => n.instance.userData.instanceId).sort()).toEqual(['motor-left-1', 'motor-right-1']);
    expect(wheels.map((n) => n.instance.userData.instanceId).sort()).toEqual(['wheel-left-1', 'wheel-right-1']);

    const mystery = byInstance(r, 'mystery-1');
    expect(mystery.instance.userData.recipe).toBe('unknown');
    expect(mystery.instance.userData.fallback).toBe(true);
    expect(mystery.children.length).toBeGreaterThan(0);
  });

  it('cosmetic detail never forms additional PartNodes', async () => {
    const r = await ReactThreeTestRenderer.create(<PartAssembly plan={roverPlan} catalog={roverCatalog} />);
    for (const node of partNodes(r)) {
      const nested = node.findAll((n) => n !== node && n.instance.userData?.partNode === true);
      expect(nested).toHaveLength(0);
      expect(node.findAll((n) => (n.instance as THREE.Mesh).isMesh === true).length).toBeGreaterThan(0);
    }
  });

  it('uses a dedicated recipe for every rover part and mirrors left/right', async () => {
    const recipes = Object.fromEntries(
      roverPlan.components.map((c) => [c.instance_id, resolveRecipe(c, roverCatalog.find((k) => k.catalog_id === c.catalog_id))]),
    );
    expect(recipes).toEqual({
      'chassis-1': 'chassis_2wd',
      'motor-left-1': 'tt_motor',
      'motor-right-1': 'tt_motor',
      'wheel-left-1': 'wheel',
      'wheel-right-1': 'wheel',
      'caster-1': 'caster',
      'controller-1': 'esp32_devkit',
      'driver-1': 'tb6612_driver',
      'sensor-1': 'ultrasonic_sensor',
      'power-motor-1': 'battery_pack',
      'power-control-1': 'usb_power_bank',
    });
    const wheelL = roverPlan.components.find((c) => c.instance_id === 'wheel-left-1')!;
    const wheelR = roverPlan.components.find((c) => c.instance_id === 'wheel-right-1')!;
    expect(resolveSide(wheelL)).toBe('left');
    expect(resolveSide(wheelR)).toBe('right');
  });

  it('applies the original pose unchanged and never mutates the plan', async () => {
    const before = clone(withUnknown);
    const r = await ReactThreeTestRenderer.create(<PartAssembly plan={withUnknown} catalog={roverCatalog} selectedInstanceId="driver-1" />);
    for (const c of withUnknown.components) expectPose(byInstance(r, c.instance_id).instance as THREE.Object3D, c);
    expect(withUnknown).toEqual(before);
  });

  it('poseOverrides move only the presentation node and leave the plan intact', async () => {
    const before = clone(roverPlan);
    const overrides = { 'sensor-1': { position_mm: [0, 60, 120] as [number, number, number] } };
    const r = await ReactThreeTestRenderer.create(<PartAssembly plan={roverPlan} catalog={roverCatalog} poseOverrides={overrides} />);
    const sensor = byInstance(r, 'sensor-1').instance as THREE.Object3D;
    expect(sensor.position.toArray()).toEqual([0, 60, 120]);
    const original = roverPlan.components.find((c) => c.instance_id === 'sensor-1')!;
    expect(original.pose.position_mm).toEqual([0, 35, 81]);
    expect(roverPlan).toEqual(before);
    expectPose(byInstance(r, 'chassis-1').instance as THREE.Object3D, roverPlan.components[0]);
  });

  it('selects by instance_id, so repeated catalog parts stay distinguishable', async () => {
    const onSelect = vi.fn();
    const r = await ReactThreeTestRenderer.create(<PartAssembly plan={roverPlan} catalog={roverCatalog} onSelect={onSelect} />);
    await r.fireEvent(byInstance(r, 'wheel-right-1'), 'onClick', { stopPropagation: () => {} });
    await r.fireEvent(byInstance(r, 'wheel-left-1'), 'onClick', { stopPropagation: () => {} });
    expect(onSelect.mock.calls.map(([e]) => e)).toEqual([
      { instanceId: 'wheel-right-1', catalogId: 'demo.wheel' },
      { instanceId: 'wheel-left-1', catalogId: 'demo.wheel' },
    ]);
  });

  it('marks the selected part with an outline and honours visibility', async () => {
    const r = await ReactThreeTestRenderer.create(
      <PartAssembly
        plan={roverPlan}
        catalog={roverCatalog}
        selectedInstanceId="controller-1"
        visibility={{ 'power-control-1': 'hidden', 'power-motor-1': 'ghost' }}
      />,
    );
    const outlines = r.scene.findAll((n) => n.instance.name === 'selection-outline');
    expect(outlines).toHaveLength(1);
    expect(outlines[0].parent?.instance.userData.instanceId).toBe('controller-1');
    expect((byInstance(r, 'power-control-1').instance as THREE.Object3D).visible).toBe(false);
    const ghostMeshes = byInstance(r, 'power-motor-1').findAll((n) => (n.instance as THREE.Mesh).isMesh === true);
    expect(ghostMeshes.every((m) => ((m.instance as THREE.Mesh).material as THREE.Material).transparent)).toBe(true);
    expect(partNodes(r)).toHaveLength(roverPlan.components.length);
  });

  it('accepts a catalog keyed by catalog_id', async () => {
    const keyed = Object.fromEntries(roverCatalog.map((c) => [c.catalog_id, c]));
    const r = await ReactThreeTestRenderer.create(<PartAssembly plan={roverPlan} catalog={keyed} />);
    expect(partNodes(r).filter((n) => n.instance.userData.recipe === 'unknown')).toHaveLength(0);
  });
});
