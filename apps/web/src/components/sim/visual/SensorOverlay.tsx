import { Line } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { headingToYaw, sensorFanPositions, sensorHitSim, sensorOriginSim, sensorTone, simToWorld, visibleRayLength } from "./pose";
import type { SensorTone } from "./pose";
import type { RoverVisualConfig, SimSnapshot } from "./types";

export const SENSOR_COLORS: Record<SensorTone, string> = {
  clear: "#38d6ff",
  detected: "#ffb020",
  threshold: "#ff3b2f",
};

const SENSOR_HEIGHT_M = 0.004;

export interface SensorOverlayProps {
  snapshot: SimSnapshot;
  config: RoverVisualConfig;
}

/** Field-of-view fan, center ray and hit marker for the front range sensor. */
export function SensorOverlay({ snapshot, config }: SensorOverlayProps) {
  const tone = sensorTone(snapshot, config.stop_distance_m);
  const color = SENSOR_COLORS[tone];
  const origin = sensorOriginSim(snapshot, config.sensor_offset_m);
  const hit = sensorHitSim(snapshot, config.sensor_offset_m);
  const range = Math.max(0.001, snapshot.sensor_range_m);
  const hasReturn = tone !== "clear";

  const length = visibleRayLength(snapshot);
  // Filled fan stops at the detected return; the outline shows the full configured range.
  const fillLength = Math.max(0.001, length);
  const fan = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sensorFanPositions(config.sensor_fov_deg, fillLength, 28), 3));
    return g;
  }, [config.sensor_fov_deg, fillLength]);
  useEffect(() => () => fan.dispose(), [fan]);

  const edge = useMemo(() => {
    const half = ((config.sensor_fov_deg * Math.PI) / 180) / 2;
    const pts: Array<[number, number, number]> = [];
    const n = 28;
    pts.push([0, 0, 0]);
    for (let i = 0; i <= n; i++) {
      const a = -half + (2 * half * i) / n;
      pts.push([Math.sin(a) * range, 0, Math.cos(a) * range]);
    }
    pts.push([0, 0, 0]);
    return pts;
  }, [config.sensor_fov_deg, range]);

  const o = simToWorld(origin.x_m, origin.y_m, SENSOR_HEIGHT_M);
  const h = simToWorld(hit.x_m, hit.y_m, SENSOR_HEIGHT_M);

  return (
    <group name="sensor-overlay" userData={{ tone, length_m: length }}>
      <group position={o} rotation={[0, headingToYaw(snapshot.theta_rad), 0]}>
        <mesh geometry={fan} renderOrder={1}>
          <meshBasicMaterial color={color} transparent opacity={hasReturn ? 0.22 : 0.12} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <Line points={edge} color={color} lineWidth={1} transparent opacity={0.35} depthWrite={false} dashed dashSize={0.02} gapSize={0.015} />
      </group>
      <Line points={[o, h]} color={color} lineWidth={hasReturn ? 2.6 : 1.6} dashed={!hasReturn} dashSize={0.03} gapSize={0.02} toneMapped={false} />
      {hasReturn ? (
        <group position={h}>
          <mesh>
            <sphereGeometry args={[0.012, 18, 12]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.02, 0.028, 32]} />
            <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}
