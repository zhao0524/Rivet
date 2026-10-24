import { describe, expect, it } from 'vitest';
import { computeAssemblyView, createAssemblyModel, toPoseOverrides } from '../index';
import type { AssemblyPlan, AssemblyView, Vec3 } from '../types';
import { roverDimensions, roverPlan } from './roverFixture';

const ALL_IDS = roverPlan.components.map((c) => c.instance_id);
const opts = { dimensionsByCatalogId: roverDimensions };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const ids = (view: AssemblyView, pred: (s: string) => boolean) =>
  view.items.filter((i) => pred(i.state)).map((i) => i.instance_id).sort();

describe('assembled mode', () => {
  it('returns every component once, in place, fully visible', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'assembled', ...opts });
    expect(v.items.map((i) => i.instance_id)).toEqual(ALL_IDS);
    for (const item of v.items) {
      expect(item.offset_mm).toEqual([0, 0, 0]);
      expect(item.opacity).toBe(1);
      expect(item.visibility).toBe('visible');
      const c = roverPlan.components.find((x) => x.instance_id === item.instance_id)!;
      expect(item.display_position_mm).toEqual(c.pose.position_mm);
    }
  });
});

describe('step mode on rover fixture', () => {
  it('reads step count from assembly_steps', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'step', step: 0 });
    expect(v.stepCount).toBe(roverPlan.assembly_steps.length);
    expect(v.steps.map((s) => s.title)).toEqual(roverPlan.assembly_steps.map((s) => s.title));
  });

  it('step 0 is the empty prep state: everything ghosted, nothing highlighted', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'step', step: 0, ...opts });
    expect(v.currentStep).toBeNull();
    expect(v.items.every((i) => i.state === 'future' && i.visibility === 'ghost')).toBe(true);
    expect(v.items.some((i) => i.highlighted)).toBe(false);
    const hidden = computeAssemblyView(roverPlan, { mode: 'step', step: 0, ghostFuture: false });
    expect(hidden.items.every((i) => i.visibility === 'hidden' && i.opacity === 0)).toBe(true);
  });

  it('middle step reveals exactly the referenced instance IDs', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'step', step: 3, ...opts });
    expect(v.currentStep?.title).toBe('Install the wheels and caster');
    expect(ids(v, (s) => s === 'added')).toEqual(['caster-1', 'wheel-left-1', 'wheel-right-1']);
    expect(ids(v, (s) => s === 'installed')).toEqual(['chassis-1', 'motor-left-1', 'motor-right-1']);
    expect(ids(v, (s) => s === 'future')).toEqual(
      ['controller-1', 'driver-1', 'power-control-1', 'power-motor-1', 'sensor-1'].sort(),
    );
    for (const item of v.items) {
      expect(item.highlighted).toBe(item.state === 'added');
      expect(item.offset_mm).toEqual([0, 0, 0]);
      expect(item.opacity).toBe(item.state === 'future' ? 0.18 : 1);
    }
  });

  it('last step is the intact assembly with nothing future', () => {
    const last = roverPlan.assembly_steps.length;
    const v = computeAssemblyView(roverPlan, { mode: 'step', step: last, ...opts });
    expect(v.currentStep?.title).toBe('Review assembly');
    expect(ids(v, (s) => s === 'future' || s === 'unscheduled')).toEqual([]);
    expect(v.items.every((i) => i.visibility === 'visible' && i.opacity === 1)).toBe(true);
    expect(v.items.every((i) => i.offset_mm.every((n) => n === 0))).toBe(true);
    // Out of range clamps to the last step.
    expect(computeAssemblyView(roverPlan, { mode: 'step', step: 99 }).stepIndex).toBe(last);
    expect(computeAssemblyView(roverPlan, { mode: 'step', step: -3 }).stepIndex).toBe(0);
  });

  it('repeated instances are revisited, not added twice', () => {
    const v7 = computeAssemblyView(roverPlan, { mode: 'step', step: 7 });
    expect(v7.currentStep?.added_instance_ids).toEqual([]);
    expect(ids(v7, (s) => s === 'revisited')).toEqual(['controller-1', 'driver-1', 'sensor-1']);
    expect(ids(v7, (s) => s === 'added')).toEqual([]);
    expect(v7.byInstanceId['controller-1'].first_step).toBe(4);
    expect(v7.byInstanceId['controller-1'].highlighted).toBe(true);
    expect(v7.byInstanceId['controller-1'].offset_mm).toEqual([0, 0, 0]);
    const v8 = computeAssemblyView(roverPlan, { mode: 'step', step: 8 });
    expect(ids(v8, (s) => s === 'revisited')).toEqual(['chassis-1', 'controller-1']);
  });

  it('every component is added in exactly one step', () => {
    const model = createAssemblyModel(roverPlan);
    const added = model.steps.flatMap((s) => s.added_instance_ids);
    expect(added.sort()).toEqual([...ALL_IDS].sort());
    expect(model.diagnostics.unscheduled_instance_ids).toEqual([]);
    expect(model.diagnostics.missing_instance_ids).toEqual([]);
  });

  it('previous components can be solid, dimmed or hidden; revisited stay solid', () => {
    const dim = computeAssemblyView(roverPlan, { mode: 'step', step: 7, previous: 'dimmed' });
    expect(dim.byInstanceId['chassis-1'].opacity).toBe(0.55);
    expect(dim.byInstanceId['sensor-1'].opacity).toBe(1);
    const hid = computeAssemblyView(roverPlan, { mode: 'step', step: 7, previous: 'hidden' });
    expect(hid.byInstanceId['chassis-1'].visibility).toBe('hidden');
    expect(hid.byInstanceId['sensor-1'].visibility).toBe('visible');
  });

  it('seat-in progress interpolates added parts from exploded offset to pose', () => {
    const full = createAssemblyModel(roverPlan, opts).explodeOffsets['wheel-left-1'];
    const at = (p: number) =>
      computeAssemblyView(roverPlan, { mode: 'step', step: 3, progress: p, ...opts }).byInstanceId['wheel-left-1'];
    expect(at(0).offset_mm).toEqual(full);
    expect(at(0).opacity).toBeCloseTo(0.18);
    expect(at(1).offset_mm).toEqual([0, 0, 0]);
    expect(at(1).opacity).toBe(1);
    const mags = [0, 0.25, 0.5, 0.75, 1].map((p) => Math.abs(at(p).offset_mm[0]));
    for (let i = 1; i < mags.length; i++) expect(mags[i]).toBeLessThan(mags[i - 1]);
  });
});

