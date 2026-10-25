'use client';

import { useMemo, useState } from 'react';
import type { BuildPlan } from '../../../lib/rivet/types';
import { SIM_SCENARIOS, SimView, extractSimPlan } from '../../sim';
import { Modal } from '../../system/Modal';

export interface SimulationModalProps {
  plan: BuildPlan;
  open: boolean;
  onClose: () => void;
}

/**
 * Optional, approximate look at how the rover would behave. Two decisions before Run: the
 * scenario and (inside the running view) the sim's own inputs. Always labelled Approximate.
 */
export function SimulationModal({ plan, open, onClose }: SimulationModalProps) {
  const [scenarioId, setScenarioId] = useState(SIM_SCENARIOS[0]!.id);
  const [run, setRun] = useState(0);
  const extracted = useMemo(() => extractSimPlan(plan), [plan]);
  const scenario = SIM_SCENARIOS.find((s) => s.id === scenarioId) ?? SIM_SCENARIOS[0]!;
  const limits = plan.simulation?.limitations ?? [];

  return (
    <Modal
      open={open}
      onClose={() => {
        setRun(0);
        onClose();
      }}
      variant="wide"
      title="Test drive"
      description="A rough on-screen simulation of how the robot moves. The real one will behave differently."
      testId="sim-modal"
      footer={
        <>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            disabled={!extracted.ok}
            onClick={() => setRun((n) => n + 1)}
            data-testid="sim-run"
          >
            {run > 0 ? 'Run again' : 'Run'}
          </button>
        </>
      }
    >
      <div className="p1-sim">
        <div className="p1-sim__row">
          <span className="ui-badge ui-badge--warn" data-testid="sim-approximate">
            Approximate
          </span>
          <span className="ui-small ui-muted">It leaves out motor strength, wheel slip, batteries running low and sensor noise.</span>
        </div>
        <div className="ui-field" style={{ maxWidth: 360 }}>
          <label className="ui-label" htmlFor="sim-scenario">
            Test course
          </label>
          <select
            id="sim-scenario"
            className="ui-select"
            value={scenarioId}
            onChange={(e) => {
              setScenarioId(e.target.value);
              setRun(0);
            }}
            data-testid="sim-scenario"
          >
            {SIM_SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="ui-small ui-muted">{scenario.description}</span>
        </div>

        {!extracted.ok ? (
          <div className="ui-notice" role="status" data-testid="sim-unavailable">
            This design can&apos;t be test-driven on screen: {extracted.reason}
          </div>
        ) : run > 0 ? (
          <SimView key={`${scenarioId}-${run}`} plan={plan} initialScenarioId={scenarioId} autoPlay height={340} />
        ) : (
          <div className="viewport viewport--sm" aria-hidden="true" />
        )}

        {/* Once running, SimView lists the same limitations under the stage. */}
        {limits.length > 0 && run === 0 ? (
          <details className="p1-details">
            <summary>What the simulation leaves out ({limits.length})</summary>
            <div className="p1-details__body">
              <ul className="p1-sim__limits" data-testid="sim-limits">
                {limits.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          </details>
        ) : null}
      </div>
    </Modal>
  );
}
