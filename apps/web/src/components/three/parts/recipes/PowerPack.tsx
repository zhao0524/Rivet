import { useMemo } from 'react';
import { Instances, type InstanceTransform } from '../Instances';
import { box, cylinder, roundedBox } from '../geometry';
import { shade, useMat } from '../materials';
import type { RecipeProps, Vec3 } from '../types';

const HALF_PI = Math.PI / 2;

/** Enclosed battery box: base tub, screwed lid, slide switch, grip ribs and strain-relieved leads. */
export function BatteryPackRecipe({ size, color = '#4b5563' }: RecipeProps) {
  const { x: w, y: h, z: d } = size;
  const lidT = Math.max(2, h * 0.16);
  const baseH = h - lidT - 0.35;
  const body = useMat('polymer', color);
  const lid = useMat('polymer', shade(color, 0.05));
  const seam = useMat('hole');
  const chrome = useMat('chrome');
  const black = useMat('blackPlastic');
  const slider = useMat('polymer', '#e9e6df');
  const red = useMat('polymer', '#c4302b');
  const wireBlack = useMat('polymer', '#1b1b1d');
  const tin = useMat('tin');
  const emboss = useMat('polymer', shade(color, 0.16));

  const ribs = useMemo<InstanceTransform[]>(
    () => Array.from({ length: 6 }, (_, i) => ({ p: [0, h / 2 + 0.25, d * 0.3 + (i - 2.5) * 2.2] as Vec3 })),
    [h, d],
  );
  const leads = [
    { mat: red, x: -2 },
    { mat: wireBlack, x: 2 },
  ];
  return (
    <group name="battery-pack-visual">
      <mesh name="tub" geometry={roundedBox(w, baseH, d, Math.min(3, baseH / 3), 3)} material={body} position={[0, -h / 2 + baseH / 2, 0]} />
      <mesh geometry={box(w - 1.4, 0.5, d - 1.4)} material={seam} position={[0, -h / 2 + baseH + 0.1, 0]} />
      <mesh name="lid" geometry={roundedBox(w - 0.4, lidT, d - 0.4, Math.min(2.4, lidT / 2.2), 3)} material={lid} position={[0, h / 2 - lidT / 2, 0]} />
      <Instances name="grip-ribs" geometry={roundedBox(w * 0.5, 0.6, 0.9, 0.25, 1)} material={emboss} transforms={ribs} />
      <mesh name="lid-screw" geometry={cylinder(2.4, 2.6, 0.9, 24)} material={chrome} position={[0, h / 2 + 0.3, -d * 0.05]} />
      <mesh geometry={box(3.2, 0.3, 0.6)} material={seam} position={[0, h / 2 + 0.78, -d * 0.05]} />
      <mesh geometry={box(0.6, 0.3, 3.2)} material={seam} position={[0, h / 2 + 0.78, -d * 0.05]} />
      <group name="slide-switch" position={[w * 0.28, h / 2, -d * 0.32]}>
        <mesh geometry={roundedBox(6, 1.2, 11, 0.5, 2)} material={black} position={[0, 0.4, 0]} />
        <mesh geometry={roundedBox(3.4, 2, 4, 0.5, 2)} material={slider} position={[0, 1.1, -1.8]} />
      </group>
      <group name="polarity" position={[-w * 0.3, h / 2 + 0.18, -d * 0.32]}>
        <mesh geometry={box(4, 0.35, 0.8)} material={emboss} />
        <mesh geometry={box(0.8, 0.35, 4)} material={emboss} />
        <mesh geometry={box(4, 0.35, 0.8)} material={emboss} position={[0, 0, 6]} />
      </group>
      {leads.map(({ mat, x }) => (
        <group key={x} position={[x, -h / 2 + baseH * 0.55, -d / 2]}>
          <mesh geometry={cylinder(1.6, 1.9, 1.6, 16)} material={black} rotation={[HALF_PI, 0, 0]} position={[0, 0, -0.4]} />
          <mesh geometry={cylinder(0.95, 0.95, 4, 12)} material={mat} rotation={[HALF_PI, 0, 0]} position={[0, 0, -2.6]} />
          <mesh geometry={cylinder(0.45, 0.45, 1.6, 8)} material={tin} rotation={[HALF_PI, 0, 0]} position={[0, 0, -5.2]} />
        </group>
      ))}
    </group>
  );
}

/** Compact USB power bank: pill-section slab, accent band, USB-A / micro-USB ports and charge LEDs. */
export function UsbPowerBankRecipe({ size, color = '#4b5563' }: RecipeProps) {
  const { x: w, y: h, z: d } = size;
  const body = useMat('polymer', color);
  const band = useMat('aluminum', '#9aa3ad');
  const usb = useMat('metal', '#d5d9dd');
  const hole = useMat('hole');
  const tongue = useMat('polymer', '#2f6fd6');
  const ledOn = useMat('led', '#47a3ff');
  const ledOff = useMat('polymer', '#2a2d31');
  const feet = useMat('rubber', '#141516');

  const leds = useMemo<InstanceTransform[]>(
    () => [0, 1, 2].map((i) => ({ p: [w * 0.05 + i * 2.6, h / 2 - 0.1, d / 2 - 4] as Vec3 })),
    [w, h, d],
  );
  const pads = useMemo<InstanceTransform[]>(
    () => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ p: [sx * w * 0.36, -h / 2 + 0.25, sz * d * 0.36] as Vec3 }))),
    [w, h, d],
  );
  return (
    <group name="power-bank-visual">
      <mesh name="shell" geometry={roundedBox(w, h - 0.5, d, Math.min(h / 2 - 0.4, 4.5), 5)} material={body} position={[0, 0.25, 0]} />
      <mesh name="band" geometry={roundedBox(w + 0.2, 1.2, d + 0.2, 0.6, 2)} material={band} position={[0, 0.25, 0]} />
      <group name="usb-a" position={[-w * 0.18, 0.25, d / 2]}>
        <mesh geometry={box(12, 4.6, 1.2)} material={usb} position={[0, 0, -0.3]} />
        <mesh geometry={box(11, 3.6, 1.0)} material={hole} position={[0, 0, 0]} />
        <mesh geometry={box(9, 1.2, 0.6)} material={tongue} position={[0, 0.5, 0.15]} />
      </group>
      <group name="micro-usb" position={[w * 0.22, 0.25, d / 2]}>
        <mesh geometry={roundedBox(7.6, 2.8, 1.2, 0.6, 2)} material={usb} position={[0, 0, -0.3]} />
        <mesh geometry={roundedBox(6.6, 1.7, 1.0, 0.4, 1)} material={hole} />
      </group>
      <mesh geometry={roundedBox(1.8, 0.4, 1.8, 0.4, 2)} material={ledOn} position={[w * 0.05 - 2.6, h / 2 - 0.1, d / 2 - 4]} />
      <Instances name="charge-leds" geometry={roundedBox(1.8, 0.4, 1.8, 0.4, 2)} material={ledOff} transforms={leds} />
      <mesh name="button" geometry={cylinder(1.6, 1.7, 1.2, 20)} material={band} rotation={[0, 0, HALF_PI]} position={[w / 2 + 0.2, 0.25, d * 0.2]} />
      <Instances name="feet" geometry={cylinder(2.4, 2.4, 0.5, 18)} material={feet} transforms={pads} />
    </group>
  );
}
