import type {
  AssemblyComponent,
  AssemblyDiagnostics,
  AssemblyPlan,
  AssemblyStepSummary,
  Dimensions,
  DimensionsByCatalogId,
  Vec3,
} from './types';

/**
 * Precomputed, plan-derived data: hierarchy, full explode offsets and the step
 * schedule. Everything here is a pure function of the plan (and optional catalog
 * dimensions); the plan is only read, never written.
 */
export interface AssemblyModel {
  readonly components: readonly AssemblyComponent[];
  readonly parentOf: Readonly<Record<string, string | null>>;
  /** Offset at explode progress = 1, keyed by instance_id. */
  readonly explodeOffsets: Readonly<Record<string, Vec3>>;
  readonly steps: readonly AssemblyStepSummary[];
  /** Timeline index (1-based) of the first step that references the instance. */
  readonly firstStepIndex: Readonly<Record<string, number | null>>;
  readonly diagnostics: AssemblyDiagnostics;
}

export interface AssemblyModelOptions {
  readonly dimensionsByCatalogId?: DimensionsByCatalogId;
  /** Separation gap as a fraction of the model's largest extent. Default 0.08. */
  readonly gapFraction?: number;
}

const ZERO: Vec3 = [0, 0, 0];
const FALLBACK_HALF_MM = 10;
const MIN_GAP_MM = 4;

type MutVec3 = [number, number, number];

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
const FORWARD: Vec3 = [0, 0, 1];

const UP_ROLES = new Set([
  'controller',
  'motor_driver',
  'power_supply',
  'motor_power',
  'controller_power',
  'battery',
  'board',
  'switch',
  'electronics',
]);
const LATERAL_ROLES = new Set(['wheel', 'motor', 'bracket', 'motor_bracket']);
const DOWN_ROLES = new Set(['caster']);
const FORWARD_ROLES = new Set(['distance_sensor', 'sensor', 'range_sensor', 'bumper']);

function vec(p: readonly number[] | undefined): Vec3 {
  const x = Number(p?.[0]);
  const y = Number(p?.[1]);
  const z = Number(p?.[2]);
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function normalize(a: Vec3): Vec3 | null {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 1e-9 ? [a[0] / len, a[1] / len, a[2] / len] : null;
}

/** Snap a radial direction to its dominant axis so explode motion reads cleanly. */
function dominantAxis(a: Vec3): Vec3 | null {
  const ax = Math.abs(a[0]);
  const ay = Math.abs(a[1]);
  const az = Math.abs(a[2]);
  const max = Math.max(ax, ay, az);
  if (max < 1e-9) return null;
  if (max === ax) return [Math.sign(a[0]), 0, 0];
  if (max === ay) return [0, Math.sign(a[1]), 0];
  return [0, 0, Math.sign(a[2])];
}

function halfExtents(c: AssemblyComponent, dims: DimensionsByCatalogId | undefined): Vec3 {
  const d: Dimensions | null | undefined = dims?.[c.catalog_id];
  const ok = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0;
  const h: MutVec3 = [
    ok(d?.x) ? d.x / 2 : FALLBACK_HALF_MM,
    ok(d?.y) ? d.y / 2 : FALLBACK_HALF_MM,
    ok(d?.z) ? d.z / 2 : FALLBACK_HALF_MM,
  ];
  const rot = vec(c.pose?.rotation_deg);
  if (!rot.some((r) => Math.abs(r % 360) > 1e-6)) return h;
  // Exact axis-aligned envelope of the rotated box: |R| * h, with R from XYZ Euler
  // degrees (the renderer's order). Mirrored left/right parts get identical envelopes.
  const [rx, ry, rz] = rot.map((deg) => (deg * Math.PI) / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const m = [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * cz * sy, cx * cz - sx * sz * sy, -sx * cy],
    [sx * sz - cx * cz * sy, sx * cz + cx * sz * sy, cx * cy],
  ];
  return m.map((row) => Math.abs(row[0]) * h[0] + Math.abs(row[1]) * h[1] + Math.abs(row[2]) * h[2]) as MutVec3;
}

const halfAlong = (h: Vec3, dir: Vec3): number =>
  Math.abs(dir[0]) * h[0] + Math.abs(dir[1]) * h[1] + Math.abs(dir[2]) * h[2];

function aabbOverlap(ca: Vec3, ha: Vec3, cb: Vec3, hb: Vec3, pad: number): boolean {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ca[i] - cb[i]) >= ha[i] + hb[i] + pad) return false;
  }
  return true;
}

