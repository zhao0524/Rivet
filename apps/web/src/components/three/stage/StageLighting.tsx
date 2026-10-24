'use client';

import { Environment, Lightformer } from '@react-three/drei';
import type { StageTheme } from './theme';

/**
 * Physically based studio rig. Directional lights are defined by direction only
 * (their target stays at the origin), so they read the same at any scale.
 * Reflections come from a procedural light-box environment rendered once; no
 * HDR files are fetched, so the stage works offline.
 */
export function StageLighting({ theme }: { theme: StageTheme }) {
  return (
    <>
      <hemisphereLight args={[theme.skyLight, theme.groundBounce, 0.5]} />
      <directionalLight color={theme.keyLight} intensity={2.6} position={[-0.55, 0.9, 0.65]} />
      <directionalLight color={theme.fillLight} intensity={0.5} position={[0.9, 0.3, 0.45]} />
      <directionalLight color={theme.rimLight} intensity={1.8} position={[0.4, 0.55, -0.95]} />
      <Environment resolution={256} frames={1} environmentIntensity={0.9}>
        <Lightformer form="rect" intensity={2.4} color="#ffffff" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[8, 4, 1]} />
        <Lightformer form="rect" intensity={1.6} color={theme.keyLight} position={[-6, 2, 3]} rotation-y={Math.PI / 2.4} scale={[3, 6, 1]} />
        <Lightformer form="rect" intensity={1.1} color={theme.rimLight} position={[5, 2, -4]} rotation-y={-Math.PI / 1.6} scale={[3, 5, 1]} />
        <Lightformer form="ring" intensity={0.5} color="#ffffff" position={[0, 1.5, 7]} scale={2.5} />
      </Environment>
    </>
  );
}