describe('exploded mode', () => {
  const half = (id: string): Vec3 => {
    const c = roverPlan.components.find((x) => x.instance_id === id)!;
    const d = roverDimensions[c.catalog_id]!;
    return [d.x! / 2, d.y! / 2, d.z! / 2];
  };

  it('keeps the root in place and moves every child', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'exploded', progress: 1, ...opts });
    expect(v.byInstanceId['chassis-1'].offset_mm).toEqual([0, 0, 0]);
    for (const item of v.items.filter((i) => i.instance_id !== 'chassis-1')) {
      expect(Math.hypot(...item.offset_mm)).toBeGreaterThan(0);
    }
  });

  it('separates parts by role direction', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'exploded', progress: 1, ...opts });
    const o = (id: string) => v.byInstanceId[id].offset_mm;
    expect(o('wheel-left-1')[0]).toBeLessThan(0);
    expect(o('wheel-right-1')[0]).toBeGreaterThan(0);
    expect(o('caster-1')[1]).toBeLessThan(0);
    expect(o('controller-1')[1]).toBeGreaterThan(0);
    expect(o('sensor-1')[2]).toBeGreaterThan(0);
    // Mirrored pairs explode symmetrically.
    expect(o('wheel-left-1')[0]).toBeCloseTo(-o('wheel-right-1')[0]);
    expect(o('motor-left-1')[0]).toBeCloseTo(-o('motor-right-1')[0]);
  });

  it('fully exploded bounding boxes do not overlap', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'exploded', progress: 1, ...opts });
    const boxes = v.items.map((i) => ({ id: i.instance_id, c: i.display_position_mm, h: half(i.instance_id) }));
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a];
        const B = boxes[b];
        const overlap = [0, 1, 2].every((k) => Math.abs(A.c[k] - B.c[k]) < A.h[k] + B.h[k]);
        expect(overlap, `${A.id} overlaps ${B.id}`).toBe(false);
      }
    }
  });

  it('offsets are deterministic and stable across calls, clones and component order', () => {
    const a = createAssemblyModel(roverPlan, opts).explodeOffsets;
    const b = createAssemblyModel(clone(roverPlan), opts).explodeOffsets;
    const reversed: AssemblyPlan = {
      ...roverPlan,
      components: [roverPlan.components[0], ...roverPlan.components.slice(1).reverse()],
    };
    const c = createAssemblyModel(reversed, opts).explodeOffsets;
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(computeAssemblyView(roverPlan, { mode: 'exploded', progress: 0.4, ...opts })).toEqual(
      computeAssemblyView(roverPlan, { mode: 'exploded', progress: 0.4, ...opts }),
    );
  });

  it('interpolates smoothly from 0 to the full offset', () => {
    const at = (p: number) =>
      computeAssemblyView(roverPlan, { mode: 'exploded', progress: p, ...opts }).byInstanceId['controller-1']
        .offset_mm[1];
    expect(at(0)).toBe(0);
    const full = at(1);
    expect(at(0.5)).toBeCloseTo(full / 2);
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      expect(at(p)).toBeGreaterThanOrEqual(prev);
      prev = at(p);
    }
    expect(at(5)).toBe(full);
  });

  it('works without catalog dimensions', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'exploded', progress: 1 });
    expect(v.items.every((i) => i.offset_mm.every(Number.isFinite))).toBe(true);
    expect(v.byInstanceId['wheel-left-1'].offset_mm[0]).toBeLessThan(0);
  });
});

