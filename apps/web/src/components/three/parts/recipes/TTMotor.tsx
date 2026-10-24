import { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, type InstanceTransform } from '../Instances';
import { box, cachedGeometry, cylinder, roundedBox } from '../geometry';
import { useMat } from '../materials';
import type { RecipeProps, Vec3 } from '../types';

const HALF_PI = Math.PI / 2;

function dShaftGeometry(radius: number, flat: number, length: number): THREE.BufferGeometry {
  return cachedGeometry(`d-shaft:${radius}:${flat}:${length}`, () => {
    const t = Math.asin(Math.min(0.99, flat / radius));
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius, Math.PI - t, Math.PI * 2 + t, false);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelOffset: -0.2, bevelSegments: 1, curveSegments: 20 });
    g.translate(0, 0, -length / 2);
    g.rotateY(HALF_PI);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * TT-style geared motor. Origin is the output-shaft axis (so it lines up with the wheel hub);
 * the gearbox runs along local Z with the motor can toward +Z and the D-shaft exiting along ±X
 * toward the wheel side. Catalog length/width/height map to the longest horizontal extent,
 * shortest horizontal extent and Y respectively.
 */
export function TTMotorRecipe({ size, color = '#d8b02e', side }: RecipeProps) {
  const L = Math.max(size.x, size.z);
  const W = Math.min(size.x, size.z);
  const H = size.y;
  const out = side === 'right' ? 1 : -1;

  const housing = useMat('polymer', color);
  const seam = useMat('blackPlastic');
  const can = useMat('metal', '#c6cbd0');
  const endbell = useMat('blackPlastic', '#202124');
  const brass = useMat('brass');
  const shaftMat = useMat('polymer', '#efe9dc');
  const hole = useMat('hole');
  const red = useMat('polymer', '#c4302b');
  const black = useMat('polymer', '#1b1b1d');

  const gbFront = -0.17 * L;
  const gbRear = 0.4 * L;
  const gbLen = gbRear - gbFront;
  const gbMid = (gbFront + gbRear) / 2;
  const canStart = gbRear;
  const canLen = 0.39 * L;
  const canR = Math.min(H, W) * 0.46;
  const bellLen = L - (canStart - gbFront) - canLen;
  const halfW = W / 2 - 0.2;

  const mountHoles = useMemo<InstanceTransform[]>(
    () => [
      { p: [0, H * 0.3, 0.22 * L] as Vec3, r: [0, 0, HALF_PI] as Vec3 },
      { p: [0, -H * 0.3, 0.22 * L] as Vec3, r: [0, 0, HALF_PI] as Vec3 },
      { p: [0, H * 0.3, -0.1 * L] as Vec3, r: [0, 0, HALF_PI] as Vec3 },
    ],
    [H, L],
  );
  const bosses = useMemo<InstanceTransform[]>(
    () => [-1, 1].map((s) => ({ p: [s * (W / 2 + 0.5), 0, 0] as Vec3, r: [0, 0, HALF_PI] as Vec3 })),
    [W],
  );
  const shaftOut = W * 0.46;
  const tabs = useMemo<InstanceTransform[]>(
    () => [-1, 1].map((s) => ({ p: [s * canR * 0.42, canR * 0.15, canStart + canLen + bellLen + 0.9] as Vec3 })),
    [canR, canStart, canLen, bellLen],
  );

  return (
    <group name="tt-motor-visual">
      <group name="gearbox">
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            geometry={roundedBox(halfW, H, gbLen, Math.min(2.2, H * 0.1), 3)}
            material={housing}
            position={[s * (halfW / 2 + 0.2), 0, gbMid]}
          />
        ))}
        <mesh geometry={box(0.6, H - 1.6, gbLen - 1.6)} material={seam} position={[0, 0, gbMid]} />
        <Instances name="mount-holes" geometry={cylinder(1.6, 1.6, W + 0.12, 18)} material={hole} transforms={mountHoles} />
        <Instances name="shaft-bosses" geometry={cylinder(3.9, 4.3, 1.0, 28)} material={housing} transforms={bosses} />
        <mesh geometry={roundedBox(W * 0.45, 2.2, 3.2, 0.6, 2)} material={housing} position={[0, H / 2 + 0.6, gbRear - 4]} />
      </group>
      <mesh
        name="output-shaft"
        geometry={dShaftGeometry(2.75, 1.85, shaftOut)}
        material={shaftMat}
        position={[out * (W / 2 + shaftOut / 2), 0, 0]}
      />
      <mesh name="inner-shaft" geometry={dShaftGeometry(2.75, 1.85, 3)} material={shaftMat} position={[-out * (W / 2 + 1.5), 0, 0]} />
      <group name="motor-can" position={[0, 0, canStart]} scale={[W / (2 * canR) < 1 ? W / (2 * canR) : 1, 1, 1]}>
        <mesh geometry={cylinder(canR, canR, canLen, 40)} material={can} rotation={[HALF_PI, 0, 0]} position={[0, 0, canLen / 2]} />
        <mesh geometry={cylinder(canR + 0.25, canR + 0.25, 1.2, 40)} material={can} rotation={[HALF_PI, 0, 0]} position={[0, 0, 0.8]} />
        <mesh geometry={cylinder(canR * 0.92, canR * 0.98, bellLen, 40)} material={endbell} rotation={[HALF_PI, 0, 0]} position={[0, 0, canLen + bellLen / 2]} />
        <mesh geometry={cylinder(1.4, 1.4, 1.0, 20)} material={brass} rotation={[HALF_PI, 0, 0]} position={[0, 0, canLen + bellLen + 0.3]} />
      </group>
      <Instances name="solder-tabs" geometry={box(1.8, 0.4, 2.4)} material={brass} transforms={tabs} />
      <mesh geometry={cylinder(0.75, 0.75, 4, 10)} material={red} rotation={[HALF_PI, 0, 0]} position={[-canR * 0.42, canR * 0.15 + 0.9, canStart + canLen + bellLen + 2.6]} />
      <mesh geometry={cylinder(0.75, 0.75, 4, 10)} material={black} rotation={[HALF_PI, 0, 0]} position={[canR * 0.42, canR * 0.15 + 0.9, canStart + canLen + bellLen + 2.6]} />
    </group>
  );
}
