'use client';

import { useMemo, useState } from 'react';
import { buildBomCsvClientSide } from '../../lib/plan-store';
import type {
  BuildPlan,
  CatalogComponent,
  EstelleGroundRequest,
  EstelleGroundResponse,
  EstelleStatusResponse,
  ExportArtifactKind,
  RivetDataSource,
} from '../../lib/rivet';
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

export type InspectorTab = 'part' | 'bom' | 'verify' | 'wiring' | 'exports';

export interface InspectorProps {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  selectedInstanceId: string | null;
  onSelectInstance: (instanceId: string) => void;
  activeTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  wiringFilter: WiringFilter;
  onToggleSignalFilter: (signal: string) => void;
  onClearWiringFilter: () => void;
  activeConnectionId: string | null;
  onSelectConnectionId: (connectionId: string | null) => void;
  dataSource: RivetDataSource;
  estelleStatus: EstelleStatusResponse | null;
  estelleGroundResult: EstelleGroundResponse | null;
  estelleLoading: boolean;
  estelleError: string | null;
  onGroundSymbol: (request: EstelleGroundRequest) => Promise<EstelleGroundResponse | null>;
}

const FIRMWARE_SYMBOLS = [
  'read_front_distance',
  'drive_forward',
  'turn_in_place',
  'stop_motors',
] as const;

