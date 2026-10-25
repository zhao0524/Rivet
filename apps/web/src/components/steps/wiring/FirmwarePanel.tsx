'use client';

import type { BuildPlan, CompileStatus } from '../../../lib/rivet/types';
import { Icon } from '../../system/Icon';

export interface FirmwarePanelProps {
  plan: BuildPlan;
  /** Export URL for the firmware package, or null when the data source cannot provide one. */
  downloadUrl: string | null;
  /** Shown while the build is still loading. */
  loading?: boolean;
}

const COMPILE_WORDS: Record<CompileStatus, string> = {
  passed: 'Compiled without errors',
  failed: 'Compile failed',
  not_checked: 'Not compiled yet. Build compiles and flashes it.',
  not_supported: 'The compiler does not support this target yet.',
};

/** What the engine says about the code: target, profile, compile status in plain words. */
export function compileWords(status: CompileStatus): string {
  return COMPILE_WORDS[status] ?? status;
}

/** Read-only pin map, target and profile, compile status, and one Download button. Flashing is in Build. */
export function FirmwarePanel({ plan, downloadUrl, loading = false }: FirmwarePanelProps) {
  if (loading) {
    return (
      <div className="ui-island p1-pending" role="status" aria-live="polite" data-testid="firmware-loading">
        <span className="ui-spinner" aria-hidden="true" />
        <span className="ui-muted">Preparing code</span>
      </div>
    );
  }
  const fw = plan.firmware;
  const pins = Object.entries(fw.pin_map);
  const failed = fw.compile_status === 'failed';

  return (
    <div className="p1-firmware" data-testid="wiring-firmware">
      <div className="ui-island">
        <dl className="p1-firmware__facts">
          <div>
            <dt>Target</dt>
            <dd className="ui-mono">{fw.target}</dd>
          </div>
          <div>
            <dt>Behavior profile</dt>
            <dd className="ui-mono">{fw.profile_id ?? 'None'}</dd>
          </div>
          <div>
            <dt>Compile status</dt>
            <dd data-testid="firmware-compile-status">{compileWords(fw.compile_status)}</dd>
          </div>
        </dl>
      </div>

      {failed ? (
        <div className="p1-stack">
          <div className="ui-notice ui-notice--warn" role="status">
            The code did not compile. You can keep going; Build will flag it again before flashing.
          </div>
          <details className="p1-details" data-testid="firmware-log">
            <summary>Compile log</summary>
            <div className="p1-details__body">
              <pre className="p1-log">The engine reported a failed compile but this build carries no log text.</pre>
            </div>
          </details>
        </div>
      ) : null}

      <div className="ui-island">
        <h3 className="ui-h3" style={{ marginBottom: 8 }}>
          Pin map
        </h3>
        {pins.length === 0 ? (
          <p className="ui-muted" style={{ margin: 0 }} data-testid="firmware-no-pinmap">
            The pin map isn&apos;t in this build yet.
          </p>
        ) : (
          <table className="p1-pinmap" data-testid="firmware-pinmap">
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col">Pin</th>
              </tr>
            </thead>
            <tbody>
              {pins.map(([signal, pin]) => (
                <tr key={signal}>
                  <td className="ui-mono">{signal}</td>
                  <td className="ui-mono">{String(pin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="p1-download">
        {downloadUrl ? (
          <a className="ui-btn ui-btn--secondary" href={downloadUrl} download data-testid="firmware-download">
            <Icon name="download" /> Download firmware
          </a>
        ) : (
          <>
            <button
              type="button"
              className="ui-btn ui-btn--secondary"
              disabled
              aria-describedby="firmware-download-why"
              data-testid="firmware-download"
            >
              <Icon name="download" /> Download firmware
            </button>
            <span id="firmware-download-why" className="ui-small ui-muted" data-testid="firmware-download-reason">
              Downloads need the live engine. This saved example has no compiled package to fetch.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
