import type {
  BuildPlan,
  CatalogComponent,
  EvidenceLevel,
  PlanComponent,
  VerificationFinding,
} from '../rivet/types';

/* ── Part groups (Parts step) ─────────────────────────── */

export const PART_GROUPS = ['frame', 'drive', 'power', 'control', 'sensing', 'hardware'] as const;
export type PartGroup = (typeof PART_GROUPS)[number];

export const PART_GROUP_LABEL: Record<PartGroup, string> = {
  frame: 'Frame',
  drive: 'Drive',
  power: 'Power',
  control: 'Control',
  sensing: 'Sensing',
  hardware: 'Hardware',
};

/** Catalog category or role → group. Unknown categories land in hardware. */
export function partGroup(category: string, role = ''): PartGroup {
  const key = `${category} ${role}`.toLowerCase();
  if (/chassis|frame|caster|enclosure|bracket|plate/.test(key)) return 'frame';
  if (/motor|wheel|drive|gear|servo/.test(key)) return 'drive';
  if (/power|battery|regulator|charger/.test(key)) return 'power';
  if (/board|controller|driver|mcu|esp32/.test(key)) return 'control';
  if (/sensor|camera|imu|range/.test(key)) return 'sensing';
  return 'hardware';
}

export interface PartRow {
  instanceId: string;
  catalogId: string;
  name: string;
  manufacturer: string;
  role: string;
  group: PartGroup;
  component: PlanComponent;
  catalog: CatalogComponent | null;
  /** Rendered as a labelled box: no real mesh, so it is never mistaken for the real part. */
  standIn: boolean;
  /** Advisory findings (warnings, unverified) touching this part: shown as a dot, not a banner. */
  warnings: VerificationFinding[];
}

export function catalogIndex(catalog: readonly CatalogComponent[]): Map<string, CatalogComponent> {
  return new Map(catalog.map((c) => [c.catalog_id, c]));
}

export function partRows(plan: BuildPlan, catalog: readonly CatalogComponent[]): PartRow[] {
  const byId = catalogIndex(catalog);
  const advisory = plan.verification.findings.filter((f) => !isBlocking(f) && f.result !== 'PASS');
  return plan.components
    .filter((c) => c.render_overrides?.visible !== false)
    .map((c) => {
      const cat = byId.get(c.catalog_id) ?? null;
      return {
        instanceId: c.instance_id,
        catalogId: c.catalog_id,
        name: cat?.identity.model ?? c.catalog_id,
        manufacturer: cat?.identity.manufacturer ?? 'Unknown',
        role: c.role,
        group: partGroup(cat?.identity.category ?? c.catalog_id, c.role),
        component: c,
        catalog: cat,
        standIn: !cat || cat.physical.geometry_kind !== 'asset',
        warnings: advisory.filter((f) => f.affected_instance_ids.includes(c.instance_id)),
      };
    });
}

export function groupParts(rows: readonly PartRow[]): Array<{ group: PartGroup; rows: PartRow[] }> {
  return PART_GROUPS.map((group) => ({ group, rows: rows.filter((r) => r.group === group) })).filter(
    (g) => g.rows.length > 0,
  );
}

/* ── Checks (Review step) ─────────────────────────────── */

const SAFETY = /safety|lipo|mains|high.?current|thermal|short|polarity/i;

/** Blocking = a FAIL with blocking severity, or any non-passing safety check. */
export function isBlocking(f: VerificationFinding): boolean {
  if (f.result === 'PASS') return false;
  if (SAFETY.test(f.rule_id)) return true;
  return f.severity === 'blocking' && (f.result === 'FAIL' || f.result === 'UNKNOWN');
}

export function isSafety(f: VerificationFinding): boolean {
  return SAFETY.test(f.rule_id);
}

export function blockers(plan: BuildPlan): VerificationFinding[] {
  return plan.verification.findings.filter(isBlocking);
}

/** Readable title for a rule id, e.g. `power.motor_current_budget` → "Motor current budget". */
export function ruleTitle(ruleId: string): string {
  const tail = ruleId.split('.').pop() ?? ruleId;
  const words = tail.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ── Spec drawer ──────────────────────────────────────── */

export type SpecSource = 'Datasheet' | 'Checked' | 'AI estimate';

export interface SpecRow {
  label: string;
  /** null = "Not in datasheet", never a guess. */
  value: string | null;
  source: SpecSource | null;
}

function sourceFor(level: EvidenceLevel, hasDatasheet: boolean): SpecSource {
  if (level === 'verified') return hasDatasheet ? 'Datasheet' : 'Checked';
  return 'AI estimate';
}

function range(min: number | null, max: number | null, unit: string): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max) return `${min}–${max} ${unit}`;
  return `${max ?? min} ${unit}`;
}

