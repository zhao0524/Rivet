'use client';

import { behaviorLabel, targetPlain } from '../../../lib/flow/derive';
import type { FirmwareSpec } from '../../../lib/rivet/types';
import { Icon } from '../../system/Icon';
import { firmwareTargetLabel } from './build-model';

export interface FlashFirmwareCardProps {
  firmware: FirmwareSpec;
  /** Real download URL from the data source, or null when none exists (offline). */
  downloadUrl: string | null;
}

const COMPILE_LABEL: Record<string, string> = {
  passed: 'builds without errors',
  not_checked: 'not checked yet',
  failed: "didn't build",
  not_supported: "Rivet can't check code for this board yet",
};

/**
 * Inline at the step where the board is mounted: how to copy the starter code onto the
 * controller board over USB ("flashing the firmware"), plus a checklist for when it fails.
 */
export function FlashFirmwareCard({ firmware, downloadUrl }: FlashFirmwareCardProps) {
  const compile = COMPILE_LABEL[firmware.compile_status] ?? firmware.compile_status.replace(/_/g, ' ');
  const platformio = /platformio/i.test(firmware.target);
  return (
    <section className="build__firmware" aria-labelledby="build-firmware-title" data-testid="build-firmware">
      <div className="build__firmware-head">
        <Icon name="bolt" aria-hidden="true" style={{ color: 'var(--ui-accent-text)' }} />
        <h3 id="build-firmware-title" className="ui-h3">
          Load the starter code
        </h3>
      </div>
      <p className="p2-note" style={{ margin: 0 }}>
        Now that the controller board is in place, copy the starter code onto it over USB. People also call this flashing
        the firmware.
      </p>
      <div className="build__firmware-meta">
        <span>Board: {targetPlain(firmware.target)}</span>
        <span>Behavior: {behaviorLabel(firmware.profile_id)}</span>
        <span>Code check: {compile}</span>
      </div>
      <ol className="p2-steps">
        <li>Plug the controller board into your computer with a USB cable that carries data, not a charge-only one.</li>
        {platformio ? (
          <>
            <li>Open the downloaded code folder in VS Code with the PlatformIO add-on installed.</li>
            <li>Click PlatformIO&apos;s Upload button to copy the code onto the board. Keep the board on USB power only while it uploads.</li>
          </>
        ) : (
          <li>Open the downloaded code in the tool it was made for and upload it to the board. Keep the board on USB power only while it uploads.</li>
        )}
      </ol>
      <div className="p2-row-actions">
        {downloadUrl ? (
          <a className="ui-btn ui-btn--secondary ui-btn--sm" href={downloadUrl} target="_blank" rel="noopener noreferrer" data-testid="build-firmware-download">
            <Icon name="download" aria-hidden="true" /> Download starter code
          </a>
        ) : (
          <>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled aria-describedby="build-firmware-why" data-testid="build-firmware-download">
              <Icon name="download" aria-hidden="true" /> Download starter code
            </button>
            <span id="build-firmware-why" className="ui-small ui-muted">
              Downloads need Rivet&apos;s live engine, which isn&apos;t connected right now.
            </span>
          </>
        )}
      </div>
      <details className="p2-details" data-testid="build-firmware-help">
        <summary>Upload didn&apos;t work?</summary>
        <div className="p2-details__body">
          <p className="p2-note" style={{ marginTop: 0 }}>
            Work through this list, then try the upload again.
          </p>
          <ul className="p2-steps" style={{ listStyle: 'disc' }}>
            <li>Use a USB cable that carries data. Charge-only cables look the same but the computer never sees the board.</li>
            <li>Install the USB driver for your board&apos;s USB chip (usually CP210x or CH340), then unplug the board and plug it back in.</li>
            <li>Hold the board&apos;s BOOT button while the upload starts, and let go once it connects.</li>
            <li>Try another USB port, or one right on the computer instead of a hub.</li>
          </ul>
          <p className="p2-note">
            Technical details: firmware target <span className="ui-mono">{firmware.target}</span> ({firmwareTargetLabel(firmware.target)}), profile{' '}
            <span className="ui-mono">{firmware.profile_id ?? 'none'}</span>, compile status <span className="ui-mono">{firmware.compile_status}</span>.
          </p>
        </div>
      </details>
    </section>
  );
}
