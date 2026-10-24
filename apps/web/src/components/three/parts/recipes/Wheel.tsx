import { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, type InstanceTransform } from '../Instances';
import { box, cylinder, lathe, plate } from '../geometry';
import { useMat } from '../materials';
import type { RecipeProps, Vec3 } from '../types';

const HALF_PI = Math.PI / 2;

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, steps = 5): Array<[number, number]> {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  });
}

/**
 * Hobby drive wheel: rounded rubber tyre with chevron tread over a six-spoke rim. The axle is local X;
 * the hub boss faces the chassis (inboard) and the tread chevrons mirror between left and right.
 * Diameter = largest catalog extent, width = smallest.
 */
export function WheelRecipe({ size, color = '#26292b', side }: RecipeProps) {
  const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
  const D = dims[2];
  const w = dims[0];
  const R = D / 2;
  const lug = Math.min(1.4, R * 0.05);
  const R0 = R - lug;
  const rSeat = R * 0.72;
  const shoulder = Math.min(3, w * 0.18);
  const outboard = side === 'left' ? -1 : 1;
  const key = `${D}:${w}`;

  const tyre = useMat('rubber', color);
  const tread = useMat('rubber', color);
  const rimMat = useMat('polymerGloss', '#d6a935');
  const chrome = useMat('chrome');
  const hole = useMat('hole');

  const tyreGeo = useMemo(() => {
    const prof: Array<[number, number]> = [
      [rSeat, -w / 2 + 1.2],
      [rSeat + 1.2, -w / 2],
      ...arcPoints(R0 - shoulder, -w / 2 + shoulder, shoulder, -HALF_PI, 0),
      [R0 + 0.15, 0],
      ...arcPoints(R0 - shoulder, w / 2 - shoulder, shoulder, 0, HALF_PI),
      [rSeat + 1.2, w / 2],
      [rSeat, w / 2 - 1.2],
      [rSeat, -w / 2 + 1.2],
    ];
    return lathe(`tyre:${key}`, prof, 72);
  }, [key, rSeat, R0, shoulder, w]);

  const rimGeo = useMemo(
    () =>
      lathe(
        `rim:${key}`,
        [
          [rSeat - 1.8, -w / 2 + 1],
          [rSeat + 0.9, -w / 2 + 0.6],
          [rSeat + 0.9, -w / 2 + 1.8],
          [rSeat, -w / 2 + 2.2],
          [rSeat, w / 2 - 2.2],
          [rSeat + 0.9, w / 2 - 1.8],
          [rSeat + 0.9, w / 2 - 0.6],
          [rSeat - 1.8, w / 2 - 1],
          [rSeat - 1.8, -w / 2 + 1],
        ],
        72,
      ),
    [key, rSeat, w],
  );

  const hubR = Math.max(4, R * 0.17);
  const faceT = Math.max(1.4, w * 0.11);
  const faceGeo = useMemo(
    () =>
      plate(`wheel-face:${key}`, () => {
        const shape = new THREE.Shape();
        shape.absarc(0, 0, rSeat - 1.2, 0, Math.PI * 2, false);
        const spokes = 6;
        const inner = hubR + 1.6;
        const outer = rSeat - 3.2;
        const spokeHalf = Math.asin(Math.min(0.9, 1.9 / inner));
        for (let i = 0; i < spokes; i++) {
          const a0 = (i / spokes) * Math.PI * 2 + spokeHalf;
          const a1 = ((i + 1) / spokes) * Math.PI * 2 - spokeHalf;
          const ao = Math.asin(Math.min(0.9, 1.9 / outer));
          const window = new THREE.Path();
          window.absarc(0, 0, outer, a0 - spokeHalf + ao, a1 + spokeHalf - ao, false);
          window.absarc(0, 0, inner, a1, a0, true);
          window.closePath();
          shape.holes.push(window);
        }
        return shape;
      }, faceT, 0.45),
    [key, rSeat, hubR, faceT],
  );

  const lugs = useMemo<InstanceTransform[]>(() => {
    const count = Math.max(18, Math.round((2 * Math.PI * R0) / 5.2));
    const out: InstanceTransform[] = [];
    const tilt = 0.42 * outboard;
    for (let i = 0; i < count; i++) {
      const phi = (i / count) * Math.PI * 2;
      for (const s of [-1, 1]) {
        out.push({
          p: [Math.cos(phi) * (R0 + lug / 2 - 0.1), s * w * 0.2, Math.sin(phi) * (R0 + lug / 2 - 0.1)] as Vec3,
          r: [s * tilt, -phi, 0] as Vec3,
          order: 'YXZ',
        });
      }
    }
    return out;
  }, [R0, lug, w, outboard]);

  const faceY = w * 0.12;
  const hubBottom = -w / 2 + 0.3;
  const hubLen = faceY + faceT / 2 - hubBottom;
  const hubMid = hubBottom + hubLen / 2;
  return (
    <group name="wheel-visual" rotation={[0, 0, -HALF_PI * outboard]}>
      <mesh name="tyre" geometry={tyreGeo} material={tyre} />
      <Instances name="tread" geometry={box(lug, w * 0.36, 2.1)} material={tread} transforms={lugs} />
      <mesh name="rim" geometry={rimGeo} material={rimMat} />
      <mesh name="rim-face" geometry={faceGeo} material={rimMat} position={[0, faceY - faceT / 2, 0]} />
      <mesh name="hub" geometry={cylinder(hubR, hubR * 1.08, hubLen, 32)} material={rimMat} position={[0, hubMid, 0]} />
      <mesh name="axle-bore" geometry={cylinder(2.8, 2.8, 1.2, 20)} material={hole} position={[0, hubBottom - 0.05, 0]} />
      <mesh name="hub-screw" geometry={cylinder(2.3, 2.5, 1.1, 24)} material={chrome} position={[0, faceY + faceT / 2 + 0.4, 0]} />
      <mesh geometry={box(3.4, 0.4, 0.6)} material={hole} position={[0, faceY + faceT / 2 + 0.98, 0]} />
    </group>
  );
}
