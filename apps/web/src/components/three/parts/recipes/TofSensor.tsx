import { useMemo } from 'react';
import { Instances, rowX, type InstanceTransform } from '../Instances';
import { box, cylinder, roundedBox } from '../geometry';
import { useMat } from '../materials';
import type { RecipeProps } from '../types';
import { PCB_T, PITCH } from './pcb';

const HALF_PI = Math.PI / 2;

/**
 * Time-of-flight breakout (VL53L0X / VL53L1X class): a flat board in the local X/Z plane, the
 * small optical package with its emitter and receiver windows on +Y, one header row along an
 * edge and two mounting holes. Sized to the catalog bounding box; never the twin-drum
 * ultrasonic module.
 */
export function TofSensorRecipe({ size, color = '#1d2433' }: RecipeProps) {
  const w = size.x;
  const d = size.z;
  const t = Math.min(PCB_T, size.y * 0.6);
  const y0 = -size.y / 2;
  const chipH = Math.max(0.3, Math.min(1, size.y - t - 0.1));
  const pcb = useMat('pcb', color);
  const chip = useMat('epoxy');
  const glass = useMat('chrome', '#2c3440');
  const gold = useMat('gold');
  const pins = useMemo<InstanceTransform[]>(() => rowX(7, Math.min(PITCH, (w - 2) / 7), 0, y0 + t + 0.05, -d / 2 + 1.8), [w, d, y0, t]);
  return (
    <group name="tof-visual" userData={{ recipe: 'tof_sensor' }}>
      <mesh name="board" geometry={roundedBox(w, t, d, 0.8, 2)} material={pcb} position={[0, y0 + t / 2, 0]} />
      <mesh name="optical-package" geometry={box(4.4, chipH, 2.4)} material={chip} position={[0, y0 + t + chipH / 2, 1.5]} />
      {[-1, 1].map((s) => (
        <mesh key={s} name={s < 0 ? 'emitter-window' : 'receiver-window'} geometry={cylinder(0.45, 0.45, 0.12, 20)} material={glass}
          position={[s * 0.97, y0 + t + chipH + 0.06, 1.5]} />
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`hole${s}`} name="mount-hole-ring" geometry={cylinder(1.4, 1.4, t + 0.02, 24)} material={gold}
          position={[s * (w / 2 - 2.5), y0 + t / 2, d / 2 - 2.5]} rotation={[0, 0, 0]} />
      ))}
      <Instances name="header-pads" geometry={cylinder(0.55, 0.55, t + 0.04, 12)} material={gold} transforms={pins} />
      <mesh name="silk" geometry={box(w * 0.4, 0.02, 0.4)} material={gold} position={[0, y0 + t + 0.01, -d / 2 + 3.6]} rotation={[0, HALF_PI * 0, 0]} />
    </group>
  );
}
