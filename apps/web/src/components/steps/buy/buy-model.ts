import type { BuyLine } from '../../../lib/flow/derive';

/** Vendor label used for lines without a verified product listing. */
export const NO_VENDOR = 'No verified vendor';

export interface VendorGroup {
  vendor: string;
  lines: BuyLine[];
  /** Sum of known prices × quantity for lines not owned. */
  subtotal: number;
  /** Lines (not owned) whose price is unknown; never counted as zero. */
  unknownPriceCount: number;
  /** True when every line in the group is owned. */
  allOwned: boolean;
}

export interface BuyTotals {
  total: number;
  unknownPriceCount: number;
  /** Lines still to buy (not owned). */
  toBuy: number;
  owned: number;
}

export function isOwned(line: BuyLine, ownedIds: readonly string[]): boolean {
  return ownedIds.includes(line.catalogId);
}

/** Total of known prices for lines not owned. Unknown prices are counted, not zeroed. */
export function buyTotals(lines: readonly BuyLine[], ownedIds: readonly string[]): BuyTotals {
  let total = 0;
  let unknownPriceCount = 0;
  let toBuy = 0;
  let owned = 0;
  for (const line of lines) {
    if (isOwned(line, ownedIds)) {
      owned += 1;
      continue;
    }
    toBuy += 1;
    if (line.unitPrice === null) unknownPriceCount += 1;
    else total += line.unitPrice * line.quantity;
  }
  return { total, unknownPriceCount, toBuy, owned };
}

/** Lines grouped by vendor; verified vendors first, "No verified vendor" last. */
export function groupByVendor(lines: readonly BuyLine[], ownedIds: readonly string[]): VendorGroup[] {
  const map = new Map<string, BuyLine[]>();
  for (const line of lines) {
    const key = line.url ? line.vendor : NO_VENDOR;
    map.set(key, [...(map.get(key) ?? []), line]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a === NO_VENDOR ? 1 : b === NO_VENDOR ? -1 : a.localeCompare(b)))
    .map(([vendor, group]) => {
      const t = buyTotals(group, ownedIds);
      return {
        vendor,
        lines: group,
        subtotal: t.total,
        unknownPriceCount: t.unknownPriceCount,
        allOwned: t.toBuy === 0,
      };
    });
}

/** Plain-language count: "2 parts have no known price" / "1 part has no known price". */
export function unknownPriceNote(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? '1 part has no known price' : `${count} parts have no known price`;
}

/** Region label for the plan currency. Only currencies with one obvious store region get a name. */
export function regionForCurrency(currency: string): string | null {
  const map: Record<string, string> = { USD: 'United States', GBP: 'United Kingdom', EUR: 'Euro area', CAD: 'Canada', AUD: 'Australia', JPY: 'Japan' };
  return map[currency.toUpperCase()] ?? null;
}

export function stockLabel(state: BuyLine['inStock']): string {
  if (state === 'in_stock') return 'In stock';
  if (state === 'out_of_stock') return 'Out of stock';
  return 'Stock unknown';
}
