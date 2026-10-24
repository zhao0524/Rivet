import { describe, expect, it } from 'vitest';
import {
  MM_PER_SCENE_UNIT,
  SCENE_UNITS_PER_MM,
  boundsMmToScene,
  boundsSceneToMm,
  mmToScene,
  rotationDegToRad,
  sceneToMm,
  vec3MmToScene,
} from '../units';

describe('millimeter adapter', () => {
  it('maps one scene unit to one meter', () => {
    expect(MM_PER_SCENE_UNIT).toBe(1000);
    expect(SCENE_UNITS_PER_MM * MM_PER_SCENE_UNIT).toBe(1);
    expect(mmToScene(250)).toBeCloseTo(0.25);
    expect(sceneToMm(0.065)).toBeCloseTo(65);
  });

  it('round-trips bounds', () => {
    const boundsMm = { min: [-117, -2.5, -95] as const, max: [117, 90, 98] as const };
    const back = boundsSceneToMm(boundsMmToScene(boundsMm));
    back.min.forEach((v, i) => expect(v).toBeCloseTo(boundsMm.min[i], 9));
    back.max.forEach((v, i) => expect(v).toBeCloseTo(boundsMm.max[i], 9));
  });

  it('never mutates canonical plan data', () => {
    const pose = Object.freeze({ position_mm: Object.freeze([0, 24, 0] as const), rotation_deg: Object.freeze([0, 90, 0] as const) });
    expect(vec3MmToScene(pose.position_mm)).toEqual([0, 0.024, 0]);
    expect(rotationDegToRad(pose.rotation_deg)[1]).toBeCloseTo(Math.PI / 2);
    expect(pose.position_mm).toEqual([0, 24, 0]);
    expect(pose.rotation_deg).toEqual([0, 90, 0]);
  });
});
