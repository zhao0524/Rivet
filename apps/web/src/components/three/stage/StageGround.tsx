'use client';

import { ContactShadows, Grid } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { gridSpacingForRadius, type CameraFit } from './cameraFit';
import type { StageTheme } from './theme';

export interface StageGroundProps {
  fit: CameraFit;
  theme: StageTheme;
  showGrid: boolean;
}

/**
 * The grid's shader lays a vertical plane flat; under the contact-shadow
 * override material it would stand upright and blacken the shadow map, so the
 * grid lives on a layer only the main camera sees.
 */
export const GRID_LAYER = 1;

/**
 * Floor at the lowest point of the framed bounds with contact shadows and an
 * optional millimeter grid aligned to the world origin (canonical chassis origin).
 * Grid spacing follows a 1-2-5 mm ladder so it never turns into moiré.
 */
export function StageGround({ fit, theme, showGrid }: StageGroundProps) {
  const groundY = fit.bounds.min[1];
  const [cx, , cz] = fit.target;
  const r = fit.radius;
  const height = fit.bounds.max[1] - fit.bounds.min[1];
  const { cell, section } = gridSpacingForRadius(r);
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.layers.enable(GRID_LAYER);
  }, [camera]);

  return (
    <group name="rivet-stage-ground">
      <mesh rotation-x={-Math.PI / 2} position={[cx, groundY - r * 0.002, cz]}>
        <circleGeometry args={[r * 60, 96]} />
        <meshStandardMaterial color={theme.floor} roughness={0.94} metalness={0} />
      </mesh>
      <ContactShadows
        position={[cx, groundY + r * 0.0008, cz]}
        scale={r * 5}
        far={Math.max(height, r) * 1.2}
        blur={3}
        opacity={theme.shadowOpacity}
        color={theme.shadow}
        resolution={512}
      />
      {showGrid && (
        <Grid
          layers={GRID_LAYER}
          position={[0, groundY + r * 0.0004, 0]}
          cellSize={cell}
          sectionSize={section}
          cellThickness={0.6}
          sectionThickness={1.1}
          cellColor={theme.gridCell}
          sectionColor={theme.gridSection}
          fadeDistance={fit.distance + r * 4}
          fadeStrength={1.6}
          infiniteGrid
        />
      )}
    </group>
  );
}
