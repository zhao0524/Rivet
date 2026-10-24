'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuildPlan } from '../../lib/rivet/types';
import { summarizeBehaviorSpec } from './behaviors';
import {
  SIM_SCENARIOS,
  advanceSimulation,
  applySimEvent,
  engineSnapshotToVisualSnapshot,
  extractSimPlan,
  extractVisualConfigFromPlan,
  getSnapshot,
  initSimulation,
  stepSimulation,
  visualObstaclesToEngineObstacles,
  type EngineSimSnapshot,
  type SimState,
  type TurnDirection,
} from './sim-core';
import { RoverSimulationView, SimulationControls } from './visual';

export interface SimViewProps {
  plan: BuildPlan;
  initialScenarioId?: string;
  autoPlay?: boolean;
  height?: number | string;
  className?: string;
}

export function SimView({
  plan,
  initialScenarioId = 'obstacle-course',
  autoPlay = false,
  height = 460,
  className,
}: SimViewProps) {
  const [scenarioId, setScenarioId] = useState(initialScenarioId);
  const [turnDirection, setTurnDirection] = useState<TurnDirection>('left');
  const [seed, setSeed] = useState<number>(42);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [playing, setPlaying] = useState<boolean>(autoPlay);

  const scenario = useMemo(
    () => SIM_SCENARIOS.find((s) => s.id === scenarioId) ?? SIM_SCENARIOS[0],
    [scenarioId],
  );

  const extracted = useMemo(() => extractSimPlan(plan), [plan]);
  const engineObstacles = useMemo(
    () => visualObstaclesToEngineObstacles(scenario.obstacles, scenario.arena),
    [scenario],
  );
  const visualConfig = useMemo(() => extractVisualConfigFromPlan(plan), [plan]);
  const behaviorSummary = useMemo(() => summarizeBehaviorSpec(plan), [plan]);

  const [simState, setSimState] = useState<SimState | null>(() => {
    if (!extracted.ok) return null;
    return initSimulation(extracted.simPlan, engineObstacles, seed, {
      initialPose: scenario.initialPose,
      turnDirection,
    });
  });

  const simStateRef = useRef<SimState | null>(simState);
  simStateRef.current = simState;

  // Reset or update when scenario, seed, turnDirection, or build_id changes.
  // When only revision/parameters change within the same build, keep running or re-init if invalid.
  const prevBuildKeyRef = useRef(`${plan.build_id}|${scenario.id}|${turnDirection}|${seed}`);
  useEffect(() => {
    const key = `${plan.build_id}|${scenario.id}|${turnDirection}|${seed}`;
    if (!extracted.ok) {
      setPlaying(false);
      setSimState(null);
      return;
    }
    if (prevBuildKeyRef.current !== key || simStateRef.current === null) {
      prevBuildKeyRef.current = key;
      const fresh = initSimulation(extracted.simPlan, engineObstacles, seed, {
        initialPose: scenario.initialPose,
        turnDirection,
      });
      setSimState(fresh);
    } else {
      // Step by 0 seconds so plan metadata & sensor reading reflect any edited parameters immediately
      setSimState((prev) =>
        prev ? stepSimulation(prev, 0, extracted.simPlan, engineObstacles) : null,
      );
    }
  }, [plan.build_id, plan.revision, extracted, engineObstacles, scenario, turnDirection, seed]);

  useEffect(() => {
    if (!playing || !extracted.ok) return;
    let rafId = 0;
    let lastTime: number | null = null;

    const tick = (now: number) => {
      if (lastTime !== null) {
        const rawDt = Math.max(0, (now - lastTime) / 1000);
        const scaledDt = Math.min(rawDt * speedMultiplier, 0.05);
        setSimState((prev) =>
          prev ? stepSimulation(prev, scaledDt, extracted.simPlan, engineObstacles) : null,
        );
      }
      lastTime = now;
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [playing, extracted, engineObstacles, speedMultiplier]);

  const handleReset = useCallback(() => {
    setPlaying(false);
    if (!extracted.ok) return;
    setSimState(
      initSimulation(extracted.simPlan, engineObstacles, seed, {
        initialPose: scenario.initialPose,
        turnDirection,
      }),
    );
  }, [extracted, engineObstacles, seed, scenario.initialPose, turnDirection]);

  const handleStepForward = useCallback(() => {
    if (!extracted.ok) return;
    setSimState((prev) => {
      const base =
        prev ??
        initSimulation(extracted.simPlan, engineObstacles, seed, {
          initialPose: scenario.initialPose,
          turnDirection,
        });
      return advanceSimulation(base, 6, extracted.simPlan, engineObstacles);
    });
  }, [extracted, engineObstacles, seed, scenario.initialPose, turnDirection]);

  const handleDisable = useCallback(() => {
    setSimState((prev) => (prev ? applySimEvent(prev, { type: 'DISABLE' }) : null));
  }, []);

  const handleEnable = useCallback(() => {
    setSimState((prev) => (prev ? applySimEvent(prev, { type: 'ENABLE' }) : null));
  }, []);

  const engineSnapshot: EngineSimSnapshot | null = useMemo(
    () => (simState && extracted.ok ? getSnapshot(simState, extracted.simPlan) : null),
    [simState, extracted],
  );

  const visualSnapshot = useMemo(
    () => (engineSnapshot ? engineSnapshotToVisualSnapshot(engineSnapshot) : null),
    [engineSnapshot],
  );

  const motorsEnabled = engineSnapshot ? engineSnapshot.state !== 'DISABLED' : true;
  const limitations = useMemo(
    () => engineSnapshot?.limitations ?? plan.simulation?.limitations ?? [],
    [engineSnapshot, plan.simulation?.limitations],
  );

  return (
    <div className={className} data-testid="sim-view-container">
      {/* Scenario & Parameter Header Bar */}
      <div
        data-testid="sim-config-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '8px 12px',
          background: '#11161f',
          border: '1px solid #242e3d',
          borderRadius: '10px 10px 0 0',
          color: '#dbe4f0',
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 600, color: '#93c5fd' }}>
            Simplified kinematic simulation · {plan.build_id} r{plan.revision}
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>Scenario:</span>
            <select
              data-testid="sim-scenario-select"
              value={scenarioId}
              onChange={(e) => {
                setPlaying(false);
                setScenarioId(e.target.value);
              }}
              style={{
                background: '#19212e',
                color: '#f1f5f9',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 12,
              }}
            >
              {SIM_SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>Turn policy:</span>
            <select
              data-testid="sim-turn-direction"
              value={turnDirection}
              onChange={(e) => setTurnDirection(e.target.value as TurnDirection)}
              style={{
                background: '#19212e',
                color: '#f1f5f9',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 12,
              }}
            >
              <option value="left">Turn left (CCW)</option>
              <option value="right">Turn right (CW)</option>
              <option value="seeded">Seeded PRNG</option>
            </select>
          </label>
          {turnDirection === 'seeded' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>Seed:</span>
              <input
                type="number"
                data-testid="sim-seed-input"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
                style={{
                  width: 64,
                  background: '#19212e',
                  color: '#f1f5f9',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  padding: '2px 6px',
                  fontSize: 12,
                }}
              />
            </label>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>Speed:</span>
            <select
              data-testid="sim-speed-select"
              value={String(speedMultiplier)}
              onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
              style={{
                background: '#19212e',
                color: '#f1f5f9',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 12,
              }}
            >
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
            </select>
          </label>
          <button
            type="button"
            data-testid="sim-control-step"
            disabled={!extracted.ok}
            onClick={handleStepForward}
            style={{
              background: '#1e293b',
              color: '#e2e8f0',
              border: '1px solid #3b495e',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              cursor: extracted.ok ? 'pointer' : 'not-allowed',
            }}
          >
            Step +0.1s
          </button>
        </div>

        {/* Plan-derived parameters readout */}
        {behaviorSummary && (
          <div
            data-testid="sim-plan-params"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11,
              color: '#94a3b8',
            }}
          >
            <span>stop: {behaviorSummary.stopDistanceM ?? '—'} m</span>
            <span>turn: {behaviorSummary.turnDurationMs ?? '—'} ms</span>
            <span>
              speed:{' '}
              {behaviorSummary.forwardSpeedFraction !== null
                ? `${Math.round(behaviorSummary.forwardSpeedFraction * 100)}%`
                : '—'}
            </span>
            <span>wheelbase: {plan.simulation.wheel_base_m ?? '—'} m</span>
            <span>range: {plan.simulation.sensor_range_m ?? '—'} m</span>
            {engineSnapshot && <span>t = {engineSnapshot.time_s.toFixed(2)} s</span>}
          </div>
        )}
      </div>

      <RoverSimulationView
        snapshot={visualSnapshot}
        obstacles={scenario.obstacles}
        arena={scenario.arena}
        playing={playing}
        config={visualConfig}
        limitations={limitations}
        height={height}
        controls={
          <SimulationControls
            playing={playing}
            enabled={motorsEnabled}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onReset={handleReset}
            onEnable={handleEnable}
            onDisable={handleDisable}
            unavailable={!extracted.ok}
            unavailableReason={!extracted.ok ? extracted.reason : undefined}
          />
        }
      />

      {/* Recent FSM Transitions */}
      {engineSnapshot && engineSnapshot.transitions.length > 0 && (
        <div
          data-testid="sim-transitions-log"
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: '#11161f',
            border: '1px solid #242e3d',
            borderRadius: 8,
            color: '#cbd5e1',
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          <strong style={{ color: '#94a3b8' }}>FSM transitions ({engineSnapshot.transitions.length}): </strong>
          {engineSnapshot.transitions.slice(-5).map((t, i) => (
            <span key={`${t.tick}-${i}`} style={{ marginRight: 12 }}>
              [{t.time_s.toFixed(2)}s] {t.from} → {t.to} ({t.reason})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
