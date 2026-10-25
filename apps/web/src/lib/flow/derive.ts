import type {
  BuildPlan,
  CatalogComponent,
  EvidenceLevel,
  PlanComponent,
  VerificationFinding,
} from '../rivet/types';
import { isConceptPlan } from '../rivet/honesty';

/* ── Part groups (Parts step) ─────────────────────────── */

export const PART_GROUPS = ['frame', 'drive', 'power', 'control', 'sensing', 'hardware'] as const;
export type PartGroup = (typeof PART_GROUPS)[number];

/** Plain group names a maker would use. Keys stay stable; other code relies on them. */
export const PART_GROUP_LABEL: Record<PartGroup, string> = {
  frame: 'Frame',
  drive: 'Wheels & motors',
  power: 'Power',
  control: 'Brains',
  sensing: 'Sensors',
  hardware: 'Wires & small parts',
};

/** One line under each group heading: what the parts in it are for. */
export const PART_GROUP_HINT: Record<PartGroup, string> = {
  frame: 'The body everything bolts onto.',
  drive: 'What makes the robot move.',
  power: 'Batteries and supplies that keep it running.',
  control: 'The boards that decide what to do and drive the motors.',
  sensing: 'How the robot notices the world around it.',
  hardware: 'Cables, breadboards and other bits that hold it together.',
};

const GROUP_TESTS: ReadonlyArray<[PartGroup, RegExp]> = [
  ['frame', /chassis|frame|caster|enclosure|bracket|plate/],
  // Before drive: a "motor_power" battery or a "motor_driver" board is not a motor.
  ['power', /power|battery|regulator|charger/],
  ['control', /board|controller|driver|mcu|esp32/],
  ['drive', /motor|wheel|drive|gear|servo/],
  ['sensing', /sensor|camera|imu|range/],
];

/** Catalog category, then role → group. Unknown categories land in hardware. */
export function partGroup(category: string, role = ''): PartGroup {
  for (const key of [category.toLowerCase(), role.toLowerCase()]) {
    if (!key) continue;
    for (const [group, test] of GROUP_TESTS) if (test.test(key)) return group;
  }
  return 'hardware';
}

const ROLE_LABEL: Record<string, string> = {
  chassis: 'frame',
  caster: 'caster wheel',
  wheel: 'wheel',
  motor: 'motor',
  controller: 'controller board',
  motor_driver: 'motor driver',
  distance_sensor: 'distance sensor',
  motor_power: 'motor battery',
  controller_power: 'board power supply',
  power_supply: 'power supply',
  accessory: 'extra part',
};

/** Plain name for a part's job, e.g. `motor_driver` → "motor driver". */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.replace(/[_-]+/g, ' ');
}

/**
 * Short everyday name for one placed part, e.g. `motor-left-1` (motor) → "left motor".
 * Accessories fall back to their catalog name, since "extra part" says nothing.
 */
export function partNickname(instanceId: string, role: string, name?: string | null): string {
  if (role === 'accessory' && name) return name;
  const side = /(^|[-_])left([-_]|$)/i.test(instanceId) ? 'left ' : /(^|[-_])right([-_]|$)/i.test(instanceId) ? 'right ' : '';
  return `${side}${roleLabel(role)}`;
}

/** instance_id → everyday nickname for every component in the plan (hidden accessories too). */
export function partNicknames(plan: BuildPlan, catalog: readonly CatalogComponent[]): Map<string, string> {
  const byId = catalogIndex(catalog);
  return new Map(
    plan.components.map((c) => [c.instance_id, partNickname(c.instance_id, c.role, byId.get(c.catalog_id)?.identity.model)]),
  );
}

/** True for a catalog maker that marks the part as made up for the demo. */
export function isPlaceholderMaker(manufacturer: string): boolean {
  return /synthetic|demo only|placeholder/i.test(manufacturer);
}

