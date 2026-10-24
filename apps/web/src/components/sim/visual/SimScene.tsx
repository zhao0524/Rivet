import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { PathTrail } from "./PathTrail";
import { arenaCenterWorld, arenaSize, snapshotToPose } from "./pose";
import type { Vec3 } from "./pose";
import { RoverModel } from "./RoverModel";
import { SensorOverlay } from "./SensorOverlay";
import { SimStage } from "./SimStage";
import type { RoverVisualConfig, SimArena, SimObstacle, SimSnapshot } from "./types";

export interface SimSceneProps {
  snapshot: SimSnapshot | null;
  obstacles: readonly SimObstacle[];
  arena: SimArena;
  config: RoverVisualConfig;
  playing: boolean;
  showTrail: boolean;
  cameraMode?: SimCameraMode;
}

export type SimCameraMode = "overview" | "follow";

export function SimScene({ snapshot, obstacles, arena, config, playing, showTrail, cameraMode = "overview" }: SimSceneProps) {
  const target = arenaCenterWorld(arena);
  const span = Math.max(arenaSize(arena).width_m, arenaSize(arena).depth_m);
  return (
    <>
      <CameraFraming arena={arena} mode={cameraMode} />
      {cameraMode === "follow" && snapshot ? <FollowRig snapshot={snapshot} /> : null}
      <OrbitControls
        makeDefault
        target={target}
        enableDamping
        dampingFactor={0.12}
        minDistance={0.25}
        maxDistance={span * 3}
        maxPolarAngle={Math.PI * 0.46}
      />
      <SimStage arena={arena} obstacles={obstacles} />
      {snapshot ? (
        <>
          {showTrail ? <PathTrail trail={snapshot.trail} /> : null}
          <SensorOverlay snapshot={snapshot} config={config} />
          <RoverModel snapshot={snapshot} config={config} animate={playing} />
        </>
      ) : null}
    </>
  );
}

/** Opening camera framed on the course; re-frames only when the course bounds change. */
export function framingCameraPosition(arena: SimArena, aspect: number): Vec3 {
  const center = arenaCenterWorld(arena);
  const { width_m, depth_m } = arenaSize(arena);
  const fit = Math.max(width_m / Math.max(aspect, 0.5), depth_m);
  const dist = fit * 1.05 + 0.35;
  return [center[0] - width_m * 0.08, dist * 0.78, center[2] + dist * 0.82];
}

/** Chase offset behind and above the rover, in rover-local axes (front is +z). */
export const FOLLOW_OFFSET: Vec3 = [0.28, 0.36, -0.52];

export function followCameraPosition(snapshot: Pick<SimSnapshot, "x_m" | "y_m" | "theta_rad">): Vec3 {
  const { position, yaw_rad } = snapshotToPose(snapshot);
  const [ox, oy, oz] = FOLLOW_OFFSET;
  const c = Math.cos(yaw_rad);
  const s = Math.sin(yaw_rad);
  return [position[0] + ox * c + oz * s, position[1] + oy, position[2] - ox * s + oz * c];
}

/** Keeps the orbit target on the rover while preserving the user's orbit offset. */
function FollowRig({ snapshot }: { snapshot: SimSnapshot }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  const placed = useRef(false);
  const goal = useRef(new THREE.Vector3());

  useLayoutEffect(() => {
    if (!controls || placed.current) return;
    const [px, py, pz] = followCameraPosition(snapshot);
    const { position } = snapshotToPose(snapshot);
    camera.position.set(px, py, pz);
    controls.target.set(position[0], 0.03, position[2]);
    controls.update();
    placed.current = true;
    invalidate();
  }, [camera, controls, snapshot, invalidate]);

  useFrame(() => {
    if (!controls) return;
    const { position } = snapshotToPose(snapshot);
    goal.current.set(position[0], 0.03, position[2]);
    const delta = goal.current.clone().sub(controls.target);
    if (delta.lengthSq() < 1e-10) return;
    delta.multiplyScalar(0.25);
    controls.target.add(delta);
    camera.position.add(delta);
    controls.update();
    invalidate();
  });
  return null;
}

function CameraFraming({ arena, mode }: { arena: SimArena; mode: SimCameraMode }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const { min_x_m, max_x_m, min_y_m, max_y_m } = arena;
  useLayoutEffect(() => {
    if (mode !== "overview") return;
    const [x, y, z] = framingCameraPosition({ min_x_m, max_x_m, min_y_m, max_y_m }, aspect);
    camera.position.set(x, y, z);
    const c = arenaCenterWorld({ min_x_m, max_x_m, min_y_m, max_y_m });
    if (controls) {
      controls.target.set(c[0], c[1], c[2]);
      controls.update();
    }
    camera.lookAt(c[0], c[1], c[2]);
    camera.updateProjectionMatrix();
    // Aspect is intentionally read once per course so resizing doesn't reset the user's orbit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, mode, min_x_m, max_x_m, min_y_m, max_y_m]);
  return null;
}