function roleDirection(role: string, rel: Vec3): Vec3 {
  const r = role.toLowerCase();
  if (UP_ROLES.has(r)) return UP;
  if (DOWN_ROLES.has(r)) return DOWN;
  if (FORWARD_ROLES.has(r)) return FORWARD;
  if (LATERAL_ROLES.has(r) && Math.abs(rel[0]) > 1e-9) return [Math.sign(rel[0]), 0, 0];
  return dominantAxis(rel) ?? UP;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function createAssemblyModel(
  plan: AssemblyPlan,
  options: AssemblyModelOptions = {},
): AssemblyModel {
  const dims = options.dimensionsByCatalogId;
  const gapFraction = options.gapFraction ?? 0.08;

  // Unique components, first occurrence wins.
  const components: AssemblyComponent[] = [];
  const index = new Map<string, AssemblyComponent>();
  const duplicateIds = new Set<string>();
  for (const c of plan.components ?? []) {
    if (!c || typeof c.instance_id !== 'string') continue;
    if (index.has(c.instance_id)) {
      duplicateIds.add(c.instance_id);
      continue;
    }
    index.set(c.instance_id, c);
    components.push(c);
  }

  // Parent resolution with cycle protection.
  const unresolvedParents: { instance_id: string; parent_instance_id: string }[] = [];
  const declaredParent: Record<string, string | null> = {};
  for (const c of components) {
    const p = c.parent_instance_id;
    if (p == null) declaredParent[c.instance_id] = null;
    else if (p === c.instance_id || !index.has(p)) {
      declaredParent[c.instance_id] = null;
      unresolvedParents.push({ instance_id: c.instance_id, parent_instance_id: p });
    } else declaredParent[c.instance_id] = p;
  }
  const parentOf: Record<string, string | null> = {};
  for (const c of components) {
    const seen = new Set<string>([c.instance_id]);
    let p = declaredParent[c.instance_id];
    let cyclic = false;
    while (p != null) {
      if (seen.has(p)) {
        cyclic = true;
        break;
      }
      seen.add(p);
      p = declaredParent[p];
    }
    parentOf[c.instance_id] = cyclic ? null : declaredParent[c.instance_id];
    if (cyclic && c.parent_instance_id != null) {
      unresolvedParents.push({ instance_id: c.instance_id, parent_instance_id: c.parent_instance_id });
    }
  }

  // Primary root: first component with a declared null parent. Orphans/extra roots
  // explode relative to it so they still separate from the main body.
  const roots = components.filter((c) => parentOf[c.instance_id] == null);
  const primary = roots.find((c) => c.parent_instance_id == null) ?? roots[0];
  const explodeParent: Record<string, string | null> = {};
  for (const c of components) {
    const p = parentOf[c.instance_id];
    explodeParent[c.instance_id] =
      p ?? (primary && c.instance_id !== primary.instance_id ? primary.instance_id : null);
  }

  const position: Record<string, Vec3> = {};
  const half: Record<string, Vec3> = {};
  for (const c of components) {
    position[c.instance_id] = vec(c.pose?.position_mm);
    half[c.instance_id] = halfExtents(c, dims);
  }

  // Model bounds drive the separation gap. Never-rendered kit items (e.g. a 3 ft
  // cable) are excluded so they cannot inflate the gap of the visible assembly.
  const rendered = components.filter((c) => c.render_overrides?.visible !== false);
  let extent = 0;
  if (rendered.length) {
    const lo: MutVec3 = [Infinity, Infinity, Infinity];
    const hi: MutVec3 = [-Infinity, -Infinity, -Infinity];
    for (const c of rendered) {
      const p = position[c.instance_id];
      const h = half[c.instance_id];
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], p[i] - h[i]);
        hi[i] = Math.max(hi[i], p[i] + h[i]);
      }
    }
    extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  }
  const gap = Math.max(extent * gapFraction, MIN_GAP_MM);

  // Children grouped by explode parent, processed parents-first.
  const children = new Map<string, AssemblyComponent[]>();
  for (const c of components) {
    const p = explodeParent[c.instance_id];
    if (p == null) continue;
    const list = children.get(p) ?? [];
    list.push(c);
    children.set(p, list);
  }

  const explodeOffsets: Record<string, Vec3> = {};
  const queue: string[] = [];
  for (const c of components) {
    if (explodeParent[c.instance_id] == null) {
      explodeOffsets[c.instance_id] = ZERO;
      queue.push(c.instance_id);
    }
  }
  while (queue.length) {
    const parentId = queue.shift() as string;
    const kids = children.get(parentId);
    if (!kids) continue;
    const parentPos = position[parentId];
    const parentHalf = half[parentId];

    // Local placement in the parent's frame (relative to parent center).
    const entries = kids.map((c) => {
      const rel = sub(position[c.instance_id], parentPos);
      const dir = roleDirection(c.role ?? '', rel);
      return { c, rel, dir, proj: dot(rel, dir) };
    });
    entries.sort((a, b) => a.proj - b.proj || byId(a.c.instance_id, b.c.instance_id));

    const placed: { center: Vec3; half: Vec3 }[] = [];
    for (const e of entries) {
      // Never-rendered parts (loose kit items) ride with their parent and take no
      // space, so they cannot push visible siblings away.
      if (e.c.render_overrides?.visible === false) {
        explodeOffsets[e.c.instance_id] = explodeOffsets[parentId] ?? ZERO;
        queue.push(e.c.instance_id);
        continue;
      }
      const h = half[e.c.instance_id];
      const selfHalf = halfAlong(h, e.dir);
      // Clear the parent envelope, and always travel at least one gap so parts that
      // already sit at the periphery (wheels, front sensor) still visibly separate.
      let t = Math.max(e.proj + gap, halfAlong(parentHalf, e.dir) + gap + selfHalf);
      const at = (tt: number): Vec3 => add(e.rel, scale(e.dir, tt - e.proj));
      // Push outward past any already-placed sibling it would overlap.
      for (let guard = 0; guard <= placed.length; guard++) {
        let moved = false;
        for (const p of placed) {
          if (aabbOverlap(at(t), h, p.center, p.half, gap / 4)) {
            const pt = dot(p.center, e.dir);
            t = Math.max(t, pt + halfAlong(p.half, e.dir) + gap + selfHalf);
            moved = true;
          }
        }
        if (!moved) break;
      }
      placed.push({ center: at(t), half: h });
      const local = scale(e.dir, t - e.proj);
      explodeOffsets[e.c.instance_id] = add(explodeOffsets[parentId] ?? ZERO, local);
      queue.push(e.c.instance_id);
    }
  }
  for (const c of components) explodeOffsets[c.instance_id] ??= ZERO;

  // Step schedule from the real assembly_steps, ordered by `step` number.
  const rawSteps = (plan.assembly_steps ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s != null)
    .sort((a, b) => (a.s.step ?? 0) - (b.s.step ?? 0) || a.i - b.i);

  const firstStepIndex: Record<string, number | null> = {};
  for (const c of components) firstStepIndex[c.instance_id] = null;
  const missing: { step: number; instance_id: string }[] = [];
  const steps: AssemblyStepSummary[] = rawSteps.map(({ s }, i) => {
    const idx = i + 1;
    const ids: string[] = [];
    const added: string[] = [];
    const seen = new Set<string>();
    for (const id of s.instance_ids ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (!index.has(id)) {
        missing.push({ step: s.step, instance_id: id });
        continue;
      }
      ids.push(id);
      if (firstStepIndex[id] == null) {
        firstStepIndex[id] = idx;
        added.push(id);
      }
    }
    return {
      index: idx,
      step: s.step,
      title: s.title ?? '',
      instance_ids: ids,
      added_instance_ids: added,
    };
  });

  return {
    components,
    parentOf,
    explodeOffsets,
    steps,
    firstStepIndex,
    diagnostics: {
      missing_instance_ids: missing,
      unscheduled_instance_ids: components
        .filter((c) => firstStepIndex[c.instance_id] == null)
        .map((c) => c.instance_id),
      duplicate_component_ids: [...duplicateIds],
      unresolved_parent_ids: unresolvedParents,
    },
  };
}
