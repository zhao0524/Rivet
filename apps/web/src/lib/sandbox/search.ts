import type { ShowcaseCategory } from "../showcase/types";
import type { SandboxProduct } from "./types";

export type CategoryFilter = ShowcaseCategory | "all";

const tokens = (query: string) => query.toLowerCase().split(/[^a-z0-9.+-]+/).filter(Boolean);

function haystacks(product: SandboxProduct) {
  const partText = product.parts
    .map((p) => [p.name, p.group, p.sourcing?.sku, p.sourcing?.mpn, p.sourcing?.manufacturer, p.sourcing?.vendor].filter(Boolean).join(" "))
    .join(" ")
    .toLowerCase();
  const head = `${product.name} ${product.category}`.toLowerCase();
  return { head, rest: `${product.summary} ${partText}`.toLowerCase() };
}

/**
 * Every word must appear somewhere in the product: its name, category, summary, or any part's
 * name, group, SKU, MPN, manufacturer or vendor. Name matches rank first; ties keep catalogue order.
 */
export function searchProducts(products: readonly SandboxProduct[], query: string, category: CategoryFilter = "all"): SandboxProduct[] {
  const words = tokens(query);
  const scored: Array<{ product: SandboxProduct; score: number; order: number }> = [];
  products.forEach((product, order) => {
    if (category !== "all" && product.category !== category) return;
    const { head, rest } = haystacks(product);
    let score = 0;
    for (const w of words) {
      if (head.includes(w)) score += 2;
      else if (rest.includes(w)) score += 1;
      else return;
    }
    scored.push({ product, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.product);
}
