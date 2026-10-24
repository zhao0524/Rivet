import { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, type InstanceTransform } from '../Instances';
import { cylinder, plate, roundedBox } from '../geometry';
import { shade, useMat } from '../materials';
import type { RecipeProps, Vec3 } from '../types';
import { holeAt, roundedPolygon, slotAt } from './shapes';

const PLATE_T = 3;

/**
 * Two-tier 2WD robot chassis: a tapered base plate and a perforated upper deck joined by brass
 * hex standoffs, with a rubber nose bumper. Fills the catalog bounds; origin is the bounds centre.
 */
export function ChassisRecipe({ size, color = '#343942' }: RecipeProps) {
  const { x: w, y: h, z: d } = size;
  const plateColor = color;
  const deckColor = shade(color, 0.06);
  const baseMat = useMat('polymer', plateColor);
  const deckMat = useMat('polymer', deckColor);
  const brass = useMat('brass');
  const chrome = useMat('chrome');
  const recess = useMat('hole');
  const rubber = useMat('rubber', '#1b1c1e');

  const frontW = w * 0.72;
  const deckW = w * 0.6;
  const deckL = d * 0.84;
  const deckZ = -d * 0.02;
  const gap = Math.max(1, h - 2 * PLATE_T);
  const key = `${w}:${h}:${d}`;

  const baseGeo = useMemo(
    () =>
      plate(`chassis-base:${key}`, () => {
        const outline: Array<[number, number]> = [
          [-w / 2, -d / 2],
          [w / 2, -d / 2],
          [w / 2, d * 0.2],
          [frontW / 2, d / 2],
          [-frontW / 2, d / 2],
          [-w / 2, d * 0.2],
        ];
        const shape = roundedPolygon(new THREE.Shape(), outline, Math.min(w, d) * 0.11);
        for (let z = -d / 2 + 12; z < d * 0.16; z += 13) {
          shape.holes.push(holeAt(-w / 2 + 6.5, z, 1.6), holeAt(w / 2 - 6.5, z, 1.6));
        }
        for (const s of [-1, 1]) {
          shape.holes.push(slotAt(s * w * 0.34, -d * 0.36, d * 0.14, 3.4, true));
          shape.holes.push(slotAt(s * w * 0.22, d * 0.4, w * 0.12, 3.4, false));
        }
        shape.holes.push(slotAt(0, d * 0.43, w * 0.18, 5, false));
        return shape;
      }, PLATE_T),
    [key, w, d, frontW],
  );

  const deckGeo = useMemo(
    () =>
      plate(`chassis-deck:${key}`, () => {
        const shape = roundedPolygon(
          new THREE.Shape(),
          [
            [-deckW / 2, deckZ - deckL / 2],
            [deckW / 2, deckZ - deckL / 2],
            [deckW / 2, deckZ + deckL / 2],
            [-deckW / 2, deckZ + deckL / 2],
          ],
          6,
        );
        const cols = Math.max(2, Math.floor((deckW - 18) / 12) + 1);
        const rows = Math.max(2, Math.floor((deckL - 24) / 12) + 1);
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const hx = -((cols - 1) * 12) / 2 + c * 12;
            const hz = deckZ - ((rows - 1) * 12) / 2 + r * 12;
            shape.holes.push(holeAt(hx, hz, 1.5));
          }
        }
        shape.holes.push(slotAt(0, deckZ + deckL * 0.18, deckW * 0.36, 6, false));
        return shape;
      }, PLATE_T),
    [key, deckW, deckL, deckZ],
  );

  const standoffs = useMemo<InstanceTransform[]>(() => {
    const sx = deckW / 2 - 5;
    const sz = deckL / 2 - 5;
    return [-sz, 0, sz].flatMap((z) => [-sx, sx].map((x) => ({ p: [x, 0, deckZ + z] as Vec3 })));
  }, [deckW, deckL, deckZ]);
  const screwHeads = useMemo<InstanceTransform[]>(
    () => standoffs.map((t) => ({ p: [t.p[0], h / 2 + 0.6, t.p[2]] as Vec3 })),
    [standoffs, h],
  );
  const screwSlots = useMemo<InstanceTransform[]>(
    () =>
      standoffs.flatMap((t) => [
        { p: [t.p[0], h / 2 + 1.21, t.p[2]] as Vec3 },
        { p: [t.p[0], h / 2 + 1.21, t.p[2]] as Vec3, r: [0, Math.PI / 2, 0] as Vec3 },
      ]),
    [standoffs, h],
  );

  return (
    <group name="chassis-visual">
      <mesh name="base-plate" geometry={baseGeo} material={baseMat} position={[0, -h / 2, 0]} />
      <mesh name="upper-deck" geometry={deckGeo} material={deckMat} position={[0, h / 2 - PLATE_T, 0]} />
      <Instances name="standoffs" geometry={cylinder(2.7, 2.7, gap, 6)} material={brass} transforms={standoffs} />
      <Instances name="deck-screws" geometry={cylinder(2.5, 2.7, 1.2, 20)} material={chrome} transforms={screwHeads} />
      <Instances name="deck-screw-recess" geometry={roundedBox(2.6, 0.3, 0.55, 0.1, 1)} material={recess} transforms={screwSlots} />
      <mesh
        name="nose-bumper"
        geometry={roundedBox(frontW - 8, PLATE_T + 2.2, 3.2, 1.2, 3)}
        material={rubber}
        position={[0, -h / 2 + (PLATE_T + 2.2) / 2, d / 2 - 1.4]}
      />
    </group>
  );
}
