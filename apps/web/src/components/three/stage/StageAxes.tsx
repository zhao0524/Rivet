'use client';

import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';
import type { CameraFit } from './cameraFit';
import { mmToScene, sceneToMm } from './units';

/** Axis colours, the usual X red / Y green / Z blue. */
export const AXIS_COLORS = { x: '#ff6b6b', y: '#5fe08f', z: '#5aa8ff' } as const;

/** Round ruler steps in millimetres. */
const STEPS_MM = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** A step that puts four to six ticks along `lengthMm`. */
function tickStep(lengthMm: number): number {
  return STEPS_MM.find((s) => lengthMm / s <= 6) ?? STEPS_MM[STEPS_MM.length - 1]!;
}

type Axis = keyof typeof AXIS_COLORS;

/**
 * X, Y and Z axes drawn from one corner of the model on the floor, each a millimetre ruler as long as
 * the model plus a margin, with labelled ticks, so sizes can be read off the scene. The corner is the
 * one nearest the default camera (which looks from +X, +Z), so X and Z run along the two near edges
 * of the floor and stay in front of the model instead of behind it. Works in scene units (metres),
 * like the ground.
 */
export function StageAxes({ fit }: { fit: CameraFit }) {
  const { min, max } = fit.bounds;
  const margin = fit.radius * 0.18;
  const origin: [number, number, number] = [max[0] + margin, min[1], max[2] + margin];

  const axes = useMemo(() => {
    const len = {
      x: max[0] - min[0] + margin * 2,
      y: max[1] - min[1] + margin,
      z: max[2] - min[2] + margin * 2,
    };
    return (['x', 'y', 'z'] as const).map((axis) => {
      const lengthMm = sceneToMm(len[axis]);
      const step = tickStep(lengthMm);
      const ticks: number[] = [];
      for (let mm = step; mm < lengthMm - step * 0.25; mm += step) ticks.push(mm);
      return { axis, length: len[axis], step, ticks };
    });
  }, [min, max, margin]);

  // From the near corner, X and Z run away from the camera along the floor's near edges.
  const along = (axis: Axis, d: number): [number, number, number] => [
    origin[0] - (axis === 'x' ? d : 0),
    origin[1] + (axis === 'y' ? d : 0),
    origin[2] - (axis === 'z' ? d : 0),
  ];
  const tick = fit.radius * 0.025;
  const head = fit.radius * 0.06;

  return (
    <group name="rivet-stage-axes">
      {axes.map(({ axis, length, ticks }) => {
        const end = along(axis, length);
        const color = AXIS_COLORS[axis];
        // Ticks stand off each ruler on its outer side, toward the camera.
        const across: [number, number, number] = axis === 'x' ? [0, 0, tick] : [tick, 0, 0];
        return (
          <group key={axis}>
            <Line points={[origin, end]} color={color} lineWidth={2} transparent opacity={0.95} />
            <mesh
              position={end}
              rotation={axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
            >
              <coneGeometry args={[head * 0.35, head, 16]} />
              <meshBasicMaterial color={color} />
            </mesh>
            {ticks.map((mm) => {
              const p = along(axis, mmToScene(mm));
              return (
                <group key={mm}>
                  <Line
                    points={[p, [p[0] + across[0], p[1] + across[1], p[2] + across[2]]]}
                    color={color}
                    lineWidth={1.4}
                    transparent
                    opacity={0.8}
                  />
                  <Html position={[p[0] + across[0] * 2.2, p[1] + across[1] * 2.2, p[2] + across[2] * 2.2]} center zIndexRange={[5, 0]}>
                    <span className="rivet-axis-tick" style={{ color }}>
                      {mm}
                    </span>
                  </Html>
                </group>
              );
            })}
            <Html position={along(axis, length + head * 1.4)} center zIndexRange={[5, 0]}>
              <span className="rivet-axis-label" style={{ color }}>
                {axis.toUpperCase()}
                <small> mm</small>
              </span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
