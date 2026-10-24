import { useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const cache = new Map<string, THREE.BufferGeometry>();

/** Returns a shared geometry for `key`, creating it once. */
export function cachedGeometry<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
  let g = cache.get(key) as T | undefined;
  if (!g) {
    g = create();
    g.name = `rivet-part:${key}`;
    cache.set(key, g);
  }
  return g;
}

export function useGeometry<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => cachedGeometry(key, create), [key]);
}

export function disposePartGeometries(): void {
  cache.forEach((g) => g.dispose());
  cache.clear();
}

const r = (n: number) => Math.round(n * 1000) / 1000;

/** Box with softened edges; radius is clamped to the smallest half-extent. */
export function roundedBox(w: number, h: number, d: number, radius: number, segments = 3): THREE.BufferGeometry {
  const rad = Math.max(0.01, Math.min(radius, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
  return cachedGeometry(`rbox:${r(w)}:${r(h)}:${r(d)}:${r(rad)}:${segments}`, () => new RoundedBoxGeometry(w, h, d, segments, rad));
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cachedGeometry(`box:${r(w)}:${r(h)}:${r(d)}`, () => new THREE.BoxGeometry(w, h, d));
}

/** Cylinder whose axis is local Y. */
export function cylinder(radiusTop: number, radiusBottom: number, height: number, segments = 32, open = false): THREE.BufferGeometry {
  return cachedGeometry(`cyl:${r(radiusTop)}:${r(radiusBottom)}:${r(height)}:${segments}:${open}`, () =>
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, open),
  );
}

export function sphere(radius: number, segments = 32): THREE.BufferGeometry {
  return cachedGeometry(`sph:${r(radius)}:${segments}`, () => new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.75)));
}

export function torus(radius: number, tube: number, radial = 12, tubular = 48): THREE.BufferGeometry {
  return cachedGeometry(`tor:${r(radius)}:${r(tube)}:${radial}:${tubular}`, () => new THREE.TorusGeometry(radius, tube, radial, tubular));
}

/** Lathe around local Y from a (radius, y) profile. */
export function lathe(key: string, profile: Array<[number, number]>, segments = 64): THREE.BufferGeometry {
  return cachedGeometry(`lathe:${key}:${segments}`, () =>
    new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments),
  );
}

/** Rounded-rectangle path centred on the origin. */
export function roundedRectPath(path: THREE.Path, w: number, h: number, radius: number, cx = 0, cy = 0): void {
  const rr = Math.min(radius, w / 2, h / 2);
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  path.moveTo(x0 + rr, y0);
  path.lineTo(x0 + w - rr, y0);
  path.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rr);
  path.lineTo(x0 + w, y0 + h - rr);
  path.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
  path.lineTo(x0 + rr, y0 + h);
  path.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr);
  path.lineTo(x0, y0 + rr);
  path.quadraticCurveTo(x0, y0, x0 + rr, y0);
}

export function circlePath(radius: number, cx: number, cy: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(cx, cy, radius, 0, Math.PI * 2, true);
  return p;
}

export function slotPath(length: number, width: number, cx: number, cy: number, vertical = false): THREE.Path {
  const p = new THREE.Path();
  const rr = width / 2;
  const half = length / 2 - rr;
  if (vertical) {
    p.absarc(cx, cy + half, rr, 0, Math.PI, false);
    p.absarc(cx, cy - half, rr, Math.PI, Math.PI * 2, false);
  } else {
    p.absarc(cx + half, cy, rr, -Math.PI / 2, Math.PI / 2, false);
    p.absarc(cx - half, cy, rr, Math.PI / 2, Math.PI * 1.5, false);
  }
  p.closePath();
  return p;
}

/**
 * Extrudes a plan-view shape (shape x → local x, shape y → local -z) upward along local Y,
 * occupying `[yBottom, yBottom + thickness]` with softened edges that stay inside the outline.
 */
export function plate(key: string, build: () => THREE.Shape, thickness: number, bevel = 0.6): THREE.BufferGeometry {
  return cachedGeometry(`plate:${key}:${r(thickness)}:${r(bevel)}`, () => {
    const b = Math.min(bevel, thickness / 2.5);
    const g = new THREE.ExtrudeGeometry(build(), {
      depth: Math.max(0.01, thickness - 2 * b),
      bevelEnabled: b > 0,
      bevelThickness: b,
      bevelSize: b,
      bevelOffset: -b,
      bevelSegments: 2,
      curveSegments: 18,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, b, 0);
    g.computeVertexNormals();
    return g;
  });
}
