import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { MathUtils } from 'three';
import { knownDimensions } from './anchors';
import type { WiringCatalogComponent, WiringPlanInput } from './types';
import { WiringOverlay, type WiringOverlayProps } from './WiringOverlay';

/**
 * Standalone stage for developing and demoing the overlay without the studio renderer.
 * Components are drawn as translucent bounds boxes only; they are placeholders, not part meshes.
 */
export function WiringPreviewStage({
  plan,
  catalog,
  overlay,
}: {
  plan: WiringPlanInput;
  catalog: readonly WiringCatalogComponent[];
  overlay?: Partial<WiringOverlayProps>;
}) {
  const byId = new Map(catalog.map((c) => [c.catalog_id, c] as const));
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [180, 160, 220], fov: 40, near: 1, far: 5000 }}>
      <color attach="background" args={['#14171C']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[200, 300, 150]} intensity={1.2} />
      {plan.components.map((c) => {
        const component = byId.get(c.catalog_id);
        const dims = component && knownDimensions(component);
        if (!dims) return null;
        const [rx = 0, ry = 0, rz = 0] = c.pose.rotation_deg;
        return (
          <mesh
            key={c.instance_id}
            name={`bounds:${c.instance_id}`}
            position={c.pose.position_mm as [number, number, number]}
            rotation={[MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz), 'XYZ']}
          >
            <boxGeometry args={dims as [number, number, number]} />
            <meshStandardMaterial color="#64748B" transparent opacity={0.18} depthWrite={false} />
          </mesh>
        );
      })}
      <WiringOverlay plan={plan} catalog={catalog} {...overlay} />
      <OrbitControls makeDefault minDistance={80} maxDistance={900} />
    </Canvas>
  );
}
