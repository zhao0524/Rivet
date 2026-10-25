'use client';

import type { FirmwareSpec } from '../../../lib/rivet/types';
import { Icon } from '../../system/Icon';
import { firmwareTargetLabel } from './build-model';

export interface FlashFirmwareCardProps {
  firmware: FirmwareSpec;
  /** Real download URL from the data source, or null when none exists (offline). */
  downloadUrl: string | null;
}

const COMPILE_LABEL: Record<string, string> = {
  not_checked: 'not checked yet',
  compiled: 'compiled',
  failed: 'failed to compile',
};

/** Inline at the step where the board is mounted: plain PlatformIO steps plus the recovery checklist. */
export function FlashFirmwareCard({ firmware, downloadUrl }: FlashFirmwareCardProps) {
  const compile = COMPILE_LABEL[firmware.compile_status] ?? firmware.compile_status.replace(/_/g, ' ');
  return (
    <section className="build__firmware" aria-labelledby="build-firmware-title" data-testid="build-firmware">
      <div className="build__firmware-head">
        <Icon name="bolt" aria-hidden="true" style={{ color: 'var(--ui-accent-text)' }} />
        <h3 id="build-firmware-title" className="ui-h3">
          Flash firmware
        </h3>
      </div>
      <div className="build__firmware-meta">
        <span>Target: {firmwareTargetLabel(firmware.target)}</span>
        <span>Profile: {firmware.profile_id ?? 'none'}</span>
        <span>Compile status: {compile}</span>
      </div>
      <ol className="p2-steps">
        <li>Connect the board to your computer with a USB data cable.</li>
        <li>Open the downloaded firmware project in VS Code with the PlatformIO extension.</li>
        <li>Run PlatformIO&apos;s Upload. Keep the board on USB power only while flashing.</li>
      </ol>
      <div className="p2-row-actions">
        {downloadUrl ? (
          <a className="ui-btn ui-btn--secondary ui-btn--sm" href={downloadUrl} target="_blank" rel="noopener noreferrer" data-testid="build-firmware-download">
            <Icon name="download" aria-hidden="true" /> Download firmware
          </a>
        ) : (
          <>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled aria-describedby="build-firmware-why" data-testid="build-firmware-download">
              <Icon name="download" aria-hidden="true" /> Download firmware
            </button>
            <span id="build-firmware-why" className="ui-small ui-muted">
              Needs the live engine; not available offline.
            </span>
          </>
        )}
      </div>
      <details className="p2-details" data-testid="build-firmware-help">
        <summary>Flashing failed?</summary>
        <div className="p2-details__body">
          <p className="p2-note" style={{ marginTop: 0 }}>
            Work through this list, then simply try the Upload again.
          </p>
          <ul className="p2-steps" style={{ listStyle: 'disc' }}>
            <li>Use a data-capable USB cable; charge-only cables look identical and never show a port.</li>
            <li>Install the USB serial driver for your board (CP210x or CH340), then unplug and replug.</li>
            <li>Hold the BOOT button while the upload starts, release once it connects.</li>
            <li>Try another USB port, or a port directly on the computer instead of a hub.</li>
          </ul>
        </div>
      </details>
    </section>
  );
}
