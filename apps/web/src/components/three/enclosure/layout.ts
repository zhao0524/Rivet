/**
 * Printed body for a build: a 3D-printable shell that sits on the chassis deck and closes over the
 * electronics, plus printed standoffs so no board sits on nothing. It is derived from the plan's own
 * layout (poses and catalog dimensions), not drawn by hand, so every rover plan gets one that fits.
 *
 * Pure data, in plan millimetres (x right, y up, z forward). `geometry.ts` turns a spec into meshes.
 */
import type { CatalogComponent, PlanComponent } from '../../../lib/rivet/types';

export type Vec3 = [number, number, number];

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** A through-cut in the shell (a window, slot or hole), as a box in plan space. */
export interface EnclosureCutout extends Box {
  id: string;
  /** What the opening is for, in plain words. */
  label: string;
}

/** A printed standoff under a board, from the chassis deck up to the board. */
export interface EnclosurePost {
  id: string;
  /** The part this post holds up; it appears with that part. */
  forInstanceId: string;
  x: number;
  z: number;
  yBottom: number;
  yTop: number;
  radius: number;
}

/** Screw tab inside a bottom corner of the shell, with a hole for an M3 screw into the chassis. */
export interface EnclosureTab extends Box {
  id: string;
  holeRadius: number;
}

export interface EnclosureSpec {
  /** Stable for identical layouts; used to cache meshes. */
  key: string;
  /** Outer bounds of the shell. The bottom is open and rests on the chassis deck. */
  shell: Box;
  wall: number;
  /** Corner radius of the shell. */
  radius: number;
  /**
   * Sloped top edges that give the body its car profile: the hood at the front and the tail at the
   * back. Each is a plane across the full width through `edge` (on the end wall) and `roof`, as (z, y).
   */
  slopes: EnclosureSlope[];
  cutouts: EnclosureCutout[];
  tabs: EnclosureTab[];
  posts: EnclosurePost[];
}

/** Clearance between the shell's inside and any part. */
export const CLEARANCE_MM = 3;
/** Wall and roof thickness: three 0.8 mm perimeters on a 0.4 mm nozzle. */
export const WALL_MM = 2.4;
const ROOF_GAP_MM = 6;
const CUT_CLEARANCE_MM = 1.5;

/** Parts that move the robot or carry it: the shell goes around them, not over them. */
const OUTSIDE_ROLES = new Set(['chassis', 'wheel', 'caster', 'motor', 'accessory']);
/** Boards and packs that get printed standoffs when they sit above the deck. */
const POSTED_ROLES = new Set(['controller', 'motor_driver', 'distance_sensor', 'power_supply', 'motor_power', 'controller_power']);

const r1 = (n: number) => Math.round(n * 10) / 10;

function dims(catalogById: ReadonlyMap<string, CatalogComponent>, c: PlanComponent): Vec3 {
  const d = catalogById.get(c.catalog_id)?.physical?.dimensions_mm;
  const ok = (n: number | null | undefined, fallback: number) => (typeof n === 'number' && n > 0 ? n : fallback);
  return [ok(d?.x, 30), ok(d?.y, 20), ok(d?.z, 30)];
}

/** Turns a quarter-turn rotation into the axis swap it causes; other angles keep the extents. */
function rotateExtents([x, y, z]: Vec3, rotation: readonly number[]): Vec3 {
  let e: Vec3 = [x, y, z];
  const quarter = (deg: number) => Math.round(deg / 90) % 2 !== 0;
  if (quarter(rotation[0] ?? 0)) e = [e[0], e[2], e[1]];
  if (quarter(rotation[1] ?? 0)) e = [e[2], e[1], e[0]];
  if (quarter(rotation[2] ?? 0)) e = [e[1], e[0], e[2]];
  return e;
}

/**
 * Full extents as the part recipes draw them: wheels put their thinnest side across X (the axle),
 * gear motors run their long side along Z with the shaft across X; everything else follows its pose.
 */
