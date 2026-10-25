'use client';

import { useMemo, useState } from 'react';
import { buyLines } from '../../lib/flow/derive';
import type { BuildPlan, CatalogComponent } from '../../lib/rivet/types';
import { printableLines, sizeLabel, stlFileName, type PrintLine } from '../steps/buy/print-model';
import { Icon } from '../system/Icon';

/**
 * Parts of a build no store sells (no price, no link): they are printed from the model at its
 * estimated size instead. Plastic pieces print as the part; electronics print as a stand-in.
 * Keyed by catalog id.
 */
export function usePrintable(plan: BuildPlan, catalog: readonly CatalogComponent[]): ReadonlyMap<string, PrintLine> {
  return useMemo(() => {
    const all = [...catalog, ...(plan.concept_catalog ?? [])];
    return new Map(printableLines(buyLines(plan, all), all).map((p) => [p.line.catalogId, p]));
  }, [plan, catalog]);
}

/** What a printable row says in place of a price. */
export function printLabel(part: PrintLine): string {
  return part.standIn ? 'Not sold yet · print a stand-in' : 'Custom part';
}

/** The 3D-print control on a custom part's row (a cube); its files open underneath the row. */
export function PrintButton({ part, open, onToggle }: { part: PrintLine; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="ws-print"
      aria-expanded={open}
      aria-label={`3D print ${part.line.name}`}
      title="3D print"
      onClick={onToggle}
      data-testid={`workspace-print-${part.line.catalogId}`}
    >
      <Icon name="cube" size={14} />
    </button>
  );
}

type Format = 'stl' | 'obj';

/** A custom part's print files, made on the spot from its shape and size. Multiples come on one plate. */
export function PrintMenu({ part, buildId, onSaved }: { part: PrintLine; buildId: string; onSaved?: (name: string) => void }) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(format: Format) {
    setBusy(format);
    setError(null);
    try {
      const [{ printPlateObj, printPlateStl }, { downloadBlob }] = await Promise.all([
        import('../../lib/print/stl'),
        import('../three/enclosure/export'),
      ]);
      const plate = [{ shape: part.shape, size: part.size, count: part.line.quantity }];
      const file = stlFileName(buildId, part.line.name).replace(/\.stl$/, `.${format}`);
      const blob =
        format === 'stl'
          ? new Blob([printPlateStl(plate)], { type: 'model/stl' })
          : new Blob([printPlateObj(plate)], { type: 'text/plain' });
      downloadBlob(file, blob);
      onSaved?.(file);
    } catch (err) {
      console.warn('Rivet: custom part export failed', err);
      setError("Couldn't make the print file. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ws-print__menu" data-testid="workspace-print-menu">
      <span className="ws-guide__sub">
        3D print · {sizeLabel(part.size)}
        {part.line.quantity > 1 ? ` · ${part.line.quantity} on one plate` : ''}
      </span>
      {part.standIn ? (
        <span className="ws-guide__sub" data-testid="workspace-print-standin">
          A same-size stand-in that holds its place in the build. It won&apos;t work like the real part.
        </span>
      ) : null}
      <div className="ws-guide__btns">
        <button type="button" className="ws-btn ws-btn--sm" onClick={() => void save('stl')} disabled={busy !== null} data-testid="workspace-print-stl">
          <Icon name="download" size={13} /> .stl
        </button>
        <button type="button" className="ws-btn ws-btn--sm" onClick={() => void save('obj')} disabled={busy !== null} data-testid="workspace-print-obj">
          <Icon name="download" size={13} /> .obj
        </button>
      </div>
      {error ? <span className="ws-guide__sub ws-guide__sub--danger">{error}</span> : null}
    </div>
  );
}
