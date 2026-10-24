import { Canvas, context as FiberContext } from "@react-three/fiber";
import type { Context, ReactNode } from "react";
import { useContext, useMemo, useState } from "react";
import { computeArena, isDisabledState, resolveVisualConfig } from "./pose";
import { SIM_DISCLAIMER } from "./readout";
import { SimReadout } from "./SimReadout";
import { SimScene } from "./SimScene";
import type { SimCameraMode } from "./SimScene";
import styles from "./SimVisual.module.css";
import type { RoverVisualConfig, SimArena, SimObstacle, SimSnapshot } from "./types";

export interface RoverSimulationViewProps {
  /** Latest snapshot from the simulation engine; null before the first tick. */
  snapshot: SimSnapshot | null;
  obstacles: readonly SimObstacle[];
  /** Whether the engine is running; drives wheel animation and the render loop. */
  playing?: boolean;
  /** Values from the active BuildPlan (`simulation`, `behavior.parameters`). */
  config?: Partial<RoverVisualConfig>;
  /** Course bounds; derived from obstacles when omitted. */
  arena?: SimArena;
  /** Plan-provided limitations shown under the stage, e.g. `simulation.limitations`. */
  limitations?: readonly string[];
  /** Slot for `<SimulationControls />` or a designer replacement. */
  controls?: ReactNode;
  showTrail?: boolean;
  /** Starting camera; users can switch between course overview and rover follow. */
  initialCameraMode?: SimCameraMode;
  height?: number | string;
  className?: string;
}

/**
 * Self-contained simulator viewer with exactly one WebGL canvas. Mount it in
 * its own tab or panel; it refuses to render inside another R3F canvas.
 */
export function RoverSimulationView({
  snapshot,
  obstacles,
  playing = false,
  config,
  arena,
  limitations,
  controls,
  showTrail = true,
  initialCameraMode = "overview",
  height = 440,
  className,
}: RoverSimulationViewProps) {
  const parentCanvas = useContext(FiberContext as unknown as Context<unknown>) as unknown;
  const [cameraMode, setCameraMode] = useState<SimCameraMode>(initialCameraMode);
  const resolved = useMemo(
    () => resolveVisualConfig(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config?.wheel_base_m, config?.wheel_radius_m, config?.sensor_fov_deg, config?.sensor_offset_m, config?.stop_distance_m],
  );
  const hasSnapshot = snapshot !== null;
  const stageArena = useMemo(
    () => arena ?? computeArena(obstacles, obstacles.length > 0 ? null : snapshot),
    // Auto-bounds follow obstacles, not every snapshot, so the camera stays put while driving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arena, obstacles, obstacles.length > 0 || hasSnapshot],
  );

  if (parentCanvas) {
    if (process.env.NODE_ENV !== "production") {
      console.error("RoverSimulationView must be mounted in its own panel, not inside another <Canvas>.");
    }
    return null;
  }

  const disabled = snapshot ? isDisabledState(snapshot.state) : false;

  return (
    <section
      className={[styles.root, className].filter(Boolean).join(" ")}
      aria-label="Rover simulation"
      data-testid="rover-simulation-view"
      data-disabled={disabled ? "true" : "false"}
      data-state={snapshot?.state ?? "none"}
      data-collision={snapshot?.collision ? "true" : "false"}
    >
      <div className={styles.stage} style={{ height }}>
        <div className={styles.canvasHost}>
          <Canvas
            shadows
            dpr={[1, 1.5]}
            frameloop={playing ? "always" : "demand"}
            camera={{ fov: 38, near: 0.01, far: 80, position: [0, 2, 2.5] }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
          >
            <SimScene
              snapshot={snapshot}
              obstacles={obstacles}
              arena={stageArena}
              config={resolved}
              playing={playing && !disabled}
              showTrail={showTrail}
              cameraMode={cameraMode}
            />
          </Canvas>
        </div>
        {!snapshot ? <div className={styles.emptyStage}>No snapshot loaded</div> : null}
        <div className={styles.cameraToggle} role="group" aria-label="Camera">
          {(["overview", "follow"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={styles.cameraButton}
              aria-pressed={cameraMode === m}
              disabled={m === "follow" && !snapshot}
              onClick={() => setCameraMode(m)}
              data-testid={`sim-camera-${m}`}
            >
              {m === "overview" ? "Course" : "Follow rover"}
            </button>
          ))}
        </div>
        <div className={styles.overlayTop}>
          <div className={styles.disclaimer} role="note" data-testid="sim-disclaimer">
            <span className={styles.disclaimerIcon} aria-hidden="true">
              ⚠
            </span>
            {SIM_DISCLAIMER}
          </div>
          <SimReadout snapshot={snapshot} wheel_base_m={resolved.wheel_base_m} />
        </div>
      </div>
      {controls}
      {limitations && limitations.length > 0 ? (
        <ul className={styles.limitations} aria-label="Simulation limitations" data-testid="sim-limitations">
          {limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