export function orientedExtents(c: PlanComponent, catalogById: ReadonlyMap<string, CatalogComponent>): Vec3 {
  const d = dims(catalogById, c);
  const sorted = [...d].sort((a, b) => a - b) as Vec3;
  if (c.role === 'wheel') return [sorted[0], sorted[2], sorted[2]];
  if (c.role === 'motor') return [sorted[0], sorted[1], sorted[2]];
  return rotateExtents(d, c.pose.rotation_deg);
}

export function partBox(c: PlanComponent, catalogById: ReadonlyMap<string, CatalogComponent>): Box {
  const e = orientedExtents(c, catalogById);
  const p = c.pose.position_mm;
  return {
    min: [p[0] - e[0] / 2, p[1] - e[1] / 2, p[2] - e[2] / 2],
    max: [p[0] + e[0] / 2, p[1] + e[1] / 2, p[2] + e[2] / 2],
  };
}

function union(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  return { min, max };
}

function overlaps(a: Box, b: Box, pad = 0): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.max[i] + pad <= b.min[i] || b.max[i] + pad <= a.min[i]) return false;
  }
  return true;
}

export interface EnclosureSlope {
  id: 'hood' | 'tail';
  edge: [number, number];
  roof: [number, number];
}

/** Height of a slope at depth `z`, or Infinity where it does not reach. */
export function slopeHeightAt(slope: EnclosureSlope, z: number): number {
  const [ze, ye] = slope.edge;
  const [zr, yr] = slope.roof;
  const t = (z - zr) / (ze - zr);
  if (t <= 0) return Infinity;
  return yr + (ye - yr) * t;
}

/** How high the body's top is at depth `z`: the roof, or lower where a slope cuts it. */
export function topHeightAt(spec: Pick<EnclosureSpec, 'shell' | 'slopes'>, z: number): number {
  return Math.min(spec.shell.max[1], ...spec.slopes.map((s) => slopeHeightAt(s, z)));
}

/**
 * The printed body for a plan, or null when the plan has no chassis to sit on.
 * Parts fully inside the chassis (under its top deck) are already enclosed and are left alone.
 */
