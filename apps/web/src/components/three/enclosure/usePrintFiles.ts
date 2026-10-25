'use client';

import { useMemo, useState } from 'react';
import type { BuildPlan, CatalogComponent } from '../../../lib/rivet/types';
import { downloadBlob, exportPrintFile, printFileName, type PrintFormat } from './export';
import { enclosureMeshes } from './geometry';
import { computeEnclosure, type EnclosureSpec } from './layout';

export interface PrintFiles {
  /** Null when the build has no chassis to put a body on. */
  spec: EnclosureSpec | null;
  /** Outer size of the shell, millimetres, as width × length × height. */
  size: [number, number, number] | null;
  busy: PrintFormat | null;
  error: string | null;
  download: (format: PrintFormat) => Promise<boolean>;
}

/** The printed body for a plan, and saving it as OBJ or STL. */
export function usePrintFiles(plan: BuildPlan, catalog: readonly CatalogComponent[]): PrintFiles {
  const spec = useMemo(() => computeEnclosure(plan.components, catalog), [plan.components, catalog]);
  const [busy, setBusy] = useState<PrintFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const size = spec
    ? ([0, 2, 1].map((i) => Math.round(spec.shell.max[i]! - spec.shell.min[i]!)) as [number, number, number])
    : null;

  async function download(format: PrintFormat): Promise<boolean> {
    if (!spec) return false;
    setBusy(format);
    setError(null);
    try {
      const meshes = await enclosureMeshes(spec);
      downloadBlob(printFileName(plan.build_id, plan.revision, format), exportPrintFile(meshes, format, plan.title));
      return true;
    } catch (e) {
      console.warn('Rivet: print file export failed', e);
      setError("Couldn't make the print file in this browser. Try again, or try another browser.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { spec, size, busy, error, download };
}
