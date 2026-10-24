import styles from "./SimVisual.module.css";

export interface SimulationControlsProps {
  playing: boolean;
  /** Whether the rover's motors are enabled (false after a DISABLE event). */
  enabled: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onEnable: () => void;
  onDisable: () => void;
  /** Make every control unavailable, e.g. when the plan has no simulation. */
  unavailable?: boolean;
  unavailableReason?: string;
  className?: string;
}

/** Neutral, unstyled-by-brand control strip; callbacks are owned by the caller. */
export function SimulationControls({
  playing,
  enabled,
  onPlay,
  onPause,
  onReset,
  onEnable,
  onDisable,
  unavailable = false,
  unavailableReason,
  className,
}: SimulationControlsProps) {
  return (
    <div
      className={[styles.controls, className].filter(Boolean).join(" ")}
      role="toolbar"
      aria-label="Simulation controls"
      data-testid="sim-controls"
      data-unavailable={unavailable || undefined}
    >
      <button
        type="button"
        className={styles.button}
        onClick={playing ? onPause : onPlay}
        disabled={unavailable}
        aria-pressed={playing}
        data-testid="sim-control-play"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={onReset}
        disabled={unavailable}
        data-testid="sim-control-reset"
      >
        Reset
      </button>
      <span className={styles.controlsDivider} aria-hidden="true" />
      {enabled ? (
        <button
          type="button"
          className={`${styles.button} ${styles.buttonDanger}`}
          onClick={onDisable}
          disabled={unavailable}
          data-testid="sim-control-disable"
        >
          Disable motors
        </button>
      ) : (
        <button
          type="button"
          className={styles.button}
          onClick={onEnable}
          disabled={unavailable}
          data-testid="sim-control-enable"
        >
          Enable motors
        </button>
      )}
      <span className={styles.controlsStatus} data-testid="sim-controls-status">
        {unavailable
          ? unavailableReason ?? "Simulation unavailable"
          : `${playing ? "Running" : "Paused"} · ${enabled ? "Motors enabled" : "Motors disabled"}`}
      </span>
    </div>
  );
}
