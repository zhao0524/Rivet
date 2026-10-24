'use client';

import { useMemo } from 'react';
import type { StudioActionMode } from '../../lib/plan-store';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet';
import { BOMPanel, PartInspector, VerificationPanel } from './panels';
import type { BuildPlan as PanelBuildPlan, CatalogComponent as PanelCatalogComponent } from './panels/types';
import {
  WiringStatusPanel,
  availableSignals,
  buildWiringLayout,
  filterWires,
  type WiringCatalogComponent,
  type WiringFilter,
  type WiringPlanInput,
} from '../three/wiring';

export interface InspectorProps {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  /** Active studio mode; decides what the panel shows (replaces the old inspector tabs). */
  mode: StudioActionMode;
  selectedInstanceId: string | null;
  onSelectInstance: (instanceId: string) => void;
  wiringFilter: WiringFilter;
  onToggleSignalFilter: (signal: string) => void;
  onClearWiringFilter: () => void;
  activeConnectionId: string | null;
  onSelectConnectionId: (connectionId: string | null) => void;
  /** Assemble mode: current step (0 = preparation) and a way to jump to another step. */
  activeStep?: number;
  onSelectStep?: (step: number) => void;
}

const card = {
  background: 'var(--rv-surface-raised)',
  border: '1px solid var(--rv-border)',
  borderRadius: 'var(--rv-radius-md)',
  padding: 12,
} as const;

const sectionTitle = {
  margin: '0 0 8px',
  fontSize: 'var(--rv-text-section)',
  fontWeight: 600,
  color: 'var(--rv-text-strong)',
} as const;

/**
 * Right-hand studio panel. One view per studio mode: design = part details,
 * inspect = BOM + verification, wiring = netlist and pin map, assemble = steps,
 * simulate = what the simulation models. Exports live in the top-bar Export dialog.
 */
