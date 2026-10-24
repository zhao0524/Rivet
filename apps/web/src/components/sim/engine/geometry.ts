import type { Obstacle, Vec2 } from "./types";

const EPS = 1e-12;

export type Segment = readonly [Vec2, Vec2];

export function normalizeAngle(theta: number): number {
  const twoPi = 2 * Math.PI;
  let a = theta % twoPi;
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Distance along a unit-direction ray to segment [a, b], or null. Collinear overlap is ignored. */
export function raySegment(origin: Vec2, dir: Vec2, a: Vec2, b: Vec2): number | null {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denom = cross(dir.x, dir.y, sx, sy);
  if (Math.abs(denom) < EPS) return null;
  const qx = a.x - origin.x;
  const qy = a.y - origin.y;
  const t = cross(qx, qy, sx, sy) / denom;
  const u = cross(qx, qy, dir.x, dir.y) / denom;
  if (t < 0 || u < -1e-12 || u > 1 + 1e-12) return null;
  return t;
}

/** Distance along a unit-direction ray to a circle, 0 if the origin is inside, or null. */
export function rayCircle(origin: Vec2, dir: Vec2, center: Vec2, radius: number): number | null {
  const fx = origin.x - center.x;
  const fy = origin.y - center.y;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  const b = fx * dir.x + fy * dir.y;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export function obstacleSegments(obstacle: Obstacle): Segment[] {
  switch (obstacle.kind) {
    case "wall":
      return [[obstacle.start, obstacle.end]];
    case "box": {
      const { min, max } = obstacle;
      const p0 = { x: min.x, y: min.y };
      const p1 = { x: max.x, y: min.y };
      const p2 = { x: max.x, y: max.y };
      const p3 = { x: min.x, y: max.y };
      return [
        [p0, p1],
        [p1, p2],
        [p2, p3],
        [p3, p0],
      ];
    }
    case "polygon": {
      const pts = obstacle.points;
      const segs: Segment[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        segs.push([a, b]);
      }
      return segs;
    }
    case "circle":
      return [];
  }
}

export function pointInObstacle(p: Vec2, obstacle: Obstacle): boolean {
  switch (obstacle.kind) {
    case "circle": {
      const dx = p.x - obstacle.center.x;
      const dy = p.y - obstacle.center.y;
      return dx * dx + dy * dy <= obstacle.radius_m * obstacle.radius_m;
    }
    case "box":
      return p.x >= obstacle.min.x && p.x <= obstacle.max.x && p.y >= obstacle.min.y && p.y <= obstacle.max.y;
    case "polygon":
      return pointInPolygon(p, obstacle.points);
    case "wall":
      return false;
  }
}

export function pointInPolygon(p: Vec2, points: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function distancePointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** Ray hit distance against one obstacle (0 when the origin is inside a solid obstacle). */
export function rayObstacle(origin: Vec2, dir: Vec2, obstacle: Obstacle): number | null {
  if (obstacle.kind === "circle") return rayCircle(origin, dir, obstacle.center, obstacle.radius_m);
  if (pointInObstacle(origin, obstacle)) return 0;
  let best: number | null = null;
  for (const [a, b] of obstacleSegments(obstacle)) {
    const t = raySegment(origin, dir, a, b);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** True if a disc of `radius` at `center` penetrates the obstacle (touching is not overlap). */
export function circleOverlapsObstacle(center: Vec2, radius: number, obstacle: Obstacle, tolerance = 1e-9): boolean {
  if (obstacle.kind === "circle") {
    const d = Math.hypot(center.x - obstacle.center.x, center.y - obstacle.center.y);
    return d < radius + obstacle.radius_m - tolerance;
  }
  if (pointInObstacle(center, obstacle)) return true;
  for (const [a, b] of obstacleSegments(obstacle)) {
    if (distancePointSegment(center, a, b) < radius - tolerance) return true;
  }
  return false;
}

export function firstOverlap(center: Vec2, radius: number, obstacles: readonly Obstacle[]): Obstacle | null {
  for (const o of obstacles) {
    if (circleOverlapsObstacle(center, radius, o)) return o;
  }
  return null;
}

/** Four walls enclosing [minX, maxX] x [minY, maxY]; handy for bounded scenarios. */
export function arenaWalls(minX: number, minY: number, maxX: number, maxY: number, idPrefix = "arena"): Obstacle[] {
  return [
    { kind: "wall", id: `${idPrefix}-south`, start: { x: minX, y: minY }, end: { x: maxX, y: minY } },
    { kind: "wall", id: `${idPrefix}-east`, start: { x: maxX, y: minY }, end: { x: maxX, y: maxY } },
    { kind: "wall", id: `${idPrefix}-north`, start: { x: maxX, y: maxY }, end: { x: minX, y: maxY } },
    { kind: "wall", id: `${idPrefix}-west`, start: { x: minX, y: maxY }, end: { x: minX, y: minY } },
  ];
}