/** Maker line for the screen: placeholder makers say so in plain words. */
export function makerLabel(manufacturer: string): string {
  return isPlaceholderMaker(manufacturer) ? 'Placeholder part, not a real product' : manufacturer;
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

/** What a check is about, read from its rule id family. */
export type CheckFamily = 'safety' | 'example' | 'fit' | 'power' | 'wiring' | 'code' | 'buying' | 'parts' | 'plan' | 'other';

const FAMILY_TESTS: ReadonlyArray<[CheckFamily, RegExp]> = [
  ['safety', SAFETY],
  ['example', /^fixture\.|synthetic/i],
  ['parts', /^parts\.|^completeness\.|missing|real_parts|catalog_ids/i],
  ['fit', /^mechanical\.|fit|mount|overlap|geometry|clearance/i],
  ['power', /power|voltage|current|supply|battery|ground/i],
  ['wiring', /^electrical\.|wiring|connection|gpio|i2c|signal|logic/i],
  ['code', /^firmware\.|pin_map|profile|compile/i],
  ['buying', /^sourcing\.|^budget\.|price|link|availability|stock/i],
  ['plan', /^integrity\.|^requirements\./i],
];

export function checkFamily(ruleId: string): CheckFamily {
  for (const [family, test] of FAMILY_TESTS) if (test.test(ruleId)) return family;
  return 'other';
}

/** Plain name for a check family, for a muted "About: …" line. */
export const CHECK_FAMILY_LABEL: Record<CheckFamily, string> = {
  safety: 'Safety',
  example: 'Saved example',
  fit: 'Fit',
  power: 'Power',
  wiring: 'Wiring',
  code: 'Starter code',
  buying: 'Buying',
  parts: 'Parts',
  plan: 'Design file',
  other: 'Other',
};

const FAMILY_HEADLINE: Record<CheckFamily, string> = {
  safety: 'A safety check needs your attention',
  example: 'This saved example isn\'t a real, buildable robot',
  fit: 'A part may not fit where it goes',
  power: 'The power setup needs a closer look',
  wiring: 'A wiring check needs a closer look',
  code: 'The starter code needs a closer look',
  buying: 'Buying a part needs a closer look',
  parts: 'Something may be missing from the parts list',
  plan: 'Something in the design doesn\'t line up',
  other: 'A check needs a closer look',
};

export interface PlainCheck {
  /** Plain headline: what the problem means for the robot. */
  title: string;
  /** One plain sentence on why, only when the rule and data clearly support it. */
  explain: string | null;
  family: CheckFamily;
}

/**
 * Plain headline and explanation for a check, from its rule id and the affected parts.
 * It never adds facts: anything specific comes from the rule id, the result and the
 * part names. The engine's own message is shown next to it as the detail line.
 * `names` maps instance ids to a short everyday name (see `partNickname`).
 */
export function plainCheck(f: VerificationFinding, names: ReadonlyMap<string, string> = new Map()): PlainCheck {
  const family = checkFamily(f.rule_id);
  const unknown = f.result === 'UNKNOWN';
  const ids = f.affected_instance_ids;
  // The first affected part that is not the frame is the one the check is about.
  const subjectId = ids.find((id) => !/^chassis/i.test(id)) ?? ids[0];
  const subject = subjectId ? names.get(subjectId) ?? null : null;
  const The = (s: string) => `The ${s}`;

  if (f.rule_id === 'mechanical.fit_evidence') {
    return {
      family,
      title: subject ? `${The(subject)} may not fit the frame` : FAMILY_HEADLINE.fit,
      explain: unknown
        ? 'Nothing Rivet has on file shows this part fits that spot, so it can\'t promise it will.'
        : 'Rivet found a reason this part may not fit that spot.',
    };
  }
  if (/^fixture\.synthetic|synthetic_not_sourced/.test(f.rule_id)) {
    return {
      family,
      title: 'These are placeholder parts, not real ones',
      explain: 'This example is made of stand-in parts for show. You can\'t buy or build it as it is.',
    };
  }
  if (/complete_power_netlist/.test(f.rule_id)) {
    return {
      family,
      title: 'The power wiring hasn\'t been fully checked',
      explain: 'Rivet hasn\'t checked every power wire or how much current the motors pull.',
    };
  }
  if (f.rule_id === 'parts.missing_catalog_entry') {
    return {
      family,
      title: subject ? `${The(subject)} has no details on file` : 'A part has no details on file',
      explain: 'Rivet\'s parts catalog doesn\'t list this part, so it has no specs or price.',
    };
  }
  if (/supply_capacity/.test(f.rule_id)) {
    return { family, title: 'It\'s not known if the batteries can keep up', explain: unknown ? 'How much power this supply can give, or this part needs, isn\'t documented.' : null };
  }
  if (/motor_voltage|supply_voltage/.test(f.rule_id)) {
    return { family, title: 'The batteries may run too low for a part', explain: null };
  }
  if (/availability/.test(f.rule_id)) {
    return { family, title: subject ? `${The(subject)} was out of stock` : 'A part was out of stock', explain: null };
  }
  if (/geometry_approximated/.test(f.rule_id)) {
    return { family, title: 'Some sizes and positions are estimates', explain: 'The 3D model is a best guess, not measured from the real parts.' };
  }
  return { family, title: FAMILY_HEADLINE[family], explain: null };
}

/** A check's result in plain words, for a badge next to its title. */
export function plainResult(result: VerificationFinding['result']): string {
  if (result === 'PASS') return 'Passed';
  if (result === 'FAIL') return 'Failed';
  if (result === 'WARN') return 'Warning';
  return 'Not confirmed';
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
    return ['Voltage', 'Current', 'Size', 'Weight', 'Connections', 'Price'].map((label) => ({
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
  // Plain names ("power", "speed signal"), deduplicated after translation.
  const signals = Array.from(new Set(ports.map((p) => signalPlain(p.signal)))).slice(0, 6);
  const voltage = range(vMin.length ? Math.min(...vMin) : null, vMax.length ? Math.max(...vMax) : null, 'V');
  const current = cur.length ? `${Math.max(...cur)} A max` : null;
  const price = cat.sourcing.price_amount
    ? `${cat.sourcing.price_amount} ${cat.sourcing.price_currency ?? currency}`
    : null;
  return [
    { label: 'Voltage', value: voltage, source: voltage ? elec : null },
    { label: 'Current', value: current, source: current ? elec : null },
    {
      label: 'Size',
      value: `${d.x} × ${d.y} × ${d.z} mm`,
      source: cat.physical.bounds_verified ? (ds ? 'Datasheet' : 'Checked') : 'AI estimate',
    },
    {
      label: 'Weight',
      value: cat.physical.mass_g !== null ? `${cat.physical.mass_g} g` : null,
      source: cat.physical.mass_g !== null ? sourceFor(cat.evidence.dimensions, ds) : null,
    },
    { label: 'Connections', value: signals.length ? signals.join(', ') : null, source: signals.length ? elec : null },
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

const VENDOR_NAMES: Record<string, string> = { racedayquads: 'RaceDayQuads', sparkfun: 'SparkFun', digikey: 'DigiKey' };

export function vendorFromUrl(url: string | null): string {
  if (!url) return 'No verified vendor';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = host.split('.').slice(-2, -1)[0] ?? host;
    return VENDOR_NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
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
  /** A hand-picked product for a concept part's role: a real listing, not checked against the design. */
  suggested: boolean;
  /** Explicitly documented kit content, not a separate purchase. */
  included?: boolean;
}

export function isIncludedKitPart(cat: CatalogComponent | null): boolean {
  return cat?.sourcing.price_amount !== null && Number(cat?.sourcing.price_amount) === 0 &&
    Boolean(cat?.evidence.notes.some((note) => /included/i.test(note) && /not bought separately/i.test(note)));
}

export function buyLines(plan: BuildPlan, catalog: readonly CatalogComponent[]): BuyLine[] {
  const byId = catalogIndex(catalog);
  const concept = isConceptPlan(plan);
  return plan.bom.items.map((item) => {
    const cat = byId.get(item.catalog_id) ?? null;
    // Only a verified product listing counts as a buy link; references never pose as one. A concept
    // plan's suggested parts are the exception, shown as suggestions.
    const suggested = concept && item.link_status === 'manufacturer_reference_only';
    const url = item.link_status === 'verified_product' || suggested ? safeHttpUrl(item.purchase_url) : null;
    const stock = cat?.sourcing.availability_status;
    // Do not drop a free item just because it costs zero: the catalog must name
    // the included kit, and that kit must actually be in this BOM.
    const kitSku = isIncludedKitPart(cat) ? cat?.identity.model.match(/\(included with ([^)]+)\)/i)?.[1] : null;
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
      suggested: suggested && url !== null,
      included: Boolean(kitSku && item.unit_price_amount !== null && Number(item.unit_price_amount) === 0 &&
        plan.bom.items.some((other) => byId.get(other.catalog_id)?.identity.sku === kitSku)),
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
  // A bare date is a calendar day, not UTC midnight; parse it as local so it never shifts a day.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return 'Price never checked';
  return `Checked ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/* ── Wiring & code (plain words) ──────────────────────── */

/** Plain name for a catalog port signal, e.g. `pwm_input` → "speed signal". */
export function signalPlain(signal: string): string {
  const s = signal.toLowerCase();
  if (/ground|gnd/.test(s)) return 'ground';
  if (/motor_(output|power)/.test(s)) return 'motor power';
  if (/power|vcc|vin/.test(s)) return 'power';
  if (/pwm/.test(s)) return 'speed signal';
  if (/i2c_?sda|^sda$/.test(s)) return 'data wire (I2C data)';
  if (/i2c_?scl|^scl$/.test(s)) return 'data wire (I2C clock)';
  if (/i2c/.test(s)) return 'data wire (I2C)';
  if (/spi|uart|serial/.test(s)) return `data wire (${s.toUpperCase()})`;
  if (/analog/.test(s)) return 'sensor reading';
  if (/digital/.test(s)) return 'on/off signal';
  return s.replace(/[_-]+/g, ' ');
}

export interface WireEnd {
  /** Short everyday part name, e.g. "motor driver". */
  name: string;
  port: string;
  signal: string;
  role?: string;
}

/** Side named in a net or pin name ("MOTOR_LEFT_PWM" → "left "), or "". */
function sideOf(...texts: Array<string | null | undefined>): string {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  if (/left/.test(t)) return 'left ';
  if (/right/.test(t)) return 'right ';
  return '';
}

/**
 * What a wire does, in one plain sentence, from the signal kinds at both ends plus the
 * net and pin names. Falls back to "Connects A to B" when the signal says nothing more.
 */
export function wirePurpose(from: WireEnd, to: WireEnd, netName: string | null = null): string {
  const sig = `${from.signal} ${to.signal}`.toLowerCase();
  const pins = `${from.port} ${to.port} ${netName ?? ''}`.toLowerCase();
  const side = sideOf(netName, from.port, to.port);
  if (/ground|gnd/.test(sig)) return `Joins the ${from.name} to the shared ground`;
  if (/motor_output|motor_power/.test(sig)) return `Carries power that spins the ${side}motor`;
  if (/power/.test(sig)) return `Powers the ${to.name}`;
  if (/pwm/.test(sig) || /pwm/.test(pins)) return `Tells the ${to.name} how fast to spin the ${side}motor`;
  if (/stby|standby/.test(pins)) return `Wakes the ${to.name} up so the motors can run`;
  if (/(^|[\s_])(a|b)?in[12]\b|ain|bin|dir/.test(pins)) return `Sets which way the ${side}motor turns`;
  if (/i2c|sda|scl/.test(sig) || /sda|scl/.test(pins)) {
    const reading = to.role === 'distance_sensor' || /distance|range/.test(to.name) ? 'distance' : 'readings';
    return /scl/.test(pins) ? `Keeps time on the data wire to the ${to.name}` : `Reads ${reading} from the ${to.name}`;
  }
  if (/analog/.test(sig)) return `Reads a value from the ${from.name === to.name ? 'sensor' : to.name}`;
  if (/digital/.test(sig)) return `Sends an on/off signal to the ${to.name}`;
  return `Connects the ${from.name} to the ${to.name}`;
}

/** Plain purpose for a pin-map signal, e.g. `motor_left_pwm` → "Left motor speed". */
export function pinPurpose(signal: string): string {
  const s = signal.toLowerCase();
  const side = /left/.test(s) ? 'Left motor' : /right/.test(s) ? 'Right motor' : 'Motor';
  if (/pwm/.test(s)) return `${side} speed`;
  if (/in[12]|dir/.test(s)) return `${side} direction`;
  if (/standby|stby/.test(s)) return 'Motor driver on/off';
  if (/sda/.test(s)) return 'Sensor data';
  if (/scl/.test(s)) return 'Sensor data clock';
  const words = s.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Engine instructions with part ids swapped for everyday names, e.g.
 * "controller-1.gpio25 to driver-1.pwma (MOTOR_LEFT_PWM)" → "controller board pin gpio25 to motor driver pin pwma".
 * Only ids in `names` are replaced, net names and bare ids in brackets are dropped and
 * "netlist" reads "wiring list"; nothing is added.
 */
export function plainInstructions(text: string, names: ReadonlyMap<string, string>): string {
  if (names.size === 0) return text;
  const ids = [...names.keys()].sort((a, b) => b.length - a.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const idRe = new RegExp(`\\b(${ids.join('|')})\\b(?:\\.([A-Za-z0-9_]+))?`, 'g');
  // A bare id in brackets only labels the thing just named ("the breadboard (accessory-1)").
  const bracketRe = new RegExp(`\\s*\\((${ids.join('|')})\\)`, 'g');
  return text
    .replace(/\s*\(([A-Z][A-Z0-9_]*)\)/g, '')
    .replace(bracketRe, '')
    .replace(idRe, (_m, id: string, port?: string) => {
      const name = names.get(id) ?? id;
      return port ? `the ${name}'s ${port} pin` : `the ${name}`;
    })
    .replace(/\bthe the\b/gi, 'the')
    .replace(/\bnetlist\b/g, 'wiring list');
}

/** Plain words for a compile status. */
export function compilePlain(status: string): string {
  if (status === 'passed') return 'Checked: it builds without errors.';
  if (status === 'failed') return "It didn't build. There's an error in the code.";
  if (status === 'not_checked') return "Not checked yet. It gets built when you copy it onto the board in Build.";
  if (status === 'not_supported') return "Rivet can't check code for this board yet.";
  return status.replace(/_/g, ' ');
}

/** Plain behavior name from a profile id, e.g. `rover.obstacle_avoidance.v1` → "Obstacle avoidance". */
export function behaviorLabel(profileId: string | null): string {
  if (!profileId) return 'None chosen';
  const parts = profileId.split('.').filter((p) => !/^v\d+$/i.test(p));
  const core = parts.length > 1 ? parts[parts.length - 1]! : parts[0] ?? profileId;
  const words = core.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Plain board and language from a firmware target, e.g. `esp32_arduino_platformio` → "ESP32 board, Arduino code". */
export function targetPlain(target: string): string {
  const t = target.toLowerCase();
  const out: string[] = [];
  if (/esp32/.test(t)) out.push('ESP32 board');
  else if (/pico|rp2040/.test(t)) out.push('Raspberry Pi Pico board');
  if (/arduino/.test(t)) out.push('Arduino code');
  else if (/micropython/.test(t)) out.push('MicroPython code');
  return out.length ? out.join(', ') : target;
}
