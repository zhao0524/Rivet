'use client';

import { useState } from 'react';
import { buildBomCsvClientSide } from '../../lib/plan-store';
import type {
  BuildPlan,
  EstelleGroundRequest,
  EstelleGroundResponse,
  EstelleStatusKind,
  EstelleStatusState,
  ExportArtifactKind,
  RivetDataSource,
} from '../../lib/rivet';

export interface ExportPanelProps {
  plan: BuildPlan;
  dataSource: RivetDataSource;
  /** Outcome of `GET /api/estelle/status`; grounding is offered only when `ready`. */
  estelleStatus: EstelleStatusState;
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

const ESTELLE_BADGES: Record<EstelleStatusKind, { label: string; background: string; color: string }> = {
  checking: { label: 'checking', background: '#27272a', color: '#d4d4d8' },
  disabled: { label: 'disabled', background: '#27272a', color: '#d4d4d8' },
  unavailable: { label: 'unavailable', background: '#422006', color: '#fcd34d' },
  ready: { label: 'ready', background: '#064e3b', color: '#6ee7b7' },
  network_error: { label: 'network error', background: '#450a0a', color: '#fca5a5' },
};

const estelleMessageStyle = { fontSize: 11, color: '#cbd5e1', margin: 0 } as const;

/** One message per Estelle state; the API's reason is shown verbatim. */
function EstelleStatusMessage({ state }: { state: EstelleStatusState }) {
  switch (state.kind) {
    case 'checking':
      return (
        <p data-testid="estelle-status-message" data-kind="checking" role="status" style={estelleMessageStyle}>
          Checking Estelle status…
        </p>
      );
    case 'disabled':
      return (
        <p data-testid="estelle-status-message" data-kind="disabled" style={estelleMessageStyle}>
          <strong>Disabled by configuration.</strong>{' '}
          <span data-testid="estelle-status-reason">{state.status.reason || 'The API gave no reason.'}</span>
        </p>
      );
    case 'unavailable':
      return (
        <div data-testid="estelle-status-message" data-kind="unavailable" style={estelleMessageStyle}>
          <p style={{ margin: 0 }}>
            <strong>Unavailable.</strong>{' '}
            <span data-testid="estelle-status-reason">{state.status.reason || 'The API gave no reason.'}</span>
          </p>
          {state.status.doctor && (
            <pre
              data-testid="estelle-doctor-output"
              style={{
                margin: '6px 0 0',
                padding: '6px 8px',
                maxHeight: 120,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                background: '#10141c',
                border: '1px solid #1f2937',
                borderRadius: 5,
                fontSize: 10,
              }}
            >
              {`estelle doctor (exit ${state.status.doctor.exit_code}):\n${state.status.doctor.output_tail}`}
            </pre>
          )}
        </div>
      );
    case 'ready':
      return (
        <p data-testid="estelle-status-message" data-kind="ready" style={estelleMessageStyle}>
          <strong>Ready.</strong> The API reports Estelle available ({state.status.mode} mode
          {state.status.doctor ? `, estelle doctor exit ${state.status.doctor.exit_code}` : ''}).
        </p>
      );
    case 'network_error':
      return (
        <p
          data-testid="estelle-status-message"
          data-kind="network_error"
          role="alert"
          style={{ ...estelleMessageStyle, color: '#fca5a5' }}
        >
          <strong>Network error.</strong> No valid answer from <code>GET /api/estelle/status</code>, so
          Estelle&apos;s state is unknown. <span data-testid="estelle-status-error">{state.message}</span>
        </p>
      );
  }
}

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

/** Build package downloads (BOM CSV, BuildPlan JSON, firmware ZIP) and Estelle source grounding. */
export function ExportPanel({
  plan,
  dataSource,
  estelleStatus,
  estelleGroundResult,
  estelleLoading,
  estelleError,
  onGroundSymbol,
}: ExportPanelProps) {
  const [symbolName, setSymbolName] = useState<string>('read_front_distance');
  const [groundKind, setGroundKind] = useState<'locate' | 'dependencies'>('locate');
  const estelleBadge = ESTELLE_BADGES[estelleStatus.kind];
  const estelleReady = estelleStatus.kind === 'ready';
  const showEstelleEnableHint = estelleStatus.kind === 'disabled' || estelleStatus.kind === 'unavailable';

  const exportHref = (kind: ExportArtifactKind) =>
    dataSource.getExportUrl ? dataSource.getExportUrl(plan.build_id, kind, plan.revision) : null;

  return (
    <div
      data-testid="inspector-exports-tab"
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
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
        data-state={estelleStatus.kind}
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
            data-status={estelleStatus.kind}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              background: estelleBadge.background,
              color: estelleBadge.color,
              border: '1px solid #3f3f46',
            }}
          >
            {estelleBadge.label}
          </span>
        </div>

        <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
          Grounds firmware behavior symbols in services/api/rivet_api/firmware/templates/esp32_rover.
        </p>

        <EstelleStatusMessage state={estelleStatus} />

        {showEstelleEnableHint && (
          <p data-testid="estelle-enable-hint" style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
            To enable: run the API with <code>RIVET_ENABLE_ESTELLE=true</code>, then{' '}
            <code>npm i -g @fatelabs/estelle</code>, <code>estelle login</code> and{' '}
            <code>estelle setup</code> in the repo.
          </p>
        )}

        {estelleReady && (
          <>
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
          </>
        )}
      </section>
    </div>
  );
}
