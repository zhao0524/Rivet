import * as THREE from 'three';

/** Builds a closed path through plan-view points (x, z) with every corner rounded. Shape y = -z. */
export function roundedPolygon<T extends THREE.Path>(target: T, points: ReadonlyArray<[number, number]>, radius: number): T {
  const pts = points.map(([x, z]) => new THREE.Vector2(x, -z));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const toPrev = prev.clone().sub(cur);
    const toNext = next.clone().sub(cur);
    const rr = Math.min(radius, toPrev.length() / 2, toNext.length() / 2);
    const a = cur.clone().add(toPrev.normalize().multiplyScalar(rr));
    const b = cur.clone().add(toNext.normalize().multiplyScalar(rr));
    if (i === 0) target.moveTo(a.x, a.y);
    else target.lineTo(a.x, a.y);
    target.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  target.closePath();
  return target;
}

export function holeAt(x: number, z: number, radius: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(x, -z, radius, 0, Math.PI * 2, true);
  return p;
}

/** Stadium slot in plan view; `alongZ` orients the long axis front-to-back. */
export function slotAt(x: number, z: number, length: number, width: number, alongZ: boolean): THREE.Path {
  const p = new THREE.Path();
  const rr = width / 2;
  const half = Math.max(0, length / 2 - rr);
  const cy = -z;
  if (alongZ) {
    p.absarc(x, cy + half, rr, 0, Math.PI, false);
    p.absarc(x, cy - half, rr, Math.PI, Math.PI * 2, false);
  } else {
    p.absarc(x + half, cy, rr, -Math.PI / 2, Math.PI / 2, false);
    p.absarc(x - half, cy, rr, Math.PI / 2, Math.PI * 1.5, false);
  }
  p.closePath();
  return p;
}
