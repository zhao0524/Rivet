import { getSourcedCatalog, getSourcedRoverPlan } from '../../lib/fixtures';

/**
 * "See every part" visual: the saved example rover's real parts list, scrolling past slowly. Every
 * line is a part in that plan with the store and price its parts list records; nothing is invented.
 * Pure CSS motion (marketing.css), so it renders on the server and stops for reduced motion.
 */

/** Show the parts people recognise first: the brains, the eyes, then what makes it move. */
const ORDER = ['board', 'sensor', 'driver', 'chassis', 'motor', 'wheel', 'power', 'wiring', 'accessory'];
const TONE: Record<string, string> = { board: 'accent', sensor: 'pink', driver: 'accent', motor: 'orange', wheel: 'orange', power: 'ok' };

const STORES: Record<string, string> = { 'adafruit.com': 'Adafruit', 'sparkfun.com': 'SparkFun' };

function storeName(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return STORES[host] ?? host;
}

/** "Adafruit TB6612 1.2A DC/Stepper Motor Driver Breakout Board" → "TB6612 1.2A DC/Stepper Motor Driver". */
function shortName(model: string, maker: string): string {
  let name = model.split(' - ')[0]!.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  for (const prefix of [maker, 'Adafruit', 'SparkFun', 'Espressif']) {
    if (prefix && name.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) name = name.slice(prefix.length + 1);
  }
  return name.replace(/ Breakout Board$/, '').replace(/ for TT DC Gearbox Motor$/, '');
}

interface TickerLine {
  id: string;
  name: string;
  store: string;
  price: string;
  quantity: number;
  tone: string;
}

function parts(): { lines: TickerLine[]; total: string; count: number; title: string } {
  const plan = getSourcedRoverPlan();
  const catalog = new Map(getSourcedCatalog().map((c) => [c.catalog_id, c]));
  const lines = plan.bom.items
    .filter((item) => item.purchase_url && Number(item.unit_price_amount) > 0)
    .map((item) => {
      const kind = item.catalog_id.split('.')[0]!;
      const identity = catalog.get(item.catalog_id)?.identity;
      return {
        id: item.catalog_id,
        kind,
        name: shortName(identity?.model ?? item.catalog_id, identity?.manufacturer ?? ''),
        store: storeName(item.purchase_url!),
        price: `$${Number(item.unit_price_amount).toFixed(2)}`,
        quantity: item.quantity,
        tone: TONE[kind] ?? 'neutral',
      };
    })
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const count = plan.bom.items.reduce((n, item) => n + item.quantity, 0);
  return { lines, total: `$${plan.bom.known_subtotal_amount}`, count, title: plan.title };
}

const DATA = parts();

function Row({ line }: { line: TickerLine }) {
  return (
    <li className="mk-ticker__row">
      <span className={`mk-ticker__chip mk-ticker__chip--${line.tone}`} aria-hidden="true" />
      <span className="mk-ticker__name">{line.name}</span>
      <span className="mk-ticker__store">{line.store}</span>
      <span className="mk-ticker__price">
        {line.price}
        {line.quantity > 1 ? <small> × {line.quantity}</small> : null}
      </span>
    </li>
  );
}

export function PartsTicker() {
  return (
    <div className="mk-ticker" aria-hidden="true">
      <div className="mk-ticker__head">
        <b>Parts list</b>
        <span>{DATA.title}</span>
      </div>
      <div className="mk-ticker__window">
        <ul className="mk-ticker__list">
          {DATA.lines.map((line) => (
            <Row key={line.id} line={line} />
          ))}
          {/* The same lines again, so the loop has no seam. */}
          {DATA.lines.map((line) => (
            <Row key={`${line.id}-again`} line={line} />
          ))}
        </ul>
      </div>
      <div className="mk-ticker__foot">
        <span>{DATA.count} parts</span>
        <span>
          Total <b>{DATA.total}</b>
        </span>
      </div>
    </div>
  );
}
