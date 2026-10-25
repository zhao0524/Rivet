'use client';

import { useState } from 'react';
import type { BuildPlan, CatalogComponent } from '../../../lib/rivet/types';
import { usePrintFiles } from '../../three/enclosure/usePrintFiles';
import { Icon } from '../../system/Icon';

export interface PrintedBodyCardProps {
  plan: BuildPlan;
  catalog: readonly CatalogComponent[];
  /** Practice example made of placeholder parts: sizes are not real, so say so. */
  synthetic?: boolean;
}

/**
 * Shown at the first build step: the plastic body Rivet shaped for this build, and its print files.
 * The body is the see-through shell in the 3D view, plus the standoffs that hold the boards up.
 */
export function PrintedBodyCard({ plan, catalog, synthetic = false }: PrintedBodyCardProps) {
  const files = usePrintFiles(plan, catalog);
  const [saved, setSaved] = useState<string | null>(null);
  if (!files.spec || !files.size) return null;
  const { spec, size } = files;
  const windows = spec.cutouts.filter((c) => c.id.startsWith('window-')).length;
  const motorOpenings = spec.cutouts.filter((c) => c.id.startsWith('axle-')).length;

  async function save(format: 'obj' | 'stl') {
    setSaved(null);
    if (await files.download(format)) setSaved(`Saved the ${format.toUpperCase()} file. Open it in your slicer; sizes are in millimetres.`);
  }

  return (
    <section className="build__firmware" aria-labelledby="build-body-title" data-testid="build-printed-body">
      <div className="build__firmware-head">
        <Icon name="cube" aria-hidden="true" style={{ color: 'var(--ui-accent-text)' }} />
        <h3 id="build-body-title" className="ui-h3">
          Print the body first
        </h3>
      </div>
      <p className="p2-note" style={{ margin: 0 }}>
        Rivet shaped a plastic body around this build&apos;s parts: the see-through shell in the model, plus small posts that
        hold each board up off the deck. Print it before you start, then fit the parts into it.
      </p>
      <div className="build__firmware-meta">
        <span>
          Shell: {size[0]} × {size[1]} × {size[2]} mm
        </span>
        <span>
          {spec.posts.length} {spec.posts.length === 1 ? 'post' : 'posts'} under the boards
        </span>
        {spec.tabs.length ? <span>{spec.tabs.length} screw tabs for M3 screws</span> : null}
      </div>
      <ul className="p2-steps" style={{ listStyle: 'disc' }}>
        {windows ? <li>A window in the front lets the distance sensor see out.</li> : null}
        {motorOpenings ? <li>Openings in the sides let the motors and wheel shafts through.</li> : null}
        <li>A slot at the back fits the USB cable and power switch, and vents sit over the motor driver.</li>
        <li>Print in PLA at 0.2 mm layers. The shell lies on its roof in the file, so it needs no supports.</li>
      </ul>
      {synthetic ? (
        <p className="ui-notice" style={{ margin: 0 }} data-testid="build-printed-body-placeholder">
          This practice example is made of placeholder parts, so the body is sized for them, not for real parts.
        </p>
      ) : null}
      <div className="p2-row-actions">
        <button
          type="button"
          className="ui-btn ui-btn--secondary ui-btn--sm"
          onClick={() => void save('obj')}
          disabled={files.busy !== null}
          data-testid="build-printed-body-obj"
        >
          <Icon name="download" aria-hidden="true" /> {files.busy === 'obj' ? 'Making the file…' : 'Download .obj'}
        </button>
        <button
          type="button"
          className="ui-btn ui-btn--secondary ui-btn--sm"
          onClick={() => void save('stl')}
          disabled={files.busy !== null}
          data-testid="build-printed-body-stl"
        >
          <Icon name="download" aria-hidden="true" /> {files.busy === 'stl' ? 'Making the file…' : 'Download .stl'}
        </button>
      </div>
      <p className="p2-status ui-small" role="status" aria-live="polite" style={{ margin: 0 }}>
        {files.error ?? saved}
      </p>
    </section>
  );
}