export function computeEnclosure(
  components: readonly PlanComponent[],
  catalog: readonly CatalogComponent[],
): EnclosureSpec | null {
  const catalogById = new Map(catalog.map((c) => [c.catalog_id, c]));
  const shown = components.filter((c) => c.render_overrides?.visible !== false);
  const chassis = shown.find((c) => c.role === 'chassis');
  if (!chassis) return null;
  const deck = partBox(chassis, catalogById);
  const yBottom = deck.max[1];

  const boxes = new Map(shown.map((c) => [c.instance_id, partBox(c, catalogById)]));
  const inside = shown.filter((c) => !OUTSIDE_ROLES.has(c.role) && boxes.get(c.instance_id)!.max[1] > yBottom + 0.5);
  if (!inside.length) return null;
  const sensors = inside.filter((c) => c.role === 'distance_sensor');
  const others = inside.filter((c) => c.role !== 'distance_sensor');
  const all = union(inside.map((c) => boxes.get(c.instance_id)!))!;
  const rest = union(others.map((c) => boxes.get(c.instance_id)!)) ?? all;

  const cx = (deck.min[0] + deck.max[0]) / 2;
  const wheels = shown.filter((c) => c.role === 'wheel').map((c) => boxes.get(c.instance_id)!);
  const wheelInner = wheels.length ? Math.min(...wheels.map((b) => Math.min(Math.abs(b.min[0] - cx), Math.abs(b.max[0] - cx)))) : Infinity;
  const needHalfX = Math.max(Math.abs(all.min[0] - cx), Math.abs(all.max[0] - cx)) + CLEARANCE_MM + WALL_MM;
  const halfX = Math.max(needHalfX, Math.min((deck.max[0] - deck.min[0]) / 2, wheelInner - CLEARANCE_MM));

  const sensorFront = sensors.length ? Math.max(...sensors.map((c) => boxes.get(c.instance_id)!.max[2])) : -Infinity;
  const zMax = Math.max(deck.max[2], rest.max[2] + CLEARANCE_MM + WALL_MM, sensorFront - 0.5);
  const zMin = Math.min(deck.min[2], all.min[2] - CLEARANCE_MM - WALL_MM);
  const yTop = all.max[1] + ROOF_GAP_MM;

  const shell: Box = { min: [cx - halfX, yBottom, zMin], max: [cx + halfX, yTop, zMax] };
  const height = yTop - yBottom;
  const radius = Math.min(10, height / 3.5, halfX / 4);

  // Car profile: the longest hood and tail slopes that keep every part under them with clearance.
  const sensorTop = sensors.length ? Math.max(...sensors.map((c) => boxes.get(c.instance_id)!.max[1])) : yBottom;
  const length = zMax - zMin;
  const clearUnder = (slope: EnclosureSlope) =>
    inside.every((c) => {
      const b = boxes.get(c.instance_id)!;
      const need = b.max[1] + CLEARANCE_MM + WALL_MM;
      return need <= slopeHeightAt(slope, b.min[2]) && need <= slopeHeightAt(slope, b.max[2]);
    });
  /** The longest slope up to `angle` degrees steep (shallower reads as flat) that clears every part. */
  const longest = (id: EnclosureSlope['id'], edgeZ: number, edgeY: number, dir: 1 | -1, angle: number, maxLen: number, minLen: number) => {
    if (edgeY >= yTop - 4) return null;
    const cap = Math.min(maxLen, (yTop - edgeY) / Math.tan((angle * Math.PI) / 180));
    for (let len = cap; len >= minLen; len -= 2.5) {
      const slope: EnclosureSlope = { id, edge: [edgeZ, edgeY], roof: [edgeZ - dir * len, yTop] };
      if (clearUnder(slope)) return slope;
    }
    return null;
  };
  const slopes = [
    longest('hood', zMax, Math.max(sensorTop + CLEARANCE_MM + WALL_MM + 0.5, yBottom + height * 0.4), 1, 18, length * 0.55, 10),
    longest('tail', zMin, yBottom + height * 0.6, -1, 35, length * 0.22, 8),
  ].filter((s): s is EnclosureSlope => s !== null);

  const cutouts: EnclosureCutout[] = [];
  const through = WALL_MM + 2;

  // Sensor windows through the front wall.
  for (const s of sensors) {
    const b = boxes.get(s.instance_id)!;
    cutouts.push({
      id: `window-${s.instance_id}`,
      label: 'Window for the distance sensor',
      min: [b.min[0] - CUT_CLEARANCE_MM, Math.max(yBottom - 1, b.min[1] - CUT_CLEARANCE_MM), Math.min(b.min[2], zMax - through)],
      max: [b.max[0] + CUT_CLEARANCE_MM, b.max[1] + CUT_CLEARANCE_MM, zMax + 1],
    });
  }

  // Axles: where a motor reaches the side wall, cut its outline; otherwise a hole for the shaft.
  for (const m of shown.filter((c) => c.role === 'motor')) {
    const b = boxes.get(m.instance_id)!;
    if (b.max[1] <= yBottom) continue;
    const right = (b.min[0] + b.max[0]) / 2 >= cx;
    const wallIn = right ? shell.max[0] - WALL_MM : shell.min[0] + WALL_MM;
    const reaches = right ? b.max[0] > wallIn - 0.5 : b.min[0] < wallIn + 0.5;
    const xs: [number, number] = right ? [shell.max[0] - through, shell.max[0] + 1] : [shell.min[0] - 1, shell.min[0] + through];
    if (reaches) {
      cutouts.push({
        id: `axle-${m.instance_id}`,
        label: 'Opening for the motor',
        min: [xs[0], Math.max(yBottom - 1, b.min[1] - CUT_CLEARANCE_MM), b.min[2] - CUT_CLEARANCE_MM],
        max: [xs[1], b.max[1] + CUT_CLEARANCE_MM, b.max[2] + CUT_CLEARANCE_MM],
      });
    } else {
      const yc = (b.min[1] + b.max[1]) / 2;
      const zc = (b.min[2] + b.max[2]) / 2;
      cutouts.push({
        id: `axle-${m.instance_id}`,
        label: 'Hole for the wheel shaft',
        min: [xs[0], Math.max(yBottom - 1, yc - 4.5), zc - 4.5],
        max: [xs[1], yc + 4.5, zc + 4.5],
      });
    }
  }

  // A slot in the back for the USB cable and the power switch.
  const controller = inside.find((c) => c.role === 'controller');
  const slotX = controller ? (boxes.get(controller.instance_id)!.min[0] + boxes.get(controller.instance_id)!.max[0]) / 2 : cx;
  const slotHalf = Math.min(9, halfX - WALL_MM - radius);
  cutouts.push({
    id: 'cable-slot',
    label: 'Slot for the USB cable and power switch',
    min: [Math.max(shell.min[0] + radius, slotX - slotHalf), yBottom - 1, zMin - 1],
    max: [Math.min(shell.max[0] - radius, slotX + slotHalf), yBottom + Math.min(10, height * 0.4), zMin + through],
  });

  // Vents in the roof over the motor driver, which runs warm.
  const driver = inside.find((c) => c.role === 'motor_driver');
  if (driver) {
    const b = boxes.get(driver.instance_id)!;
    const zc = (b.min[2] + b.max[2]) / 2;
    const xc = (b.min[0] + b.max[0]) / 2;
    for (let i = -1; i <= 1; i++) {
      cutouts.push({
        id: `vent-${i + 1}`,
        label: 'Vent over the motor driver',
        min: [xc - 1.25 + i * 5, yTop - through, zc - 7],
        max: [xc + 1.25 + i * 5, yTop + 1, zc + 7],
      });
    }
  }

  // Screw tabs in the four bottom corners, clear of every part.
  const tabs: EnclosureTab[] = [];
  const tabSize = 9;
  const inset = WALL_MM - 0.2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x0 = sx < 0 ? shell.min[0] + inset : shell.max[0] - inset - tabSize;
    const z0 = sz < 0 ? shell.min[2] + inset : shell.max[2] - inset - tabSize;
    const tab: EnclosureTab = {
      id: `tab-${sx < 0 ? 'left' : 'right'}-${sz < 0 ? 'rear' : 'front'}`,
      min: [x0, yBottom, z0],
      max: [x0 + tabSize, yBottom + 4, z0 + tabSize],
      holeRadius: 1.6,
    };
    const blocked = [...boxes.entries()].some(([id, b]) => id !== chassis.instance_id && overlaps(tab, b)) ||
      cutouts.some((c) => overlaps(tab, c));
    if (!blocked) tabs.push(tab);
  }

  // Standoffs: four per board that sits above the deck, skipping any that would run into a part.
  const posts: EnclosurePost[] = [];
  for (const c of inside) {
    if (!POSTED_ROLES.has(c.role)) continue;
    const b = boxes.get(c.instance_id)!;
    const gap = b.min[1] - yBottom;
    if (gap < 2) continue;
    const w = b.max[0] - b.min[0];
    const d = b.max[2] - b.min[2];
    const radius = Math.min(2.2, w / 6, d / 6);
    const ix = Math.min(3, w / 4);
    const iz = Math.min(3, d / 4);
    for (const [px, pz, corner] of [
      [b.min[0] + ix, b.min[2] + iz, 'a'],
      [b.max[0] - ix, b.min[2] + iz, 'b'],
      [b.min[0] + ix, b.max[2] - iz, 'c'],
      [b.max[0] - ix, b.max[2] - iz, 'd'],
    ] as const) {
      const column: Box = { min: [px - radius, yBottom, pz - radius], max: [px + radius, b.min[1], pz + radius] };
      const hits = [...boxes.entries()].some(([id, o]) => id !== c.instance_id && id !== chassis.instance_id && overlaps(column, o, -0.01));
      if (hits) continue;
      posts.push({ id: `post-${c.instance_id}-${corner}`, forInstanceId: c.instance_id, x: px, z: pz, yBottom, yTop: b.min[1], radius });
    }
  }

  const key = JSON.stringify({ shell, radius, slopes, cutouts, tabs, posts }, (_k, v: unknown) => (typeof v === 'number' ? r1(v) : v));
  return { key, shell, wall: WALL_MM, radius, slopes, cutouts, tabs, posts };
}