describe('reversibility and immutability', () => {
  it('never mutates the plan', () => {
    const frozen = deepFreeze(clone(roverPlan));
    const before = JSON.stringify(frozen);
    expect(() => {
      computeAssemblyView(frozen, { mode: 'exploded', progress: 1, ...opts });
      for (let s = 0; s <= frozen.assembly_steps.length; s++) {
        computeAssemblyView(frozen, { mode: 'step', step: s, progress: 0.3 });
      }
      toPoseOverrides(computeAssemblyView(frozen, { mode: 'assembled' }));
    }).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('scrubbing forward, back and to assembled has no state drift', () => {
    const fresh = (s: number) => computeAssemblyView(roverPlan, { mode: 'step', step: s, ...opts });
    const n = roverPlan.assembly_steps.length;
    const forward = Array.from({ length: n + 1 }, (_, s) => fresh(s));
    const back = Array.from({ length: n + 1 }, (_, s) => fresh(n - s)).reverse();
    expect(back).toEqual(forward);
    computeAssemblyView(roverPlan, { mode: 'exploded', progress: 1, ...opts });
    const assembled = computeAssemblyView(roverPlan, { mode: 'assembled', ...opts });
    expect(assembled.items.map((i) => i.display_position_mm)).toEqual(
      roverPlan.components.map((c) => c.pose.position_mm),
    );
    expect(computeAssemblyView(roverPlan, { mode: 'exploded', progress: 0, ...opts }).items.map((i) => i.offset_mm)).toEqual(
      assembled.items.map((i) => i.offset_mm),
    );
  });
});

describe('malformed plans', () => {
  it('reports missing step IDs and ignores them', () => {
    const plan: AssemblyPlan = {
      ...roverPlan,
      assembly_steps: [
        { step: 1, title: 'Chassis', instance_ids: ['chassis-1', 'ghost-9'] },
        { step: 2, title: 'Only missing', instance_ids: ['nope-1'] },
      ],
    };
    const model = createAssemblyModel(plan);
    expect(model.diagnostics.missing_instance_ids).toEqual([
      { step: 1, instance_id: 'ghost-9' },
      { step: 2, instance_id: 'nope-1' },
    ]);
    expect(model.steps[1].instance_ids).toEqual([]);
    const v = computeAssemblyView(plan, { mode: 'step', step: 2 });
    expect(v.stepCount).toBe(2);
    expect(v.byInstanceId['ghost-9']).toBeUndefined();
    expect(v.byInstanceId['wheel-left-1'].state).toBe('unscheduled');
    expect(model.diagnostics.unscheduled_instance_ids).toContain('wheel-left-1');
  });

  it('de-duplicates components and step references', () => {
    const plan: AssemblyPlan = {
      ...roverPlan,
      components: [...roverPlan.components, { ...roverPlan.components[1], pose: { position_mm: [999, 0, 0], rotation_deg: [0, 0, 0] } }],
      assembly_steps: [
        { step: 2, title: 'Motors', instance_ids: ['motor-left-1', 'motor-left-1', 'motor-right-1'] },
        { step: 1, title: 'Chassis', instance_ids: ['chassis-1'] },
      ],
    };
    const model = createAssemblyModel(plan);
    expect(model.diagnostics.duplicate_component_ids).toEqual(['motor-left-1']);
    // Sorted by `step` number, not array order.
    expect(model.steps.map((s) => s.title)).toEqual(['Chassis', 'Motors']);
    expect(model.steps[1].instance_ids).toEqual(['motor-left-1', 'motor-right-1']);
    const v = computeAssemblyView(plan, { mode: 'assembled' });
    expect(v.items.length).toBe(ALL_IDS.length);
    expect(new Set(v.items.map((i) => i.instance_id)).size).toBe(v.items.length);
    expect(v.byInstanceId['motor-left-1'].display_position_mm).toEqual([-56, 20, 25]);
  });

  it('handles empty steps, unresolved parents and cycles', () => {
    const empty = computeAssemblyView({ components: roverPlan.components, assembly_steps: [] }, { mode: 'step', step: 3 });
    expect(empty.stepCount).toBe(0);
    expect(empty.stepIndex).toBe(0);
    const plan: AssemblyPlan = {
      components: [
        { instance_id: 'a', catalog_id: 'x', role: 'chassis', parent_instance_id: null, pose: { position_mm: [0, 0, 0], rotation_deg: [0, 0, 0] } },
        { instance_id: 'b', catalog_id: 'x', role: 'controller', parent_instance_id: 'missing', pose: { position_mm: [0, 5, 0], rotation_deg: [0, 0, 0] } },
        { instance_id: 'c', catalog_id: 'x', role: 'wheel', parent_instance_id: 'd', pose: { position_mm: [30, 0, 0], rotation_deg: [0, 0, 0] } },
        { instance_id: 'd', catalog_id: 'x', role: 'wheel', parent_instance_id: 'c', pose: { position_mm: [-30, 0, 0], rotation_deg: [0, 90, 0] } },
      ],
      assembly_steps: [{ step: 1, title: 'All', instance_ids: ['a', 'b', 'c', 'd'] }],
    };
    const v = computeAssemblyView(plan, { mode: 'exploded', progress: 1 });
    expect(v.diagnostics.unresolved_parent_ids.map((u) => u.instance_id).sort()).toEqual(['b', 'c', 'd']);
    expect(v.byInstanceId['a'].offset_mm).toEqual([0, 0, 0]);
    expect(v.byInstanceId['b'].offset_mm[1]).toBeGreaterThan(0);
    expect(v.items.every((i) => i.offset_mm.every(Number.isFinite))).toBe(true);
  });
});

describe('toPoseOverrides', () => {
  it('maps each instance_id to a renderer override', () => {
    const v = computeAssemblyView(roverPlan, { mode: 'step', step: 2, progress: 0.5, ...opts });
    const o = toPoseOverrides(v);
    expect(Object.keys(o)).toEqual(ALL_IDS);
    expect(o['motor-left-1'].highlighted).toBe(true);
    expect(o['motor-left-1'].position_offset_mm).toEqual(v.byInstanceId['motor-left-1'].offset_mm);
    expect(o['sensor-1']).toMatchObject({ ghost: true, visible: true });
  });
});
