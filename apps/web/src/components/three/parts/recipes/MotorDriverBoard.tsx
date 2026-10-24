import { useMemo } from 'react';
import { roundedBox } from '../geometry';
import { shade, useMat } from '../materials';
import type { RecipeProps, Vec3 } from '../types';
import { BoardBlank, HeaderRow, IcPackage, PITCH, Passives, PlatedHole, Silk, Traces, boardFrame } from './pcb';

/** TB6612-style dual H-bridge breakout: SSOP-24 driver, decoupling caps and two 8-pin headers. */
export function MotorDriverBoardRecipe({ size, color = '#5b2a86' }: RecipeProps) {
  const { length: L, width: W, height: H, yaw } = boardFrame(size);
  const top = H / 2 - Math.min(2.2, H * 0.32);
  const bottom = -H / 2;
  const rowZ = W / 2 - 1.7;
  const pins = Math.max(4, Math.min(8, Math.floor((L - 4) / PITCH)));

  const tant = useMat('polymerGloss', '#d4a52a');
  const tantBand = useMat('polymer', '#6b4a1e');

  const caps = useMemo<Vec3[]>(
    () => [
      [-L * 0.3, top, -2.2],
      [-L * 0.3, top, 0.2],
      [L * 0.3, top, -2.6],
      [L * 0.3, top, 2.6],
    ],
    [L, top],
  );
  const traces = useMemo<ReadonlyArray<[number, number, number, number]>>(() => {
    const segs: Array<[number, number, number, number]> = [];
    rowX(pins).forEach((x, i) => {
      if (i % 2 === 0) segs.push([x, rowZ - 1.4, x * 0.45, 3.6]);
      else segs.push([x, -rowZ + 1.4, x * 0.45, -3.6]);
    });
    return segs;
  }, [pins, rowZ]);
  const legends = useMemo<ReadonlyArray<[number, number, number, number]>>(() => {
    const out: Array<[number, number, number, number]> = [];
    rowX(pins).forEach((x, i) => {
      const len = 0.9 + ((i * 5) % 3) * 0.35;
      out.push([x, rowZ - 2.5, 0.42, len], [x, -rowZ + 2.5, 0.42, len]);
    });
    out.push([0, 3.9, 9.4, 0.22], [0, -3.9, 9.4, 0.22], [-4.75, 0, 0.22, 8], [4.75, 0, 0.22, 8]);
    return out;
  }, [pins, rowZ]);

  return (
    <group name="tb6612-visual" rotation={[0, yaw, 0]}>
      <BoardBlank length={L} width={W} top={top} color={color} />
      <Traces segments={traces} top={top} color={shade(color, 0.14)} />
      <Silk marks={legends} top={top} />
      <HeaderRow count={pins} cx={0} z={rowZ} pcbTop={top} bottom={bottom} />
      <HeaderRow count={pins} cx={0} z={-rowZ} pcbTop={top} bottom={bottom} />
      <PlatedHole x={-L / 2 + 2.2} z={0} top={top} radius={1.2} />
      <PlatedHole x={L / 2 - 2.2} z={0} top={top} radius={1.2} />
      <IcPackage x={0} z={0} top={top} length={7.8} width={5.3} height={1.2} leadsPerSide={12} leadPitch={0.62} />
      <Passives positions={caps} size={[2.0, 0.9, 1.25]} />
      <group name="tantalum-cap" position={[-L * 0.3, top, 2.9]}>
        <mesh geometry={roundedBox(3.4, 1.8, 1.8, 0.2, 1)} material={tant} position={[0, 0.9, 0]} />
        <mesh geometry={roundedBox(0.7, 1.84, 1.84, 0.1, 1)} material={tantBand} position={[1.25, 0.9, 0]} />
      </group>
    </group>
  );
}

function rowX(count: number): number[] {
  const start = -((count - 1) * PITCH) / 2;
  return Array.from({ length: count }, (_, i) => start + i * PITCH);
}
