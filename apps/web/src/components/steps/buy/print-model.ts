import type { BuyLine } from '../../../lib/flow/derive';
import type { CatalogComponent } from '../../../lib/rivet/types';
import type { Size3 } from '../../three/parts/types';
import { conceptShape } from '../../three/parts/recipes/ConceptPart';

export interface PrintLine {
  line: BuyLine;
  shape: string;
  size: Size3;
}

/** Circuit boards, cells and wiring have to be bought even without a listing; a printed copy does nothing. */
const NOT_PRINTABLE_CATEGORIES = new Set(['board', 'battery', 'sensor', 'antenna', 'cable', 'wire']);

/**
 * Concept parts with no store link and no price that can stand in as a 3D print: the part's
 * own shape at its estimated size. Kit contents and parts already marked as printed are left out.
 */
export function printableLines(lines: readonly BuyLine[], catalog: readonly CatalogComponent[]): PrintLine[] {
  const byId = new Map(catalog.map((c) => [c.catalog_id, c]));
  const out: PrintLine[] = [];
  for (const line of lines) {
    if (line.url || line.unitPrice !== null || line.included || line.fabricated) continue;
    const cat = byId.get(line.catalogId);
    const shape = conceptShape(cat?.physical.geometry_kind);
    if (!cat || !shape || shape === 'cable') continue;
    if (cat.physical.material_preset === 'pcb' || NOT_PRINTABLE_CATEGORIES.has(cat.identity.category)) continue;
    const { x, y, z } = cat.physical.dimensions_mm;
    if (![x, y, z].every((v) => Number.isFinite(v) && v > 0)) continue;
    out.push({ line, shape, size: { x, y, z } });
  }
  return out;
}

/** "40 × 12 × 30 mm" */
export function sizeLabel({ x, y, z }: Size3): string {
  const n = (v: number) => (Math.round(v * 10) / 10).toString();
  return `${n(x)} × ${n(y)} × ${n(z)} mm`;
}

export function stlFileName(buildId: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part';
  return `${buildId}-${slug}.stl`;
}
