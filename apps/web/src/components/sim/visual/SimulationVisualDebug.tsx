import { useState } from "react";
import { EXAMPLE_ARENA, EXAMPLE_LIMITATIONS, EXAMPLE_OBSTACLES, EXAMPLE_SNAPSHOTS, EXAMPLE_VISUAL_CONFIG } from "./examples";
import { RoverSimulationView } from "./RoverSimulationView";
import { SimulationControls } from "./SimulationControls";
import styles from "./SimVisual.module.css";

/**
 * Visual debugging harness: steps through static example snapshots. The
 * controls here only toggle viewer state (wheel animation, motor flag); no
 * simulation runs.
 */
export function SimulationVisualDebug({ initialExampleId }: { initialExampleId?: string }) {
  const initialIndex = Math.max(0, EXAMPLE_SNAPSHOTS.findIndex((e) => e.id === initialExampleId));
  const [index, setIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const example = EXAMPLE_SNAPSHOTS[index];

  return (
    <div className={styles.root}>
      <div className={styles.debugBar} role="group" aria-label="Example snapshots">
        {EXAMPLE_SNAPSHOTS.map((e, i) => (
          <button
            key={e.id}
            type="button"
            className={styles.button}
            aria-current={i === index}
            onClick={() => setIndex(i)}
          >
            {e.label}
          </button>
        ))}
      </div>
      <span className={styles.debugNote}>
        Static example snapshots for visual debugging; controls here do not run a simulation.
      </span>
      <RoverSimulationView
        snapshot={example.snapshot}
        obstacles={EXAMPLE_OBSTACLES}
        arena={EXAMPLE_ARENA}
        config={EXAMPLE_VISUAL_CONFIG}
        playing={playing}
        limitations={EXAMPLE_LIMITATIONS}
        height={520}
        controls={
          <SimulationControls
            playing={playing}
            enabled={enabled}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onReset={() => {
              setPlaying(false);
              setIndex(0);
            }}
            onEnable={() => setEnabled(true)}
            onDisable={() => {
              setEnabled(false);
              setPlaying(false);
            }}
          />
        }
      />
    </div>
  );
}
