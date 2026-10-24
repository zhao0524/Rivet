import { useMemo } from 'react';
import { Instances, rowX, type InstanceTransform } from '../Instances';
import { box, cylinder, roundedBox } from '../geometry';
import { useMat } from '../materials';
import type { Size3, Vec3 } from '../types';

export const PITCH = 2.54;
export const PCB_T = 1.6;

/** Boards are authored with their long edge on local X; returns the yaw that maps that frame to catalog axes. */
export function boardFrame(size: Size3): { length: number; width: number; height: number; yaw: number } {
  const alongX = size.x >= size.z;
  return {
    length: alongX ? size.x : size.z,
    width: alongX ? size.z : size.x,
    height: size.y,
    yaw: alongX ? 0 : Math.PI / 2,
  };
}

interface BoardBlankProps {
  length: number;
  width: number;
  top: number;
  color: string;
  corner?: number;
}

export function BoardBlank({ length, width, top, color, corner = 1.2 }: BoardBlankProps) {
  const mask = useMat('pcb', color);
  return <mesh geometry={roundedBox(length, PCB_T, width, Math.min(corner, 0.7), 2)} material={mask} position={[0, top - PCB_T / 2, 0]} />;
}

interface HeaderRowProps {
  count: number;
  cx: number;
  z: number;
  pcbTop: number;
  bottom: number;
  housingHeight?: number;
}

/** Male 0.1" header soldered through the board, pins pointing down (local -Y). */
export function HeaderRow({ count, cx, z, pcbTop, bottom, housingHeight = 2.5 }: HeaderRowProps) {
  const plastic = useMat('blackPlastic');
  const gold = useMat('gold');
  const tin = useMat('tin');
  const pcbBottom = pcbTop - PCB_T;
  const housingY = pcbBottom - housingHeight / 2;
  const pinTop = pcbTop + 0.9;
  const pinLen = pinTop - bottom;
  const housings = useMemo(() => rowX(count, PITCH, cx, housingY, z), [count, cx, housingY, z]);
  const pins = useMemo(() => rowX(count, PITCH, cx, bottom + pinLen / 2, z), [count, cx, bottom, pinLen, z]);
  const pads = useMemo(() => rowX(count, PITCH, cx, pcbTop + 0.04, z), [count, cx, pcbTop, z]);
  const joints = useMemo(() => rowX(count, PITCH, cx, pcbTop + 0.35, z), [count, cx, pcbTop, z]);
  return (
    <group name="header">
      <Instances name="header-housing" geometry={roundedBox(PITCH - 0.08, housingHeight, PITCH - 0.05, 0.25, 1)} material={plastic} transforms={housings} />
      <Instances name="header-pins" geometry={box(0.64, pinLen, 0.64)} material={gold} transforms={pins} />
      <Instances name="header-pads" geometry={cylinder(0.95, 0.95, 0.08, 16)} material={gold} transforms={pads} />
      <Instances name="header-joints" geometry={cylinder(0.38, 0.85, 0.7, 12)} material={tin} transforms={joints} />
    </group>
  );
}

/** Plated mounting hole: gold annulus with a dark core. */
export function PlatedHole({ x, z, top, radius = 1.6 }: { x: number; z: number; top: number; radius?: number }) {
  const gold = useMat('gold');
  const hole = useMat('hole');
  return (
    <group position={[x, top, z]}>
      <mesh geometry={cylinder(radius + 0.7, radius + 0.7, 0.06, 28)} material={gold} position={[0, 0.03, 0]} />
      <mesh geometry={cylinder(radius, radius, PCB_T + 0.14, 24)} material={hole} position={[0, -PCB_T / 2, 0]} />
    </group>
  );
}

interface PassivesProps {
  positions: readonly Vec3[];
  rotations?: readonly number[];
  size?: [number, number, number];
  bodyKind?: 'ceramic' | 'epoxy';
}

