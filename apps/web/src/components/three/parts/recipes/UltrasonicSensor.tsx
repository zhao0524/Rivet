import { useMemo } from 'react';
import { Instances, rowX, type InstanceTransform } from '../Instances';
import { box, cylinder, roundedBox, torus } from '../geometry';
import { useMat } from '../materials';
import type { RecipeProps, Vec3 } from '../types';
import { PCB_T, PITCH } from './pcb';

const HALF_PI = Math.PI / 2;

/**
 * HC-SR04-style ranging module. The board stands in the local X/Y plane with both transducers
 * facing +Z (rover forward). Width = catalog X; board height = larger of Y/Z; depth = smaller.
 */
export function UltrasonicSensorRecipe({ size, color = '#1d5fa8' }: RecipeProps) {
  const w = size.x;
  const bh = Math.max(size.y, size.z);
  const depth = Math.min(size.y, size.z);
  const pinExt = Math.min(3, bh * 0.16);
  const boardH = bh - pinExt;
  const boardY = pinExt / 2;
  const backZ = -depth / 2 + Math.min(1.2, depth * 0.15);
  const frontZ = backZ + PCB_T;
  const rt = Math.min(w * 0.2, boardH * 0.46);
  const cx = w / 2 - rt - w * 0.045;
  const canLen = depth / 2 - frontZ;

  const mask = useMat('pcb', color);
  const can = useMat('aluminum', '#c9ced3');
  const mesh = useMat('mesh');
  const collar = useMat('blackPlastic');
  const crystal = useMat('chrome');
  const gold = useMat('gold');
  const epoxy = useMat('epoxy');
  const ink = useMat('silkscreen');

  const dots = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    const step = rt / 3.4;
    for (const s of [-1, 1]) {
      for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
          const x = i * step + (j % 2 ? step / 2 : 0);
          const y = j * step * 0.87;
          if (Math.hypot(x, y) < rt * 0.72) out.push({ p: [s * cx + x, boardY + y, depth / 2 - 0.55] as Vec3, r: [HALF_PI, 0, 0] as Vec3 });
        }
      }
    }
    return out;
  }, [rt, cx, boardY, depth]);
  const pins = useMemo<InstanceTransform[]>(
    () => rowX(4, Math.min(PITCH, w * 0.12), 0, boardY - boardH / 2 - pinExt / 2 + 0.2, (backZ + frontZ) / 2),
    [w, boardY, boardH, pinExt, backZ, frontZ],
  );

  return (
    <group name="ultrasonic-visual">
      <mesh name="board" geometry={roundedBox(w, boardH, PCB_T, 0.6, 2)} material={mask} position={[0, boardY, (backZ + frontZ) / 2]} />
      {[-1, 1].map((s) => (
        <group key={s} name={s < 0 ? 'transducer-tx' : 'transducer-rx'} position={[s * cx, boardY, frontZ]}>
          <mesh geometry={cylinder(rt * 1.05, rt * 1.05, Math.min(1, canLen * 0.2), 40)} material={collar} rotation={[HALF_PI, 0, 0]} position={[0, 0, 0.4]} />
          <mesh geometry={cylinder(rt, rt, canLen, 48, true)} material={can} rotation={[HALF_PI, 0, 0]} position={[0, 0, canLen / 2]} />
          <mesh geometry={torus(rt - 0.25, 0.3, 10, 48)} material={can} position={[0, 0, canLen - 0.2]} />
          <mesh geometry={cylinder(rt - 0.35, rt - 0.35, 0.3, 40)} material={mesh} rotation={[HALF_PI, 0, 0]} position={[0, 0, canLen - 0.9]} />
        </group>
      ))}
      <Instances name="transducer-mesh" geometry={cylinder(rt * 0.09, rt * 0.09, 0.25, 6)} material={collar} transforms={dots} />
      <mesh name="crystal" geometry={roundedBox(Math.min(5, cx - rt - 0.6) * 1.2, Math.max(1.4, boardH * 0.16), 1.6, 0.6, 3)} material={crystal} position={[0, boardY + boardH * 0.3, frontZ + 0.8]} />
      <mesh name="pin-housing" geometry={roundedBox(4 * Math.min(PITCH, w * 0.12) + 0.4, 2.2, 2.4, 0.3, 1)} material={collar} position={[0, boardY - boardH / 2 + 1.4, frontZ + 1.2]} />
      <Instances name="pins" geometry={box(0.6, pinExt + 0.4, 0.6)} material={gold} transforms={pins} />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={roundedBox(w * 0.18, boardH * 0.18, Math.max(0.4, backZ + depth / 2 - 0.1), 0.2, 1)} material={epoxy} position={[s * w * 0.2, boardY - boardH * 0.05, (backZ - depth / 2) / 2]} />
      ))}
      <mesh geometry={box(w * 0.5, 0.25, 0.03)} material={ink} position={[0, boardY - boardH / 2 + 2.9, frontZ + 0.02]} />
    </group>
  );
}
