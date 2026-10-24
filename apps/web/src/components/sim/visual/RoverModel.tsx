import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { advanceWheelAngle, snapshotToPose } from "./pose";
import type { RoverVisualConfig, SimSnapshot } from "./types";

export interface RoverModelProps {
  snapshot: SimSnapshot;
  config: RoverVisualConfig;
  /** Wheels only spin while playing so a paused frame reads as paused. */
  animate: boolean;
}

/**
 * Procedural visual rover. Its kinematic center (midpoint of the drive axle)
 * sits at the group origin on the floor, and its front faces local +z. Left
 * wheel is local +x. Body proportions scale with wheel base and radius; this
 * is a representation for the simulator, not the part-backed studio model.
 */
export function RoverModel({ snapshot, config, animate }: RoverModelProps) {
  const pose = snapshotToPose(snapshot);
  const leftWheel = useRef<THREE.Group>(null);
  const rightWheel = useRef<THREE.Group>(null);
  const angles = useRef({ left: 0, right: 0 });
  const speeds = useRef({ left: 0, right: 0 });
  speeds.current.left = snapshot.wheel_speed_left_mps;
  speeds.current.right = snapshot.wheel_speed_right_mps;

  const dims = useMemo(() => roverDimensions(config), [config]);
  const mats = useRoverMaterials();

  useEffect(() => {
    mats.chassis.emissive.set(snapshot.collision ? "#ff2a1a" : "#000000");
    mats.chassis.emissiveIntensity = snapshot.collision ? 0.55 : 0;
  }, [mats, snapshot.collision]);

  useFrame((_, delta) => {
    if (!animate) return;
    const dt = Math.min(delta, 0.1);
    angles.current.left = advanceWheelAngle(angles.current.left, speeds.current.left, config.wheel_radius_m, dt);
    angles.current.right = advanceWheelAngle(angles.current.right, speeds.current.right, config.wheel_radius_m, dt);
    if (leftWheel.current) leftWheel.current.rotation.x = angles.current.left;
    if (rightWheel.current) rightWheel.current.rotation.x = angles.current.right;
  });

  const { r, track, wheelW, bodyW, bodyL, deckY, deck2Y, axleZ } = dims;

  return (
    <group position={pose.position} rotation={[0, pose.yaw_rad, 0]} name="rover" userData={{ x_m: snapshot.x_m, y_m: snapshot.y_m, theta_rad: snapshot.theta_rad }}>
      {/* Lower chassis plate */}
      <RoundedBox args={[bodyW, 0.005, bodyL]} radius={0.0022} smoothness={3} position={[0, deckY, axleZ - bodyL * 0.12]} castShadow receiveShadow material={mats.chassis} />
      {/* Upper deck on standoffs */}
      <RoundedBox args={[bodyW * 0.86, 0.004, bodyL * 0.62]} radius={0.0018} smoothness={3} position={[0, deck2Y, axleZ - bodyL * 0.05]} castShadow material={mats.deck} />
      {standoffPositions(bodyW * 0.86, bodyL * 0.62).map(([x, z], i) => (
        <mesh key={i} position={[x, (deckY + deck2Y) / 2, z + axleZ - bodyL * 0.05]} material={mats.metal} castShadow>
          <cylinderGeometry args={[0.0028, 0.0028, deck2Y - deckY, 10]} />
        </mesh>
      ))}

      {/* Gear motors */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[side * (bodyW / 2 - 0.022), deckY - 0.012, axleZ]} material={mats.motor} castShadow>
          <boxGeometry args={[0.042, 0.022, 0.07]} />
        </mesh>
      ))}

      {/* Battery pack under the upper deck */}
      <RoundedBox args={[bodyW * 0.5, 0.018, bodyL * 0.32]} radius={0.003} smoothness={3} position={[0, deckY + 0.012, axleZ - bodyL * 0.3]} material={mats.battery} castShadow />

      {/* Controller board */}
      <group position={[0, deck2Y + 0.005, axleZ - bodyL * 0.08]}>
        <RoundedBox args={[0.028, 0.0035, 0.052]} radius={0.001} smoothness={2} material={mats.pcb} castShadow />
        <mesh position={[0, 0.003, 0.008]} material={mats.shield} castShadow>
          <boxGeometry args={[0.018, 0.003, 0.024]} />
        </mesh>
        <mesh position={[0, 0.004, -0.02]} material={mats.statusLed}>
          <boxGeometry args={[0.003, 0.002, 0.003]} />
        </mesh>
      </group>

      {/* Front range sensor */}
      <group position={[0, deckY + 0.024, config.sensor_offset_m - 0.006]}>
        <mesh material={mats.sensorPcb} castShadow>
          <boxGeometry args={[0.045, 0.02, 0.0025]} />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.013, 0, 0.007]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh material={mats.transducer} castShadow>
              <cylinderGeometry args={[0.008, 0.008, 0.012, 20]} />
            </mesh>
            <mesh position={[0, 0.0062, 0]} material={mats.mesh}>
              <cylinderGeometry args={[0.0062, 0.0062, 0.001, 20]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, -0.014, -0.004]} material={mats.metal}>
          <boxGeometry args={[0.03, 0.01, 0.002]} />
        </mesh>
      </group>

      {/* Rear caster */}
      <mesh position={[0, 0.009, axleZ - bodyL * 0.62]} material={mats.metal} castShadow>
        <sphereGeometry args={[0.009, 20, 14]} />
      </mesh>
      <mesh position={[0, deckY - 0.006, axleZ - bodyL * 0.62]} material={mats.motor}>
        <cylinderGeometry args={[0.012, 0.012, 0.01, 16]} />
      </mesh>

      {/* Drive wheels: left is +x, right is -x */}
      <group ref={leftWheel} position={[track / 2, r, axleZ]}>
        <Wheel radius={r} width={wheelW} mats={mats} />
      </group>
      <group ref={rightWheel} position={[-track / 2, r, axleZ]}>
        <Wheel radius={r} width={wheelW} mats={mats} />
      </group>

      {/* Collision ring */}
      {snapshot.collision ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, axleZ - bodyL * 0.1]}>
          <ringGeometry args={[bodyL * 0.62, bodyL * 0.7, 48]} />
          <meshBasicMaterial color="#ff3b2f" transparent opacity={0.85} toneMapped={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function Wheel({ radius, width, mats }: { radius: number; width: number; mats: RoverMaterials }) {
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} material={mats.tire} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, width, 40]} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * width * 0.502, 0, 0]} rotation={[0, s * Math.PI / 2, 0]} material={mats.hub}>
          <ringGeometry args={[radius * 0.34, radius * 0.72, 32]} />
        </mesh>
      ))}
      {/* Spokes make rotation readable */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[(i * Math.PI) / 3, 0, 0]} position={[width * 0.505, 0, 0]} material={mats.spoke}>
          <boxGeometry args={[0.0015, radius * 1.42, radius * 0.16]} />
        </mesh>
      ))}
      <mesh position={[width * 0.506, radius * 0.55, 0]} material={mats.marker}>
        <boxGeometry args={[0.0016, radius * 0.18, radius * 0.18]} />
      </mesh>
    </group>
  );
}

