import { buildReadout } from "./readout";
import styles from "./SimVisual.module.css";
import type { SimSnapshot } from "./types";

export interface SimReadoutProps {
  snapshot: SimSnapshot | null;
  wheel_base_m: number;
}

export function SimReadout({ snapshot, wheel_base_m }: SimReadoutProps) {
  if (!snapshot) {
    return (
      <div className={styles.readout} data-testid="sim-readout" aria-live="polite">
        <span className={styles.readoutEmpty}>Waiting for simulation snapshot</span>
      </div>
    );
  }
  const r = buildReadout(snapshot, wheel_base_m);
  return (
    <dl className={styles.readout} data-testid="sim-readout" aria-live="polite">
      <div className={styles.readoutItem}>
        <dt>State</dt>
        <dd>
          <span className={styles.stateChip} data-tone={r.tone} data-testid="sim-readout-state">
            {r.state}
          </span>
        </dd>
      </div>
      <div className={styles.readoutItem}>
        <dt>Distance</dt>
        <dd data-testid="sim-readout-distance">{r.distance}</dd>
      </div>
      <div className={styles.readoutItem}>
        <dt>Speed</dt>
        <dd data-testid="sim-readout-speed">{r.speed}</dd>
      </div>
      <div className={styles.readoutItem}>
        <dt>Turn rate</dt>
        <dd data-testid="sim-readout-turn">{r.turnRate}</dd>
      </div>
      <div className={`${styles.readoutItem} ${styles.readoutSecondary}`}>
        <dt>Wheels</dt>
        <dd data-testid="sim-readout-wheels">{r.wheels}</dd>
      </div>
      <div className={`${styles.readoutItem} ${styles.readoutSecondary}`}>
        <dt>Pose</dt>
        <dd data-testid="sim-readout-pose">{r.pose}</dd>
      </div>
      {r.collision ? (
        <div className={styles.collisionBadge} role="alert" data-testid="sim-readout-collision">
          Collision reported by simulation
        </div>
      ) : null}
    </dl>
  );
}
