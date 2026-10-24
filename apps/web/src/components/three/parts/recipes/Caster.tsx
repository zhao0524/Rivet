import { useMemo } from 'react';
import { Instances, type InstanceTransform } from '../Instances';
import { cylinder, lathe, roundedBox, sphere } from '../geometry';
import { useMat } from '../materials';
import type { RecipeProps, Vec3 } from '../types';

/** Ball-transfer caster: two-hole flange, standoff column, pressed housing and steel ball. */
export function CasterRecipe({ size, color = '#c1c8cc' }: RecipeProps) {
  const { x: w, y: h, z: d } = size;
  const plan = Math.min(w, d);
  const housing = useMat('metal', color);
  const chrome = useMat('chrome');
  const recess = useMat('hole');
  const ballR = plan * 0.24;
  const top = h / 2;
  const bottom = -h / 2;
  const ballY = bottom + ballR;
  const domeTop = ballY + ballR * 0.95;
  const flangeT = Math.max(1.2, h * 0.07);
  const colR = plan * 0.2;
  const colH = top - flangeT - domeTop;

  const domeGeo = useMemo(
    () =>
      lathe(`caster-dome:${plan}:${h}`, [
        [ballR * 0.78, ballY - ballR * 0.35],
        [ballR * 1.02, ballY - ballR * 0.2],
        [ballR * 1.2, ballY + ballR * 0.25],
        [ballR * 1.18, ballY + ballR * 0.7],
        [colR * 1.1, domeTop],
        [0.01, domeTop],
      ]),
    [plan, h, ballR, ballY, colR, domeTop],
  );
  const holes = useMemo<InstanceTransform[]>(
    () => [-1, 1].map((s) => ({ p: [s * w * 0.36, top - flangeT / 2, 0] as Vec3 })),
    [w, top, flangeT],
  );

  return (
    <group name="caster-visual">
      <mesh name="flange" geometry={roundedBox(w * 0.96, flangeT, d * 0.42, Math.min(d * 0.2, 4), 3)} material={housing} position={[0, top - flangeT / 2, 0]} />
      <Instances name="flange-holes" geometry={cylinder(1.6, 1.6, flangeT + 0.1, 18)} material={recess} transforms={holes} />
      <mesh name="column" geometry={cylinder(colR, colR * 1.05, Math.max(0.5, colH), 6)} material={chrome} position={[0, domeTop + colH / 2, 0]} />
      <mesh name="housing" geometry={domeGeo} material={housing} />
      <mesh name="ball" geometry={sphere(ballR, 40)} material={chrome} position={[0, ballY, 0]} />
    </group>
  );
}
