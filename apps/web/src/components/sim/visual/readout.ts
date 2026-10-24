import { angularSpeed, isDisabledState, linearSpeed } from "./pose";
import type { SimSnapshot } from "./types";

export const SIM_DISCLAIMER =
  "Simplified kinematic simulation; not a guarantee of real-world performance";

export type StateTone = "forward" | "stop" | "turn" | "disabled" | "unknown";

export function stateTone(state: string): StateTone {
  if (state === "FORWARD") return "forward";
  if (state === "STOP") return "stop";
  if (state === "TURN") return "turn";
  if (isDisabledState(state)) return "disabled";
  return "unknown";
}

export function stateLabel(state: string): string {
  if (isDisabledState(state)) return "DISABLED";
  return state || "UNKNOWN";
}

export function formatMeters(value: number, digits = 2): string {
  return `${value.toFixed(digits)} m`;
}

export function formatDistance(
  snapshot: Pick<SimSnapshot, "sensor_distance_m" | "sensor_range_m">,
): string {
  const d = snapshot.sensor_distance_m;
  if (d == null || !Number.isFinite(d)) {
    return `No return (> ${formatMeters(snapshot.sensor_range_m)})`;
  }
  return formatMeters(Math.max(0, d));
}

export function formatSpeed(mps: number): string {
  const v = Math.abs(mps) < 0.0005 ? 0 : mps;
  return `${v.toFixed(3)} m/s`;
}

export function formatHeadingDeg(theta_rad: number): string {
  const deg = ((((theta_rad * 180) / Math.PI) % 360) + 360) % 360;
  return `${deg.toFixed(0)}°`;
}

export interface ReadoutModel {
  state: string;
  tone: StateTone;
  distance: string;
  speed: string;
  turnRate: string;
  wheels: string;
  pose: string;
  collision: boolean;
}

export function buildReadout(snapshot: SimSnapshot, wheel_base_m: number): ReadoutModel {
  const omega = angularSpeed(snapshot, wheel_base_m);
  return {
    state: stateLabel(snapshot.state),
    tone: stateTone(snapshot.state),
    distance: formatDistance(snapshot),
    speed: formatSpeed(linearSpeed(snapshot)),
    turnRate: `${(Math.abs(omega) < 0.0005 ? 0 : omega).toFixed(2)} rad/s`,
    wheels: `L ${formatSpeed(snapshot.wheel_speed_left_mps)} · R ${formatSpeed(snapshot.wheel_speed_right_mps)}`,
    pose: `${formatMeters(snapshot.x_m)}, ${formatMeters(snapshot.y_m)} · ${formatHeadingDeg(snapshot.theta_rad)}`,
    collision: snapshot.collision,
  };
}