function triggerDownload(filename: string, content: string, mimeType: string) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function Inspector({
  plan,
  catalog,
  selectedInstanceId,
  onSelectInstance,
  activeTab: controlledTab,
  onTabChange,
  wiringFilter,
  onToggleSignalFilter,
  onClearWiringFilter,
  activeConnectionId,
  onSelectConnectionId,
  dataSource,
  estelleStatus,
  estelleGroundResult,
  estelleLoading,
  estelleError,
  onGroundSymbol,
}: InspectorProps) {
  const [internalTab, setInternalTab] = useState<InspectorTab>('part');
  const activeTab = controlledTab ?? internalTab;
  const setTab = (t: InspectorTab) => {
    setInternalTab(t);
    onTabChange?.(t);
  };

  const [symbolName, setSymbolName] = useState<string>('read_front_distance');
  const [groundKind, setGroundKind] = useState<'locate' | 'dependencies'>('locate');

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

  const exportHref = (kind: ExportArtifactKind) =>
    dataSource.getExportUrl ? dataSource.getExportUrl(plan.build_id, kind, plan.revision) : null;

  const pinEntries = Object.entries(plan.firmware?.pin_map ?? {});

  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'part', label: 'Part' },
    { id: 'bom', label: `BOM (${plan.bom.items.length})` },
    { id: 'verify', label: `Verify (${plan.verification.findings.length})` },
    { id: 'wiring', label: `Wiring (${wiringLayout.counts.drawn})` },
    { id: 'exports', label: 'Export & Estelle' },
  ];

  return (
    <div data-testid="studio-inspector" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Inspector Tab Switcher */}
      <div
        role="tablist"
        aria-label="Inspector views"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          background: '#141821',
          padding: 4,
          borderRadius: 7,
          border: '1px solid #222938',
        }}
      >
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`inspector-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                background: active ? '#2563eb' : 'transparent',
                color: active ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: 5,
                padding: '5px 7px',
                fontSize: 11,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'part' && (
        <div
          style={{
            background: '#141821',
            border: '1px solid #222938',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <PartInspector
            plan={plan as unknown as PanelBuildPlan}
            catalog={catalog as unknown as PanelCatalogComponent[]}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={onSelectInstance}
          />
        </div>
      )}

      {activeTab === 'bom' && (
        <div
          style={{
            background: '#141821',
            border: '1px solid #222938',
            borderRadius: 8,
            padding: 12,
            overflowX: 'auto',
          }}
        >
          <BOMPanel
            plan={plan as unknown as PanelBuildPlan}
            catalog={catalog as unknown as PanelCatalogComponent[]}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={(id) => {
              onSelectInstance(id);
            }}
          />
        </div>
      )}

      {activeTab === 'verify' && (
        <div
          style={{
            background: '#141821',
            border: '1px solid #222938',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <VerificationPanel
            plan={plan as unknown as PanelBuildPlan}
            onSelectInstance={(id) => {
              onSelectInstance(id);
            }}
          />
        </div>
      )}

      {activeTab === 'wiring' && (
        <div
          data-testid="inspector-wiring-tab"
          style={{
            background: '#141821',
            border: '1px solid #222938',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
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

      {activeTab === 'exports' && (
        <div
          data-testid="inspector-exports-tab"
          style={{
            background: '#141821',
            border: '1px solid #222938',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <section aria-label="Build exports">
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>
              Build package exports ({plan.build_id} r{plan.revision})
            </h2>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 10px' }}>
              Every export artifact is tied to canonical <code>build_id</code>{' '}
              <code>{plan.build_id}</code> and <code>revision</code> <code>{plan.revision}</code>.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* BOM CSV */}
              {exportHref('bom.csv') ? (
                <a
                  href={exportHref('bom.csv')!}
                  download={`${plan.build_id}-r${plan.revision}-bom.csv`}
                  data-testid="export-bom-csv"
                  style={{
                    display: 'inline-block',
                    background: '#1e293b',
                    color: '#f1f5f9',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    padding: '7px 10px',
                    fontSize: 12,
                    textDecoration: 'none',
                  }}
                >
                  Download BOM CSV (/api/projects/{plan.build_id}/exports/bom.csv)
                </a>
              ) : (
                <button
                  type="button"
                  data-testid="export-bom-csv"
                  onClick={() =>
                    triggerDownload(
                      `${plan.build_id}-r${plan.revision}-bom.csv`,
                      buildBomCsvClientSide(plan),
                      'text/csv;charset=utf-8',
                    )
                  }
                  style={{
                    background: '#1e293b',
                    color: '#f1f5f9',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    padding: '7px 10px',
                    fontSize: 12,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  Download BOM CSV (fixture snapshot · null prices preserved)
                </button>
              )}

              {/* BuildPlan JSON */}
              {exportHref('build.json') ? (
                <a
                  href={exportHref('build.json')!}
                  download={`${plan.build_id}-r${plan.revision}.json`}
                  data-testid="export-build-json"
                  style={{
                    display: 'inline-block',
                    background: '#1e293b',
                    color: '#f1f5f9',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    padding: '7px 10px',
                    fontSize: 12,
                    textDecoration: 'none',
                  }}
                >
                  Download BuildPlan JSON (/api/projects/{plan.build_id}/exports/build.json)
                </a>
              ) : (
                <button
                  type="button"
                  data-testid="export-build-json"
                  onClick={() =>
                    triggerDownload(
                      `${plan.build_id}-r${plan.revision}.json`,
                      JSON.stringify(plan, null, 2),
                      'application/json',
                    )
                  }
                  style={{
                    background: '#1e293b',
                    color: '#f1f5f9',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    padding: '7px 10px',
                    fontSize: 12,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  Download BuildPlan JSON (fixture snapshot)
                </button>
              )}

              {/* Firmware ZIP */}
              <div
                data-testid="export-firmware-section"
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: '#10141c',
                  border: '1px solid #1f2937',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>ESP32 PlatformIO Firmware ZIP</strong>
                  <code data-testid="firmware-compile-status">{plan.firmware.compile_status}</code>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                  Target: <code>{plan.firmware.target}</code> · Profile:{' '}
                  <code>{plan.firmware.profile_id ?? 'none'}</code>
                </div>
                {exportHref('firmware.zip') && plan.firmware.compile_status !== 'not_supported' ? (
                  <a
                    href={exportHref('firmware.zip')!}
                    download={`${plan.build_id}-r${plan.revision}-firmware.zip`}
                    data-testid="export-firmware-zip"
                    style={{
                      display: 'inline-block',
                      background: '#2563eb',
                      color: '#ffffff',
                      borderRadius: 5,
                      padding: '5px 10px',
                      fontSize: 12,
                      textDecoration: 'none',
                    }}
                  >
                    Download firmware.zip
                  </a>
                ) : (
                  <p
                    data-testid="export-firmware-unavailable"
                    style={{ fontSize: 11, color: '#fcd34d', margin: 0 }}
                  >
                    {plan.firmware.compile_status === 'not_supported'
                      ? 'Firmware ZIP is not supported for this plan (empty or unverified pin_map in synthetic fixture).'
                      : 'Connect to the live API to generate and download the PlatformIO firmware ZIP.'}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Estelle Source Grounding Section (project.md §8 / implementation.md A5) */}
          <section
            aria-label="Estelle repository grounding"
            data-testid="estelle-grounding-panel"
            style={{
              borderTop: '1px solid #222938',
              paddingTop: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
                Estelle Source Grounding (Fate Labs)
              </h3>
              <span
                data-testid="estelle-status-badge"
                data-status={estelleStatus?.status ?? 'unavailable'}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background:
                    estelleStatus?.status === 'ok' ? '#064e3b' : '#27272a',
                  color:
                    estelleStatus?.status === 'ok' ? '#6ee7b7' : '#d4d4d8',
                  border: '1px solid #3f3f46',
                }}
              >
                {estelleStatus?.status ?? 'unavailable'}
              </span>
            </div>

            <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
              {estelleStatus?.reason ??
                'Grounds firmware behavior symbols in services/api/rivet_api/firmware/templates/esp32_rover.'}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 6 }}>
              <select
                data-testid="estelle-ground-kind"
                value={groundKind}
                onChange={(e) => setGroundKind(e.target.value as 'locate' | 'dependencies')}
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 11,
                }}
              >
                <option value="locate">locate_symbols</option>
                <option value="dependencies">inspect_deps</option>
              </select>
              <select
                data-testid="estelle-symbol-select"
                value={symbolName}
                onChange={(e) => setSymbolName(e.target.value)}
                style={{
                  background: '#0f131a',
                  color: '#f1f5f9',
                  border: '1px solid #2d3748',
                  borderRadius: 5,
                  padding: '4px 6px',
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {FIRMWARE_SYMBOLS.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="estelle-ground-button"
                disabled={estelleLoading}
                onClick={() => void onGroundSymbol({ kind: groundKind, name: symbolName })}
                style={{
                  background: '#1d4ed8',
                  color: '#ffffff',
                  border: '1px solid #3b82f6',
                  borderRadius: 5,
                  padding: '4px 10px',
                  fontSize: 11,
                  cursor: estelleLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {estelleLoading ? 'Querying…' : 'Ground'}
              </button>
            </div>

            {estelleError && (
              <p role="alert" style={{ fontSize: 11, color: '#fca5a5', margin: 0 }}>
                {estelleError}
              </p>
            )}

            {estelleGroundResult && (
              <div
                data-testid="estelle-ground-result"
                data-status={estelleGroundResult.status}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: '#10141c',
                  border: '1px solid #1f2937',
                  fontSize: 11,
                }}
              >
                <div>
                  <strong>Result:</strong> <code>{estelleGroundResult.status}</code>
                  {estelleGroundResult.tool ? ` via ${estelleGroundResult.tool}` : ''}
                </div>
                {estelleGroundResult.reason && (
                  <div style={{ color: '#cbd5e1', marginTop: 3 }}>
                    {estelleGroundResult.reason}
                  </div>
                )}
                {estelleGroundResult.citations.length > 0 ? (
                  <ul
                    data-testid="estelle-citations-list"
                    style={{ margin: '6px 0 0', paddingLeft: 16 }}
                  >
                    {estelleGroundResult.citations.map((c, idx) => (
                      <li key={`${c.path}:${c.line}:${idx}`}>
                        <code>
                          {c.path}:{c.line}
                        </code>{' '}
                        {c.symbol_in_file ? '(verified in file)' : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ color: '#94a3b8', marginTop: 3 }}>
                    No verified citations recorded (never fabricated when Estelle is unavailable).
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