export function Inspector({
  plan,
  catalog,
  mode,
  selectedInstanceId,
  onSelectInstance,
  wiringFilter,
  onToggleSignalFilter,
  onClearWiringFilter,
  activeConnectionId,
  onSelectConnectionId,
  activeStep = 0,
  onSelectStep,
}: InspectorProps) {
  const wiringPlan = useMemo<WiringPlanInput>(
    () => ({
      build_id: plan.build_id,
      revision: plan.revision,
      components: plan.components.map((c) => ({
        instance_id: c.instance_id,
        catalog_id: c.catalog_id,
        role: c.role,
        pose: c.pose,
      })),
      connections: plan.connections.map((c) => ({
        connection_id: c.connection_id,
        kind: c.kind,
        from: { instance_id: c.from.instance_id, port_id: c.from.port_id ?? '' },
        to: { instance_id: c.to.instance_id, port_id: c.to.port_id ?? '' },
        net_name: c.net_name ?? null,
        notes: c.notes ?? null,
      })),
    }),
    [plan],
  );

  const wiringLayout = useMemo(
    () => buildWiringLayout(wiringPlan, catalog as unknown as readonly WiringCatalogComponent[]),
    [wiringPlan, catalog],
  );
  const signals = useMemo(() => availableSignals(wiringLayout.wires), [wiringLayout]);
  const shownWires = useMemo(
    () => filterWires(wiringLayout.wires, wiringFilter),
    [wiringLayout.wires, wiringFilter],
  );

  const pinEntries = Object.entries(plan.firmware?.pin_map ?? {});
  const panelPlan = plan as unknown as PanelBuildPlan;
  const panelCatalog = catalog as unknown as PanelCatalogComponent[];

  const partDetails = (
    <div style={card}>
      <PartInspector
        plan={panelPlan}
        catalog={panelCatalog}
        selectedInstanceId={selectedInstanceId}
        onSelectInstance={onSelectInstance}
      />
    </div>
  );

  return (
    <div
      data-testid="studio-inspector"
      data-mode={mode}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {mode === 'design' && partDetails}

      {mode === 'inspect' && (
        <>
          <section aria-label="Bill of materials" data-testid="inspector-bom-section" style={{ ...card, overflowX: 'auto' }}>
            <BOMPanel
              plan={panelPlan}
              catalog={panelCatalog}
              selectedInstanceId={selectedInstanceId}
              onSelectInstance={onSelectInstance}
            />
          </section>
          <section aria-label="Verification" data-testid="inspector-verify-section" style={card}>
            <VerificationPanel plan={panelPlan} onSelectInstance={onSelectInstance} />
          </section>
        </>
      )}

      {mode === 'wiring' && (
        <div
          data-testid="inspector-wiring-tab"
          style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
        <WiringStatusPanel
          layout={wiringLayout}
          shownCount={shownWires.length}
        />

        {/* Signal Filters */}
        {signals.length > 0 && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>Filter by signal</span>
              {(wiringFilter.signals?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={onClearWiringFilter}
                  style={{
                    background: 'transparent',
                    color: '#60a5fa',
                    border: 'none',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Clear filter
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {signals.map((sig) => {
                const active = wiringFilter.signals?.includes(sig) ?? false;
                return (
                  <button
                    key={sig}
                    type="button"
                    data-testid={`wiring-signal-filter-${sig}`}
                    aria-pressed={active}
                    onClick={() => onToggleSignalFilter(sig)}
                    style={{
                      background: active ? '#1d4ed8' : '#10141c',
                      color: active ? '#ffffff' : '#cbd5e1',
                      border: '1px solid #2d3748',
                      borderRadius: 999,
                      padding: '3px 9px',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {sig}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Drawn Wires List */}
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, margin: '4px 0 6px' }}>
            Electrical netlist ({shownWires.length})
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 5 }}>
            {shownWires.map((w) => {
              const isSelectedWire = activeConnectionId === w.connection_id;
              return (
                <li
                  key={w.connection_id}
                  data-testid={`wiring-list-item-${w.connection_id}`}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: isSelectedWire ? '#1e3a8a' : '#10141c',
                    border: `1px solid ${isSelectedWire ? '#60a5fa' : '#1f2937'}`,
                    borderLeft: `4px solid ${w.color}`,
                    fontSize: 11,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onSelectConnectionId(isSelectedWire ? null : w.connection_id)
                      }
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#f1f5f9',
                        fontWeight: 600,
                        padding: 0,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}
                    >
                      {w.from.instance_id}:{w.from.port_id} → {w.to.instance_id}:{w.to.port_id}
                    </button>
                    <span style={{ color: '#94a3b8' }}>{w.signal_label}</span>
                  </div>
                  {w.net_name && (
                    <div style={{ color: '#94a3b8', marginTop: 2 }}>Net: {w.net_name}</div>
                  )}
                  {w.notes && (
                    <div style={{ color: '#cbd5e1', marginTop: 2 }}>{w.notes}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Controller Pin Map */}
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 600, margin: '4px 0 6px' }}>
            Firmware pin map ({plan.firmware.target})
          </h3>
          {pinEntries.length === 0 ? (
            <p
              data-testid="wiring-pin-map-empty"
              style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}
            >
              No GPIO pin assignments in this revision (<code>pin_map: {'{}'}</code>, compile_status:{' '}
              <code>{plan.firmware.compile_status}</code>).
            </p>
          ) : (
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                  <th>Signal</th>
                  <th>ESP32 GPIO</th>
                </tr>
              </thead>
              <tbody>
                {pinEntries.map(([sig, pin]) => (
                  <tr key={sig}>
                    <td>
                      <code>{sig}</code>
                    </td>
                    <td>
                      <code>{String(pin)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
      )}

      {mode === 'assemble' && (
        <>
          <section aria-label="Assembly steps" data-testid="inspector-assembly-steps" style={card}>
            <h2 style={sectionTitle}>Assembly steps ({plan.assembly_steps.length})</h2>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {plan.assembly_steps.map((s, idx) => {
                const stepIdx = idx + 1;
                const current = stepIdx === activeStep;
                return (
                  <li key={s.step}>
                    <button
                      type="button"
                      data-testid={`inspector-step-${stepIdx}`}
                      aria-current={current ? 'step' : undefined}
                      onClick={() => onSelectStep?.(stepIdx)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: 'var(--rv-radius-sm)',
                        background: current ? 'rgba(37, 99, 235, 0.22)' : 'transparent',
                        border: `1px solid ${current ? 'var(--rv-accent-border)' : 'var(--rv-border)'}`,
                        color: 'var(--rv-text)',
                        font: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--rv-text-strong)' }}>
                        {s.step}. {s.title}
                      </div>
                      <div style={{ marginTop: 2, fontSize: 'var(--rv-text-caption)', color: 'var(--rv-text-muted)' }}>
                        {s.instructions}
                      </div>
                      {s.safety_notes.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 'var(--rv-text-caption)', color: 'var(--rv-warn-text)' }}>
                          Caution: {s.safety_notes.join(' · ')}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
          {selectedInstanceId ? partDetails : null}
        </>
      )}

      {mode === 'simulate' && (
        <section aria-label="Simulation model" data-testid="inspector-simulation" style={card}>
          <h2 style={sectionTitle}>What the simulation models</h2>
          <p style={{ margin: '0 0 8px', fontSize: 'var(--rv-text-caption)', color: 'var(--rv-text-muted)' }}>
            A simplified 2D kinematic model driven by the same behavior parameters the firmware uses.
            It does not predict real motor, sensor or traction behavior.
          </p>
          {plan.behavior ? (
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '4px 12px',
                margin: '0 0 8px',
                fontSize: 'var(--rv-text-caption)',
              }}
            >
              <dt style={{ color: 'var(--rv-text-muted)' }}>Behavior</dt>
              <dd style={{ margin: 0 }}>{plan.behavior.profile_id}</dd>
              {Object.entries(plan.behavior.parameters).map(([key, value]) => (
                <div key={key} style={{ display: 'contents' }}>
                  <dt style={{ color: 'var(--rv-text-muted)' }}>{key.replace(/_/g, ' ')}</dt>
                  <dd style={{ margin: 0 }}>{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p style={{ margin: '0 0 8px', fontSize: 'var(--rv-text-caption)' }}>
              This plan has no behavior profile.
            </p>
          )}
          {plan.simulation.limitations.length > 0 && (
            <>
              <h3 style={{ ...sectionTitle, fontSize: 'var(--rv-text-caption)' }}>Limitations</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--rv-text-caption)', color: 'var(--rv-text-muted)' }}>
                {plan.simulation.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
