import type { BuyLine } from '../../../lib/flow/derive';
import type { CatalogComponent } from '../../../lib/rivet/types';
import type { Size3 } from '../../three/parts/types';
import { conceptShape } from '../../three/parts/recipes/ConceptPart';

export interface PrintLine {
  line: BuyLine;
  shape: string;
  size: Size3;
  /**
   * The part is electronics (a board, a battery, a sensor): the print is a same-size stand-in that
   * holds its place in the build until a real one is found. It does nothing electrically.
   */
  standIn: boolean;
}

/** Wiring has no solid shape worth printing. */
const NOT_PRINTABLE_CATEGORIES = new Set(['cable', 'wire']);

/** Electronics: printable only as a stand-in. */
const ELECTRONIC_CATEGORIES = new Set(['board', 'battery', 'sensor', 'antenna']);

/**
 * Within electronics, the plastic around them is a real part, not a stand-in: a sensor's face panel,
 * ring, dome, base or ribs are housings, not the sensor.
 */
const HOUSING_NAME = /\b(panel|ring|dome|base|ribs?|cover|shell|cap|bezel|housing|case|enclosure|bracket|mount|plate|frame|trim|hood|guard|lid)\b/i;

/**
 * Parts nobody sells (no store link and no price) offered as a 3D print instead: the part's own
 * concept shape at its size, or its bounding box when it has no concept shape. Electronics print
 * as stand-ins (`standIn`). Wires, kit contents and parts already marked as printed are left out.
 */
export function printableLines(lines: readonly BuyLine[], catalog: readonly CatalogComponent[]): PrintLine[] {
  const byId = new Map(catalog.map((c) => [c.catalog_id, c]));
  const out: PrintLine[] = [];
  for (const line of lines) {
    if (line.url || line.unitPrice !== null || line.included || line.fabricated) continue;
    const cat = byId.get(line.catalogId);
    if (!cat) continue;
    const shape = conceptShape(cat.physical.geometry_kind) ?? 'box';
    if (shape === 'cable' || NOT_PRINTABLE_CATEGORIES.has(cat.identity.category)) continue;
    const { x, y, z } = cat.physical.dimensions_mm;
    if (![x, y, z].every((v) => Number.isFinite(v) && v > 0)) continue;
    const electronic = cat.physical.material_preset === 'pcb' || ELECTRONIC_CATEGORIES.has(cat.identity.category);
    out.push({ line, shape, size: { x, y, z }, standIn: electronic && !HOUSING_NAME.test(line.name) });
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
