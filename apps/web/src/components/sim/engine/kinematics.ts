import { normalizeAngle } from "./geometry";
import type { Pose, WheelSpeeds } from "./types";

export interface BodyVelocity {
  v_mps: number;
  omega_radps: number;
}

/** v = (vR + vL) / 2, omega = (vR - vL) / wheelBase. */
export function bodyVelocity(wheels: WheelSpeeds, wheelBaseM: number): BodyVelocity {
  return {
    v_mps: (wheels.right_mps + wheels.left_mps) / 2,
    omega_radps: (wheels.right_mps - wheels.left_mps) / wheelBaseM,
  };
}

/** One explicit-Euler step of the unicycle model (implementation.md C4). */
export function integratePose(pose: Pose, velocity: BodyVelocity, dt: number): Pose {
  return {
    x: pose.x + velocity.v_mps * Math.cos(pose.theta) * dt,
    y: pose.y + velocity.v_mps * Math.sin(pose.theta) * dt,
    theta: normalizeAngle(pose.theta + velocity.omega_radps * dt),
  };
}

export function clampWheelSpeeds(wheels: WheelSpeeds, maxWheelSpeedMps: number): WheelSpeeds {
  const clamp = (s: number) => Math.max(-maxWheelSpeedMps, Math.min(maxWheelSpeedMps, s));
  return { left_mps: clamp(wheels.left_mps), right_mps: clamp(wheels.right_mps) };
}