/** 0603/0805-style SMD passives with tinned end caps. */
export function Passives({ positions, rotations, size = [1.6, 0.55, 0.8], bodyKind = 'ceramic' }: PassivesProps) {
  const body = useMat(bodyKind);
  const tin = useMat('tin');
  const [l, h, w] = size;
  const bodies = useMemo<InstanceTransform[]>(
    () => positions.map((p, i) => ({ p: [p[0], p[1] + h / 2, p[2]], r: [0, rotations?.[i] ?? 0, 0] })),
    [positions, rotations, h],
  );
  const caps = useMemo<InstanceTransform[]>(
    () =>
      positions.flatMap((p, i) => {
        const a = rotations?.[i] ?? 0;
        const dx = Math.cos(a) * (l / 2 - 0.15);
        const dz = -Math.sin(a) * (l / 2 - 0.15);
        return [
          { p: [p[0] + dx, p[1] + h / 2, p[2] + dz] as Vec3, r: [0, a, 0] as Vec3 },
          { p: [p[0] - dx, p[1] + h / 2, p[2] - dz] as Vec3, r: [0, a, 0] as Vec3 },
        ];
      }),
    [positions, rotations, l, h],
  );
  return (
    <group name="passives">
      <Instances geometry={box(l - 0.5, h, w)} material={body} transforms={bodies} />
      <Instances geometry={box(0.32, h + 0.04, w + 0.04)} material={tin} transforms={caps} />
    </group>
  );
}

/** Thin raised copper runs under the solder mask (cosmetic only). */
export function Traces({ segments, top, color }: { segments: ReadonlyArray<[number, number, number, number]>; top: number; color: string }) {
  const mat = useMat('pcb', color);
  const transforms = useMemo<InstanceTransform[]>(
    () =>
      segments.map(([x0, z0, x1, z1]) => {
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        return { p: [(x0 + x1) / 2, top + 0.02, (z0 + z1) / 2], r: [0, -Math.atan2(dz, dx), 0], s: [len, 1, 1] };
      }),
    [segments, top],
  );
  return <Instances name="traces" geometry={box(1, 0.04, 0.32)} material={mat} transforms={transforms} />;
}

/** Gull-wing IC package with leads on two opposite sides. */
export function IcPackage({
  x,
  z,
  top,
  length,
  width,
  height = 1.1,
  leadsPerSide,
  leadPitch,
}: {
  x: number;
  z: number;
  top: number;
  length: number;
  width: number;
  height?: number;
  leadsPerSide: number;
  leadPitch: number;
}) {
  const epoxy = useMat('epoxy');
  const tin = useMat('tin');
  const dot = useMat('silkscreen', '#5c5f63');
  const leads = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    for (const s of [-1, 1]) {
      for (const t of rowX(leadsPerSide, leadPitch, 0, 0.22, s * (width / 2 + 0.35))) out.push(t);
    }
    return out;
  }, [leadsPerSide, leadPitch, width]);
  return (
    <group position={[x, top, z]}>
      <mesh geometry={roundedBox(length, height, width, 0.18, 2)} material={epoxy} position={[0, height / 2 + 0.12, 0]} />
      <mesh geometry={cylinder(0.35, 0.35, 0.02, 16)} material={dot} position={[-length / 2 + 0.8, height + 0.13, -width / 2 + 0.8]} />
      <Instances geometry={box(leadPitch * 0.45, 0.25, 0.9)} material={tin} transforms={leads} />
    </group>
  );
}

/** Short silkscreen strokes (pin legends, outlines). */
export function Silk({ marks, top }: { marks: ReadonlyArray<[number, number, number, number]>; top: number }) {
  const ink = useMat('silkscreen');
  const transforms = useMemo<InstanceTransform[]>(
    () => marks.map(([x, z, w, d]) => ({ p: [x, top + 0.015, z], s: [w, 1, d] })),
    [marks, top],
  );
  return <Instances name="silkscreen" geometry={box(1, 0.03, 1)} material={ink} transforms={transforms} />;
}
