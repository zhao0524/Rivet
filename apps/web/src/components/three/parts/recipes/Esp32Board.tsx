import { useMemo } from 'react';
import { Instances, rowX, type InstanceTransform } from '../Instances';
import { box, cylinder, roundedBox } from '../geometry';
import { shade, useMat } from '../materials';
import type { RecipeProps, Vec3 } from '../types';
import { BoardBlank, HeaderRow, IcPackage, PITCH, Passives, PlatedHole, Silk, Traces, boardFrame } from './pcb';

/**
 * ESP32 DevKit-style board: WROOM module (shield can + meander antenna) at one end, micro-USB,
 * EN/BOOT buttons, USB-UART bridge, regulator, status LEDs and two 0.1" header rows pointing down.
 */
export function Esp32BoardRecipe({ size, color = '#1c5746' }: RecipeProps) {
  const { length: L, width: W, height: H, yaw } = boardFrame(size);
  const top = H / 2 - Math.min(3.2, H * 0.4);
  const bottom = -H / 2;
  const rowZ = W / 2 - 1.7;
  const pins = Math.max(4, Math.min(19, Math.floor((L - 7) / PITCH)));

  const moduleL = Math.min(25.5, L * 0.47);
  const moduleW = Math.min(18, W * 0.64);
  const moduleX0 = L / 2 - moduleL - 0.4;
  const shieldL = moduleL * 0.69;
  const shieldH = Math.max(1.2, Math.min(2.4, H / 2 - top - 1));

  const modulePcb = useMat('pcb', '#1b2430');
  const shield = useMat('metal', '#cdd2d7');
  const shieldLabel = useMat('aluminum', '#b3b9bf');
  const gold = useMat('gold');
  const usbMetal = useMat('metal', '#d5d9dd');
  const hole = useMat('hole');
  const btnBase = useMat('metal', '#c2c7cc');
  const btnCap = useMat('blackPlastic');
  const ledRed = useMat('led', '#ff4433');
  const ledBlue = useMat('led', '#3d8bff');
  const epoxy = useMat('epoxy');

  const castellations = useMemo<InstanceTransform[]>(() => {
    const n = Math.floor(shieldL / 1.27);
    return [-1, 1].flatMap((s) => rowX(n, 1.27, moduleX0 + 0.6 + shieldL / 2, top + 0.42, s * (moduleW / 2 - 0.2)));
  }, [shieldL, moduleX0, moduleW, top]);

  const antenna = useMemo<ReadonlyArray<[number, number, number, number]>>(() => {
    const x0 = moduleX0 + shieldL + 1.4;
    const x1 = L / 2 - 1.6;
    const zw = moduleW * 0.36;
    const segs: Array<[number, number, number, number]> = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      segs.push([x, -zw, x, zw]);
      if (i < steps) {
        const xn = x0 + ((x1 - x0) * (i + 1)) / steps;
        const z = i % 2 === 0 ? zw : -zw;
        segs.push([x, z, xn, z]);
      }
    }
    return segs;
  }, [moduleX0, shieldL, L, moduleW]);
  const antennaT = useMemo<InstanceTransform[]>(
    () =>
      antenna.map(([ax, az, bx, bz]) => ({
        p: [(ax + bx) / 2, top + 0.84, (az + bz) / 2] as Vec3,
        r: [0, -Math.atan2(bz - az, bx - ax), 0] as Vec3,
        s: [Math.hypot(bx - ax, bz - az) + 0.5, 1, 1] as Vec3,
      })),
    [antenna, top],
  );

  const xu = -L / 2;
  const passives = useMemo<Vec3[]>(
    () => [
      [xu + 15, top, 8.2],
      [xu + 15, top, 6.4],
      [xu + 17.5, top, -1.5],
      [xu + 17.5, top, 0.6],
      [xu + 8.5, top, -2.8],
      [xu + 8.5, top, 2.8],
      [moduleX0 - 2, top, 5],
      [moduleX0 - 2, top, -5],
      [moduleX0 - 2, top, 0],
    ],
    [xu, top, moduleX0],
  );
  const traces = useMemo<ReadonlyArray<[number, number, number, number]>>(
    () => [
      [xu + 6, 0, xu + 12, 0],
      [xu + 12, 0, xu + 14, -2.5],
      [xu + 19, -4, moduleX0 - 1, -4],
      [xu + 19, 4.5, moduleX0 - 1, 4.5],
      [moduleX0 - 3.5, -4, moduleX0 - 3.5, -rowZ + 2.2],
      [moduleX0 - 3.5, 4.5, moduleX0 - 3.5, rowZ - 2.2],
      [xu + 10, 7.5, xu + 10, rowZ - 2.2],
      [xu + 21, -7, xu + 21, -rowZ + 2.2],
    ],
    [xu, moduleX0, rowZ],
  );
  const legends = useMemo<ReadonlyArray<[number, number, number, number]>>(() => {
    const out: Array<[number, number, number, number]> = [];
    rowX(pins, PITCH, 0, 0, 0).forEach((t, i) => {
      const len = 1 + ((i * 7) % 3) * 0.35;
      out.push([t.p[0], rowZ - 2.6, 0.45, len], [t.p[0], -rowZ + 2.6, 0.45, len]);
    });
    out.push([moduleX0 - 0.6, 0, 0.25, moduleW], [xu + 2, -7.8, 2.4, 0.25], [xu + 2, 7.8, 2.4, 0.25]);
    return out;
  }, [pins, rowZ, moduleX0, moduleW, xu]);

  const maskTrace = shade(color, 0.12);
  return (
    <group name="esp32-visual" rotation={[0, yaw, 0]}>
      <BoardBlank length={L} width={W} top={top} color={color} />
      <Traces segments={traces} top={top} color={maskTrace} />
      <Silk marks={legends} top={top} />
      <HeaderRow count={pins} cx={0} z={rowZ} pcbTop={top} bottom={bottom} />
      <HeaderRow count={pins} cx={0} z={-rowZ} pcbTop={top} bottom={bottom} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <PlatedHole key={`${sx}${sz}`} x={sx * (L / 2 - 1.9)} z={sz * (rowZ - 3.6)} top={top} radius={1.1} />))}

      <group name="wroom-module">
        <mesh geometry={roundedBox(moduleL, 0.8, moduleW, 0.25, 1)} material={modulePcb} position={[moduleX0 + moduleL / 2, top + 0.4, 0]} />
        <mesh geometry={roundedBox(shieldL, shieldH, moduleW - 1.2, 0.35, 2)} material={shield} position={[moduleX0 + 0.6 + shieldL / 2, top + 0.8 + shieldH / 2, 0]} />
        <mesh geometry={box(shieldL * 0.62, 0.02, moduleW * 0.55)} material={shieldLabel} position={[moduleX0 + 0.6 + shieldL / 2, top + 0.81 + shieldH, 0]} />
        <Instances name="castellations" geometry={box(0.7, 0.86, 0.9)} material={gold} transforms={castellations} />
        <Instances name="antenna" geometry={box(1, 0.04, 0.5)} material={gold} transforms={antennaT} />
      </group>

      <group name="micro-usb" position={[xu + 2.4, top + 1.35, 0]}>
        <mesh geometry={roundedBox(5.6, 2.7, 7.6, 0.6, 2)} material={usbMetal} />
        <mesh geometry={roundedBox(0.3, 1.5, 6.2, 0.2, 1)} material={hole} position={[-2.75, 0, 0]} />
      </group>
      {[-1, 1].map((s) => (
        <group key={s} name={s < 0 ? 'boot-button' : 'en-button'} position={[xu + 4.6, top, s * 7.6]}>
          <mesh geometry={roundedBox(3.6, 1.3, 5.8, 0.3, 1)} material={btnBase} position={[0, 0.65, 0]} />
          <mesh geometry={cylinder(1.1, 1.2, 0.7, 20)} material={btnCap} position={[0, 1.6, 0]} />
        </group>
      ))}
      <IcPackage x={xu + 13} z={-2.5} top={top} length={5} width={5} height={0.8} leadsPerSide={5} leadPitch={0.8} />
      <IcPackage x={xu + 12.5} z={6.8} top={top} length={6.4} width={3.4} height={1.5} leadsPerSide={3} leadPitch={2.2} />
      <mesh geometry={box(3.1, 1.5, 1.6)} material={epoxy} position={[xu + 12.5, top + 0.95, 9.6]} />
      <Passives positions={passives} />
      <mesh name="led-power" geometry={roundedBox(1.6, 0.6, 0.8, 0.15, 1)} material={ledRed} position={[xu + 19.5, top + 0.3, 9]} />
      <mesh name="led-status" geometry={roundedBox(1.6, 0.6, 0.8, 0.15, 1)} material={ledBlue} position={[xu + 19.5, top + 0.3, -9]} />
    </group>
  );
}
