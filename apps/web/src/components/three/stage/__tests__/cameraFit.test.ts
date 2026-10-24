import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PADDING,
  FALLBACK_BOUNDS,
  MIN_HALF_EXTENT,
  STAGE_FOV_DEG,
  fitCameraToBounds,
  gridSpacingForRadius,
  resolveBounds,
  viewDirection,
  type CameraFit,
} from '../cameraFit';
import { boundsMmToScene, type Bounds3 } from '../units';

const mm = (min: [number, number, number], max: [number, number, number]): Bounds3 => boundsMmToScene({ min, max });

const WIDE = mm([-900, 0, -30], [900, 60, 30]);
const TALL = mm([-30, 0, -30], [30, 1400, 30]);
const SMALL = mm([-0.5, 0, -0.5], [0.5, 1, 0.5]);
const ROVER = mm([-117, 0, -95], [117, 90, 98]);

/** Projects all eight corners through a real three.js camera and returns the NDC extremes. */
function frameExtents(fit: CameraFit, aspect: number) {
  const camera = new PerspectiveCamera(STAGE_FOV_DEG, aspect, fit.near, fit.far);
  camera.position.set(...fit.position);
  camera.lookAt(new Vector3(...fit.target));
  camera.updateMatrixWorld();
  let maxX = 0;
  let maxY = 0;
  let minDepth = Infinity;
  const { min, max } = fit.bounds;
  for (let i = 0; i < 8; i++) {
    const corner = new Vector3(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
    minDepth = Math.min(minDepth, corner.clone().applyMatrix4(camera.matrixWorldInverse).z * -1);
    corner.project(camera);
    maxX = Math.max(maxX, Math.abs(corner.x));
    maxY = Math.max(maxY, Math.abs(corner.y));
  }
  return { maxX, maxY, minDepth };
}

const LIMIT = 1 - DEFAULT_PADDING;
const EPS = 1e-6;

describe('fitCameraToBounds', () => {
  it.each([
    ['wide in landscape', WIDE, 16 / 9],
    ['wide in portrait', WIDE, 9 / 16],
    ['tall in landscape', TALL, 16 / 9],
    ['tall in portrait', TALL, 9 / 16],
    ['rover-sized in square', ROVER, 1],
    ['small part', SMALL, 4 / 3],
  ])('keeps every corner inside the padded frame and touches it (%s)', (_, bounds, aspect) => {
    const fit = fitCameraToBounds(bounds, { aspect });
    const { maxX, maxY, minDepth } = frameExtents(fit, aspect);
    expect(maxX).toBeLessThanOrEqual(LIMIT + EPS);
    expect(maxY).toBeLessThanOrEqual(LIMIT + EPS);
    expect(Math.max(maxX, maxY)).toBeGreaterThan(LIMIT - 0.01);
    expect(minDepth).toBeGreaterThan(fit.near);
    expect(fit.far).toBeGreaterThan(fit.maxDistance + fit.radius);
  });

  it('is width-limited for wide bounds and height-limited for tall bounds', () => {
    const wide = frameExtents(fitCameraToBounds(WIDE, { aspect: 16 / 9 }), 16 / 9);
    expect(wide.maxX).toBeGreaterThan(wide.maxY);
    const tall = frameExtents(fitCameraToBounds(TALL, { aspect: 16 / 9 }), 16 / 9);
    expect(tall.maxY).toBeGreaterThan(tall.maxX);
  });

  it('pulls back for narrower viewports and never for wider ones', () => {
    const aspects = [0.4, 0.75, 1, 1.5, 2.4];
    for (const bounds of [WIDE, TALL, ROVER]) {
      const distances = aspects.map((aspect) => fitCameraToBounds(bounds, { aspect }).distance);
      for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeLessThanOrEqual(distances[i - 1] + EPS);
    }
    const wideLandscape = fitCameraToBounds(WIDE, { aspect: 16 / 9 }).distance;
    const widePortrait = fitCameraToBounds(WIDE, { aspect: 9 / 16 }).distance;
    expect(widePortrait / wideLandscape).toBeGreaterThan(2.5);
  });

  it('places the camera along the requested view direction', () => {
    const view = { azimuthDeg: 90, elevationDeg: 0 };
    const fit = fitCameraToBounds(ROVER, { aspect: 1, view });
    const dir = new Vector3(...fit.position).sub(new Vector3(...fit.target)).normalize();
    expect(dir.toArray().map((v) => +v.toFixed(6))).toEqual(viewDirection(view).map((v) => +v.toFixed(6)));
    const frontDir = viewDirection({ azimuthDeg: 0, elevationDeg: 0 });
    expect(frontDir[2]).toBeCloseTo(1);
  });

  it('clamps tiny bounds to a minimum framed size with sane clipping planes', () => {
    const fit = fitCameraToBounds(SMALL, { aspect: 1 });
    for (let i = 0; i < 3; i++) {
      expect(fit.bounds.max[i] - fit.bounds.min[i]).toBeCloseTo(MIN_HALF_EXTENT * 2);
    }
    expect(fit.isFallback).toBe(false);
    expect(fit.near).toBeGreaterThan(0);
    expect(fit.near).toBeLessThan(fit.distance - fit.radius);
    expect(fit.minDistance).toBeLessThan(fit.distance);
    expect(fit.maxDistance).toBeGreaterThan(fit.distance);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['inverted', mm([10, 10, 10], [-10, -10, -10])],
    ['NaN', { min: [NaN, 0, 0], max: [1, 1, 1] } as Bounds3],
    ['infinite', { min: [-Infinity, 0, 0], max: [1, 1, 1] } as Bounds3],
  ])('falls back to the default volume for %s bounds', (_, bounds) => {
    const fit = fitCameraToBounds(bounds, { aspect: 1.5 });
    expect(fit.isFallback).toBe(true);
    expect(fit.bounds).toEqual(resolveBounds(FALLBACK_BOUNDS).bounds);
    for (const v of [...fit.position, ...fit.target, fit.distance, fit.near, fit.far]) expect(Number.isFinite(v)).toBe(true);
  });

  it('tolerates degenerate aspect ratios', () => {
    for (const aspect of [0, -1, NaN, Infinity]) {
      const fit = fitCameraToBounds(ROVER, { aspect });
      expect(Number.isFinite(fit.distance)).toBe(true);
      expect(fit.distance).toBeGreaterThan(0);
    }
  });

  it('is deterministic and does not mutate its input', () => {
    const input = Object.freeze({ min: Object.freeze([...ROVER.min]), max: Object.freeze([...ROVER.max]) }) as unknown as Bounds3;
    const a = fitCameraToBounds(input, { aspect: 1.6 });
    const b = fitCameraToBounds(input, { aspect: 1.6 });
    expect(a).toEqual(b);
    expect(input).toEqual(ROVER);
  });
});

describe('gridSpacingForRadius', () => {
  it('uses a 1-2-5 millimeter ladder with ten-cell sections', () => {
    const cases: Array<[number, number]> = [
      [0.0173, 0.002], // small part: 2 mm cells
      [0.17, 0.02], // rover: 20 mm cells
      [0.9, 0.1], // long beam: 100 mm cells
    ];
    for (const [radius, cell] of cases) {
      const spacing = gridSpacingForRadius(radius);
      expect(spacing.cell).toBeCloseTo(cell, 9);
      expect(spacing.section).toBeCloseTo(cell * 10, 9);
    }
  });
});
