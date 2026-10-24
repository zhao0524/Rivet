import type { Bounds3, ReadonlyVec3, Vec3 } from './units';
import { mmToScene } from './units';

export interface CameraView {
  /** Degrees around +Y, measured from +Z (rover front) toward +X. */
  azimuthDeg: number;
  /** Degrees above the ground plane. */
  elevationDeg: number;
}

/** Three-quarter front hero angle, slightly above the deck. */
export const DEFAULT_VIEW: CameraView = { azimuthDeg: 38, elevationDeg: 24 };
/** Vertical field of view; a mild telephoto keeps hardware proportions honest. */
export const STAGE_FOV_DEG = 30;
/** Fraction of each half-frame kept free around the fitted bounds. */
export const DEFAULT_PADDING = 0.16;
/** Smallest half-extent framed, in scene units (10 mm), so tiny parts never clip. */
export const MIN_HALF_EXTENT = mmToScene(10);
/** Bounds used when nothing measurable is on stage (a 300 x 120 x 300 mm volume). */
export const FALLBACK_BOUNDS: Bounds3 = {
  min: [mmToScene(-150), 0, mmToScene(-150)],
  max: [mmToScene(150), mmToScene(120), mmToScene(150)],
};

export interface CameraFitOptions {
  /** Vertical field of view in degrees. */
  fovDeg?: number;
  /** Viewport width / height. */
  aspect: number;
  view?: CameraView;
  padding?: number;
}

export interface CameraFit {
  position: Vec3;
  target: Vec3;
  distance: number;
  near: number;
  far: number;
  /** Bounding-sphere radius of the framed volume. */
  radius: number;
  minDistance: number;
  maxDistance: number;
  /** Framed volume after validation and minimum-size clamping. */
  bounds: Bounds3;
  /** True when the input bounds were empty or invalid and `FALLBACK_BOUNDS` was used. */
  isFallback: boolean;
}

export interface ResolvedBounds {
  bounds: Bounds3;
  isFallback: boolean;
}

export function isValidBounds(bounds: Bounds3 | null | undefined): bounds is Bounds3 {
  if (!bounds) return false;
  for (let i = 0; i < 3; i++) {
    const lo = bounds.min[i];
    const hi = bounds.max[i];
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return false;
  }
  return true;
}

/** Validates bounds and enforces `MIN_HALF_EXTENT`; invalid or empty input yields the fallback volume. */
export function resolveBounds(bounds: Bounds3 | null | undefined): ResolvedBounds {
  const source = isValidBounds(bounds) ? bounds : FALLBACK_BOUNDS;
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const half = Math.max((source.max[i] - source.min[i]) / 2, MIN_HALF_EXTENT);
    // Y grows upward from the true bottom so the floor stays under the object.
    const center = i === 1 ? source.min[1] + half : (source.min[i] + source.max[i]) / 2;
    min[i] = center - half;
    max[i] = center + half;
  }
  return { bounds: { min, max }, isFallback: source === FALLBACK_BOUNDS };
}

export function boundsCenter(bounds: Bounds3): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

export function boundsRadius(bounds: Bounds3): number {
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
}

export function boundsEqual(a: Bounds3 | null, b: Bounds3 | null, epsilon = 1e-6): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.min[i] - b.min[i]) > epsilon || Math.abs(a.max[i] - b.max[i]) > epsilon) return false;
  }
  return true;
}

/** Unit vector from the target toward the camera. */
export function viewDirection(view: CameraView): Vec3 {
  const az = (view.azimuthDeg * Math.PI) / 180;
  const el = (view.elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

function normalize(v: ReadonlyVec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Smallest camera distance at which every corner of `bounds` lies inside the
 * padded frustum for the given view direction, field of view and aspect ratio.
 * Each corner is expressed in the camera basis; the binding constraint is
 * whichever of the horizontal or vertical half-angles is tighter.
 */
export function fitCameraToBounds(input: Bounds3 | null | undefined, options: CameraFitOptions): CameraFit {
  const { bounds, isFallback } = resolveBounds(input);
  const fovDeg = options.fovDeg ?? STAGE_FOV_DEG;
  const aspect = Number.isFinite(options.aspect) && options.aspect > 0 ? options.aspect : 1;
  const padding = Math.min(Math.max(options.padding ?? DEFAULT_PADDING, 0), 0.45);
  const forward = normalize(viewDirection(options.view ?? DEFAULT_VIEW));

  const worldUp: Vec3 = Math.abs(forward[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const right = normalize(cross(worldUp, forward));
  const up = cross(forward, right);

  const tanV = Math.tan((fovDeg * Math.PI) / 360) * (1 - padding);
  const tanH = tanV * aspect;

  const center = boundsCenter(bounds);
  const radius = boundsRadius(bounds);

  let distance = 0;
  let nearestDepthOffset = -Infinity;
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      (i & 1 ? bounds.max[0] : bounds.min[0]) - center[0],
      (i & 2 ? bounds.max[1] : bounds.min[1]) - center[1],
      (i & 4 ? bounds.max[2] : bounds.min[2]) - center[2],
    ];
    const x = dot(corner, right);
    const y = dot(corner, up);
    const z = dot(corner, forward);
    distance = Math.max(distance, z + Math.abs(x) / tanH, z + Math.abs(y) / tanV);
    nearestDepthOffset = Math.max(nearestDepthOffset, z);
  }
  distance = Math.max(distance, nearestDepthOffset + radius * 0.5);

  const position: Vec3 = [
    center[0] + forward[0] * distance,
    center[1] + forward[1] * distance,
    center[2] + forward[2] * distance,
  ];
  const minDistance = Math.max(radius * 0.35, MIN_HALF_EXTENT);
  const maxDistance = distance * 3;
  const near = Math.max(radius * 0.005, 1e-4);
  const far = maxDistance + radius * 40;

  return { position, target: center, distance, near, far, radius, minDistance, maxDistance, bounds, isFallback };
}

/**
 * Grid spacing (scene units) on a 1-2-5 millimeter ladder so that roughly a
 * dozen cells span the framed radius; sections are ten cells.
 */
export function gridSpacingForRadius(radius: number): { cell: number; section: number } {
  const targetMm = Math.max((radius * 1000) / 12, 1);
  const exponent = Math.floor(Math.log10(targetMm));
  const base = 10 ** exponent;
  const step = [1, 2, 5, 10].map((m) => m * base).find((s) => s >= targetMm) ?? 10 * base;
  const cell = mmToScene(step);
  return { cell, section: cell * 10 };
}