export function specRows(cat: CatalogComponent | null, currency = 'USD'): SpecRow[] {
  if (!cat) {
    return ['Voltage', 'Current', 'Dimensions', 'Weight', 'Interface', 'Price'].map((label) => ({
      label,
      value: null,
      source: null,
    }));
  }
  const ds = Boolean(cat.sourcing.datasheet_url);
  const elec = sourceFor(cat.evidence.electrical, ds);
  const ports = cat.ports;
  const vMin = ports.map((p) => p.voltage_min_v).filter((v): v is number => v !== null);
  const vMax = ports.map((p) => p.voltage_max_v).filter((v): v is number => v !== null);
  const cur = ports.map((p) => p.current_limit_a).filter((v): v is number => v !== null);
  const d = cat.physical.dimensions_mm;
  const signals = Array.from(new Set(ports.map((p) => p.signal))).slice(0, 6);
  const voltage = range(vMin.length ? Math.min(...vMin) : null, vMax.length ? Math.max(...vMax) : null, 'V');
  const current = cur.length ? `${Math.max(...cur)} A max` : null;
  const price = cat.sourcing.price_amount
    ? `${cat.sourcing.price_amount} ${cat.sourcing.price_currency ?? currency}`
    : null;
  return [
    { label: 'Voltage', value: voltage, source: voltage ? elec : null },
    { label: 'Current', value: current, source: current ? elec : null },
    {
      label: 'Dimensions',
      value: `${d.x} × ${d.y} × ${d.z} mm`,
      source: cat.physical.bounds_verified ? (ds ? 'Datasheet' : 'Checked') : 'AI estimate',
    },
    {
      label: 'Weight',
      value: cat.physical.mass_g !== null ? `${cat.physical.mass_g} g` : null,
      source: cat.physical.mass_g !== null ? sourceFor(cat.evidence.dimensions, ds) : null,
    },
    { label: 'Interface', value: signals.length ? signals.join(', ') : null, source: signals.length ? elec : null },
    { label: 'Price', value: price, source: price ? sourceFor(cat.evidence.price, false) : null },
  ];
}

export function isAiEstimated(cat: CatalogComponent | null): boolean {
  if (!cat) return true;
  return [cat.evidence.electrical, cat.evidence.dimensions].some((l) => l !== 'verified');
}

/* ── Buy step ─────────────────────────────────────────── */

export function safeHttpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function vendorFromUrl(url: string | null): string {
  if (!url) return 'No verified vendor';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = host.split('.').slice(-2, -1)[0] ?? host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'No verified vendor';
  }
}

export interface BuyLine {
  catalogId: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  url: string | null;
  vendor: string;
  inStock: 'in_stock' | 'out_of_stock' | 'unknown';
  checkedAt: string | null;
  fabricated: boolean;
}

export function buyLines(plan: BuildPlan, catalog: readonly CatalogComponent[]): BuyLine[] {
  const byId = catalogIndex(catalog);
  return plan.bom.items.map((item) => {
    const cat = byId.get(item.catalog_id) ?? null;
    // Only a verified product listing counts as a buy link; references never pose as one.
    const url = item.link_status === 'verified_product' ? safeHttpUrl(item.purchase_url) : null;
    const stock = cat?.sourcing.availability_status;
    return {
      catalogId: item.catalog_id,
      name: cat?.identity.model ?? item.catalog_id,
      quantity: item.quantity,
      unitPrice: item.unit_price_amount !== null ? Number(item.unit_price_amount) : null,
      url,
      vendor: vendorFromUrl(url),
      inStock: stock === 'in_stock' ? 'in_stock' : stock === 'out_of_stock' ? 'out_of_stock' : 'unknown',
      checkedAt: cat?.sourcing.price_checked_at ?? null,
      fabricated: /printed|fabricat|3d.?print/i.test(`${cat?.identity.category ?? ''} ${item.catalog_id}`),
    };
  });
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatCheckedAt(iso: string | null): string {
  if (!iso) return 'Price never checked';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Price never checked';
  return `Checked ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