export function roverDimensions(config: RoverVisualConfig) {
  const r = config.wheel_radius_m;
  const track = config.wheel_base_m;
  const wheelW = Math.min(0.028, Math.max(0.014, track * 0.17));
  const bodyW = Math.max(0.06, track - wheelW - 0.012);
  const bodyL = Math.max(0.12, Math.max(config.sensor_offset_m * 1.65, track * 1.3));
  return {
    r,
    track,
    wheelW,
    bodyW,
    bodyL,
    deckY: r * 0.95,
    deck2Y: r * 0.95 + 0.032,
    axleZ: 0,
  };
}

function standoffPositions(w: number, l: number): Array<[number, number]> {
  const x = w / 2 - 0.006;
  const z = l / 2 - 0.006;
  return [
    [x, z],
    [-x, z],
    [x, -z],
    [-x, -z],
  ];
}

type RoverMaterials = ReturnType<typeof createRoverMaterials>;

function createRoverMaterials() {
  return {
    chassis: new THREE.MeshPhysicalMaterial({ color: "#20262f", roughness: 0.45, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.35 }),
    deck: new THREE.MeshPhysicalMaterial({ color: "#2e6bd6", roughness: 0.35, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.25 }),
    metal: new THREE.MeshStandardMaterial({ color: "#b9c0c8", roughness: 0.3, metalness: 0.85 }),
    motor: new THREE.MeshStandardMaterial({ color: "#e3b31c", roughness: 0.55, metalness: 0.05 }),
    battery: new THREE.MeshStandardMaterial({ color: "#14171c", roughness: 0.6, metalness: 0.1 }),
    pcb: new THREE.MeshStandardMaterial({ color: "#11161d", roughness: 0.5, metalness: 0.2 }),
    shield: new THREE.MeshStandardMaterial({ color: "#d4d8dd", roughness: 0.25, metalness: 0.9 }),
    statusLed: new THREE.MeshBasicMaterial({ color: "#46ff9a", toneMapped: false }),
    sensorPcb: new THREE.MeshStandardMaterial({ color: "#1c5fb8", roughness: 0.5, metalness: 0.1 }),
    transducer: new THREE.MeshStandardMaterial({ color: "#cfd5dc", roughness: 0.3, metalness: 0.8 }),
    mesh: new THREE.MeshStandardMaterial({ color: "#2a2f36", roughness: 0.9, metalness: 0.2 }),
    tire: new THREE.MeshStandardMaterial({ color: "#16181b", roughness: 0.92, metalness: 0 }),
    hub: new THREE.MeshStandardMaterial({ color: "#f2c230", roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide }),
    spoke: new THREE.MeshStandardMaterial({ color: "#f7f8fa", roughness: 0.5 }),
    marker: new THREE.MeshBasicMaterial({ color: "#ff5a36", toneMapped: false }),
  };
}

function useRoverMaterials(): RoverMaterials {
  const mats = useMemo(createRoverMaterials, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return mats;
}
