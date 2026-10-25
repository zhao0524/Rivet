import type { SandboxPart, Vec3Mm } from "./types";

type Extent = { min: Vec3Mm; max: Vec3Mm };

/** Half extents after a quarter-turn rotation: 90/270 degrees swap the two axes perpendicular to the turn. */
function rotatedSize(part: SandboxPart): Vec3Mm {
  let [x, y, z] = part.size_mm;
  const [rx, ry, rz] = (part.rotation_deg ?? [0, 0, 0]).map((d) => Math.round(Math.abs(d)) % 180);
  if (rx === 90) [y, z] = [z, y];
  if (ry === 90) [x, z] = [z, x];
  if (rz === 90) [x, y] = [y, x];
  return [x, y, z];
}

/** Axis-aligned bounds of a part's placed shape (exact for box/cylinder/sphere at quarter-turn rotations). */
export function partExtentMm(part: SandboxPart): Extent {
  const [sx, sy, sz] = rotatedSize(part);
  const [px, py, pz] = part.position_mm;
  return { min: [px - sx / 2, py - sy / 2, pz - sz / 2], max: [px + sx / 2, py + sy / 2, pz + sz / 2] };
}

/** Bounds of the whole product, or of just `only` when given. */
export function productBoundsMm(parts: readonly SandboxPart[], only?: ReadonlySet<string>): Extent {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    if (only && !only.has(part.part_id)) continue;
    const e = partExtentMm(part);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], e.min[i]);
      max[i] = Math.max(max[i], e.max[i]);
    }
  }
  if (!Number.isFinite(min[0])) return { min: [-50, 0, -50], max: [50, 50, 50] };
  return { min, max };
}

export function boundsCenterMm(b: Extent): Vec3Mm {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/**
 * Explode offset for every part at full spread: straight away from the product centre, so the product
 * opens up the way it is built. A part at the centre rises instead. Spread scales with the product.
 */
export function explodeOffsetsMm(parts: readonly SandboxPart[]): Record<string, Vec3Mm> {
  const bounds = productBoundsMm(parts);
  const centre = boundsCenterMm(bounds);
  const span = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2], 1);
  const out: Record<string, Vec3Mm> = {};
  for (const part of parts) {
    const dx = part.position_mm[0] - centre[0];
    const dy = part.position_mm[1] - centre[1];
    const dz = part.position_mm[2] - centre[2];
    const len = Math.hypot(dx, dy, dz);
    const k = span * 0.45;
    out[part.part_id] = len < 1e-6 ? [0, k, 0] : [(dx / len) * k, (dy / len) * k, (dz / len) * k];
  }
  return out;
}
