'use client';

import { behaviorLabel, compilePlain, pinPurpose, targetPlain } from '../../../lib/flow/derive';
import type { BuildPlan, CompileStatus } from '../../../lib/rivet/types';
import { Icon } from '../../system/Icon';
import { MoreDetails } from '../phase1/shared';

export interface FirmwarePanelProps {
  plan: BuildPlan;
  /** Export URL for the firmware package, or null when the data source cannot provide one. */
  downloadUrl: string | null;
  /** Shown while the build is still loading. */
  loading?: boolean;
}

/** Compile status in plain words, e.g. `not_checked` → "Not checked yet. …". */
export function compileWords(status: CompileStatus): string {
  return compilePlain(status);
}

/**
 * The starter code (firmware) for the controller board: which board and behavior it targets,
 * whether it has been test-built, which pin each wire uses, and one Download button.
 * Loading it onto the board happens in Build.
 */
export function FirmwarePanel({ plan, downloadUrl, loading = false }: FirmwarePanelProps) {
  if (loading) {
    return (
      <div className="ui-island p1-pending" role="status" aria-live="polite" data-testid="firmware-loading">
        <span className="ui-spinner" aria-hidden="true" />
        <span className="ui-muted">Getting the starter code ready…</span>
      </div>
    );
  }
  const fw = plan.firmware;
  const pins = Object.entries(fw.pin_map);
  const failed = fw.compile_status === 'failed';

  return (
    <div className="p1-firmware" data-testid="wiring-firmware">
      <div className="ui-island">
        <p className="ui-muted" style={{ margin: '0 0 12px' }}>
          This is the program that runs on the controller board and makes the robot behave. It already knows which pin
          each wire uses.
        </p>
        <dl className="p1-firmware__facts">
          <div>
            <dt>Runs on</dt>
            <dd>{targetPlain(fw.target)}</dd>
          </div>
          <div>
            <dt>What it does</dt>
            <dd>{behaviorLabel(fw.profile_id)}</dd>
          </div>
          <div>
            <dt>Test build</dt>
            <dd data-testid="firmware-compile-status">{compileWords(fw.compile_status)}</dd>
          </div>
        </dl>
        <div style={{ marginTop: 10 }}>
          <MoreDetails testId="firmware-details">
            Firmware target <span className="ui-mono">{fw.target}</span> · behavior profile{' '}
            <span className="ui-mono">{fw.profile_id ?? 'none'}</span> · compile status{' '}
            <span className="ui-mono">{fw.compile_status}</span>.
            {/platformio/i.test(fw.target) ? ' The download is a PlatformIO project.' : null}
          </MoreDetails>
        </div>
      </div>

      {failed ? (
        <div className="p1-stack">
          <div className="ui-notice ui-notice--warn" role="status">
            The starter code didn&apos;t build. You can keep going; Build will remind you before you load it onto the board.
          </div>
          <details className="p1-details" data-testid="firmware-log">
            <summary>Error log</summary>
            <div className="p1-details__body">
              <pre className="p1-log">Rivet&apos;s engine reported a failed build, but this design carries no log text.</pre>
            </div>
          </details>
        </div>
      ) : null}

      <div className="ui-island">
        <h3 className="ui-h3" style={{ marginBottom: 4 }}>
          Which pin does what
        </h3>
        <p className="ui-small ui-muted" style={{ margin: '0 0 8px' }}>
          The pin numbers on the controller board that the code uses (the pin map).
        </p>
        {pins.length === 0 ? (
          <p className="ui-muted" style={{ margin: 0 }} data-testid="firmware-no-pinmap">
            This design doesn&apos;t say which pins the code uses yet.
          </p>
        ) : (
          <table className="p1-pinmap" data-testid="firmware-pinmap">
            <thead>
              <tr>
                <th scope="col">What it controls</th>
                <th scope="col">Pin</th>
              </tr>
            </thead>
            <tbody>
              {pins.map(([signal, pin]) => (
                <tr key={signal} data-testid={`firmware-pin-${signal}`}>
                  <td>
                    {pinPurpose(signal)}{' '}
                    <span className="ui-mono ui-small ui-muted" style={{ display: 'block' }}>
                      {signal}
                    </span>
                  </td>
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
            <Icon name="download" /> Download starter code
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
              <Icon name="download" /> Download starter code
            </button>
            <span id="firmware-download-why" className="ui-small ui-muted" data-testid="firmware-download-reason">
              Downloads need Rivet&apos;s live engine, which isn&apos;t connected right now. This saved example has no code
              package to download.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
