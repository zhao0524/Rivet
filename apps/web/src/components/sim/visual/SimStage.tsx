import { Grid, RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { arenaCenterWorld, arenaSize, simToWorld } from "./pose";
import type { SimArena, SimObstacle } from "./types";

const DEFAULT_OBSTACLE_HEIGHT_M = 0.22;
const CURB_HEIGHT_M = 0.035;
const CURB_THICKNESS_M = 0.03;
export const STAGE_BACKGROUND = "#0e131a";

export function SimStage({ arena, obstacles }: { arena: SimArena; obstacles: readonly SimObstacle[] }) {
  const center = arenaCenterWorld(arena);
  const { width_m, depth_m } = arenaSize(arena);
  const span = Math.max(width_m, depth_m);
  const mats = useStageMaterials();

  return (
    <group name="sim-stage">
      <color attach="background" args={[STAGE_BACKGROUND]} />
      <fog attach="fog" args={[STAGE_BACKGROUND, span * 1.6, span * 4.5]} />

      <hemisphereLight args={["#d6e6ff", "#141a22", 0.65]} />
      <ambientLight intensity={0.12} />
      <directionalLight
        position={[center[0] + span * 0.45, span * 1.25, center[2] + span * 0.6]}
        intensity={2.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0008}
        shadow-normalBias={0.03}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={0.1}
        shadow-camera-far={span * 4}
      >
        <object3D attach="target" position={center} />
      </directionalLight>
      <directionalLight position={[center[0] - span, span * 0.6, center[2] - span]} intensity={0.45} color="#8fb8ff" />

      {/* Surrounding floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], -0.001, center[2]]} receiveShadow material={mats.floor}>
        <planeGeometry args={[span * 6, span * 6]} />
      </mesh>
      {/* Course mat */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], 0, center[2]]} receiveShadow material={mats.mat}>
        <planeGeometry args={[width_m, depth_m]} />
      </mesh>
      <Grid
        position={[center[0], 0.0008, center[2]]}
        args={[width_m, depth_m]}
        cellSize={0.1}
        cellThickness={0.6}
        cellColor="#2b3746"
        sectionSize={0.5}
        sectionThickness={1.1}
        sectionColor="#3d5068"
        fadeDistance={span * 4}
        fadeStrength={1}
      />

      <ArenaCurbs arena={arena} material={mats.curb} />

      {obstacles.map((o) => (
        <Obstacle key={o.id} obstacle={o} mats={mats} />
      ))}
    </group>
  );
}

function ArenaCurbs({ arena, material }: { arena: SimArena; material: THREE.Material }) {
  const { width_m, depth_m } = arenaSize(arena);
  const cx = (arena.min_x_m + arena.max_x_m) / 2;
  const cy = (arena.min_y_m + arena.max_y_m) / 2;
  const t = CURB_THICKNESS_M;
  const h = CURB_HEIGHT_M;
  const curbs: Array<{ key: string; pos: [number, number]; size: [number, number] }> = [
    { key: "n", pos: [cx, arena.max_y_m + t / 2], size: [width_m + 2 * t, t] },
    { key: "s", pos: [cx, arena.min_y_m - t / 2], size: [width_m + 2 * t, t] },
    { key: "e", pos: [arena.max_x_m + t / 2, cy], size: [t, depth_m] },
    { key: "w", pos: [arena.min_x_m - t / 2, cy], size: [t, depth_m] },
  ];
  return (
    <group name="arena-curbs">
      {curbs.map((c) => (
        <mesh key={c.key} position={simToWorld(c.pos[0], c.pos[1], h / 2)} material={material} castShadow receiveShadow>
          <boxGeometry args={[c.size[0], h, c.size[1]]} />
        </mesh>
      ))}
    </group>
  );
}

function Obstacle({ obstacle, mats }: { obstacle: SimObstacle; mats: StageMaterials }) {
  const h = obstacle.height_m ?? DEFAULT_OBSTACLE_HEIGHT_M;
  const band = Math.min(0.03, h * 0.14);
  if (obstacle.kind === "circle") {
    return (
      <group name={`obstacle-${obstacle.id}`} position={simToWorld(obstacle.x_m, obstacle.y_m)}>
        <mesh position={[0, h / 2, 0]} material={mats.block} castShadow receiveShadow>
          <cylinderGeometry args={[obstacle.radius_m, obstacle.radius_m, h, 48]} />
        </mesh>
        <mesh position={[0, h - band / 2 + 0.0015, 0]} material={mats.accent} castShadow>
          <cylinderGeometry args={[obstacle.radius_m + 0.002, obstacle.radius_m + 0.002, band, 48]} />
        </mesh>
        <FootprintRing radius={obstacle.radius_m} material={mats.footprint} />
      </group>
    );
  }
  const radius = Math.min(0.012, Math.min(obstacle.width_m, obstacle.depth_m) * 0.2);
  return (
    <group
      name={`obstacle-${obstacle.id}`}
      position={simToWorld(obstacle.x_m, obstacle.y_m)}
      rotation={[0, obstacle.rotation_rad ?? 0, 0]}
    >
      <RoundedBox args={[obstacle.width_m, h, obstacle.depth_m]} radius={radius} smoothness={3} position={[0, h / 2, 0]} material={mats.block} castShadow receiveShadow />
      <mesh position={[0, h - band / 2 + 0.0015, 0]} material={mats.accent} castShadow>
        <boxGeometry args={[obstacle.width_m + 0.004, band, obstacle.depth_m + 0.004]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0012, 0]} material={mats.footprint}>
        <planeGeometry args={[obstacle.width_m + 0.03, obstacle.depth_m + 0.03]} />
      </mesh>
    </group>
  );
}

function FootprintRing({ radius, material }: { radius: number; material: THREE.Material }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0012, 0]} material={material}>
      <circleGeometry args={[radius + 0.015, 48]} />
    </mesh>
  );
}

type StageMaterials = ReturnType<typeof createStageMaterials>;

function createStageMaterials() {
  return {
    floor: new THREE.MeshStandardMaterial({ color: "#121821", roughness: 0.96, metalness: 0 }),
    mat: new THREE.MeshStandardMaterial({ color: "#1b232e", roughness: 0.88, metalness: 0.02 }),
    curb: new THREE.MeshStandardMaterial({ color: "#3a4656", roughness: 0.7, metalness: 0.1 }),
    block: new THREE.MeshStandardMaterial({ color: "#e9e5dc", roughness: 0.78, metalness: 0 }),
    accent: new THREE.MeshStandardMaterial({ color: "#ff7a1a", roughness: 0.55, metalness: 0.05 }),
    footprint: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28, depthWrite: false }),
  };
}

function useStageMaterials(): StageMaterials {
  const mats = useMemo(createStageMaterials, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return mats;
}
