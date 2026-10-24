import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { simToWorld } from "./pose";
import type { SimTrailPoint } from "./types";

export const MAX_TRAIL_POINTS = 1200;

/** Evenly decimates a long trail, always keeping the newest point. */
export function decimateTrail(trail: readonly SimTrailPoint[], max = MAX_TRAIL_POINTS): SimTrailPoint[] {
  if (trail.length <= max) return trail.slice();
  const step = trail.length / (max - 1);
  const out: SimTrailPoint[] = [];
  for (let i = 0; i < max - 1; i++) out.push(trail[Math.floor(i * step)]);
  out.push(trail[trail.length - 1]);
  return out;
}

export function PathTrail({ trail, color = "#7cf3c6" }: { trail: readonly SimTrailPoint[]; color?: string }) {
  const { points, colors } = useMemo(() => {
    const pts = decimateTrail(trail);
    const head = new THREE.Color(color);
    const tail = new THREE.Color("#1a2a33");
    const n = pts.length;
    return {
      points: pts.map((p) => simToWorld(p.x_m, p.y_m, 0.0025)),
      colors: pts.map((_, i) => {
        const c = tail.clone().lerp(head, n <= 1 ? 1 : 0.25 + (0.75 * i) / (n - 1));
        return [c.r, c.g, c.b] as [number, number, number];
      }),
    };
  }, [trail, color]);

  if (points.length < 2) return null;
  return <Line name="path-trail" points={points} vertexColors={colors} lineWidth={3} toneMapped={false} />;
}
