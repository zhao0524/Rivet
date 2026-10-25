/** Display strings for the showcase catalogue. Unknown stays "not stated"; nothing is invented. */
import { PRICE_NOT_STATED } from "../offers/format";
import type { ShowcaseCategory, ShowcasePart, ShowcaseTotals } from "./types";

export const CATEGORY_LABEL: Record<ShowcaseCategory, string> = {
  rover: "Rover",
  robot: "Robot",
  drone: "Drone",
  wearable: "Wearable",
  iot: "IoT",
  audio: "Audio",
  display: "Display",
  tool: "Tool",
  other: "Other",
};

export const SHOWCASE_HONESTY = "Prices and stock are as of the check time and may have changed. Rivet does not sell parts.";
export const LIVE_SEARCH_NEEDS_API = "live search needs the API";

/** "8 parts · all sourced" or "22 of 26 sourced"; a product with no parts says so. */
export function sourcedLabel(entry: { parts_total: number; parts_verified: number }): string {
  if (entry.parts_total === 0) return "no parts listed";
  if (entry.parts_verified >= entry.parts_total) return `${entry.parts_total} part${entry.parts_total === 1 ? "" : "s"} · all sourced`;
  return `${entry.parts_verified} of ${entry.parts_total} sourced`;
}

/** "2026-10-24" from a UTC timestamp; "unknown date" when it cannot be parsed. */
export function formatAsOfDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "unknown date" : new Date(t).toISOString().slice(0, 10);
}

/** "24.95 USD as of 2026-10-24" or `PRICE_NOT_STATED`. */
export function formatPartPrice(part: Pick<ShowcasePart, "price_amount" | "currency" | "fetched_at">): string {
  if (part.price_amount === null) return PRICE_NOT_STATED;
  return `${part.price_amount}${part.currency ? ` ${part.currency}` : ""} as of ${formatAsOfDate(part.fetched_at)}`;
}

/** The parts total when every sourced part has a price in one currency; otherwise why there is none. */
export function formatTotals(totals: ShowcaseTotals, parts: readonly Pick<ShowcasePart, "price_amount">[]): string {
  if (totals.price_total_amount !== null && totals.currency) return `Parts total ${totals.price_total_amount} ${totals.currency}`;
  const unpriced = parts.filter((p) => p.price_amount === null).length;
  return `total unavailable: ${unpriced} part${unpriced === 1 ? "" : "s"} unpriced`;
}
