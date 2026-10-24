import { useId } from "react";
import styles from "./Offers.module.css";
import { TIER_LABEL } from "../../../lib/offers/format";
import { OFFER_SORTS, VENDOR_TIERS, type OfferListParams, type OfferSort, type VendorTier } from "../../../lib/offers/types";

export const SORT_LABEL: Record<OfferSort, string> = {
  reliability: "Reliability",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  rating: "Rating",
  availability: "Availability",
  newest: "Most recently checked",
};

const MIN_RATING_CHOICES = ["", "3", "4", "4.5"] as const;

export interface OffersToolbarProps {
  params: OfferListParams;
  onChange: (next: OfferListParams) => void;
  /** Currencies present in the returned set; the price filter only compares within one. */
  currencies: readonly string[];
  /** Vendor tiers present in the returned set; others are not offered as filters. */
  tiers?: readonly VendorTier[];
}

function isSort(value: string): value is OfferSort {
  return (OFFER_SORTS as readonly string[]).includes(value);
}

/** Sort and filter controls; the panel applies them locally over the returned set. */
export function OffersToolbar({ params, onChange, currencies, tiers = VENDOR_TIERS }: OffersToolbarProps) {
  const ids = { sort: useId(), stock: useId(), rating: useId(), price: useId(), currency: useId() };
  const selectedTiers = params.vendor_tier ?? [];
  const hasFilters =
    selectedTiers.length > 0 ||
    params.in_stock === true ||
    params.min_rating !== undefined ||
    params.max_price !== undefined ||
    params.currency !== undefined;

  const toggleTier = (tier: VendorTier) => {
    const next = selectedTiers.includes(tier) ? selectedTiers.filter((t) => t !== tier) : [...selectedTiers, tier];
    onChange({ ...params, vendor_tier: next.length > 0 ? next : undefined });
  };

  return (
    <form
      className={styles.toolbar}
      aria-label="Sort and filter offers"
      data-testid="offers-toolbar"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className={styles.field} htmlFor={ids.sort}>
        <span>Sort by</span>
        <select
          id={ids.sort}
          className="rv-select"
          data-testid="offers-sort"
          value={params.sort ?? "reliability"}
          onChange={(e) => isSort(e.target.value) && onChange({ ...params, sort: e.target.value })}
        >
          {OFFER_SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className={styles.field} style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ padding: 0, color: "var(--rv-text-muted)", fontSize: 11 }}>Vendor tier</legend>
        <div className={styles.tiers} data-testid="offers-tier-filter">
          {tiers.map((tier) => (
            <button
              key={tier}
              type="button"
              className={styles.tierChip}
              aria-pressed={selectedTiers.includes(tier)}
              data-testid={`offers-tier-${tier}`}
              onClick={() => toggleTier(tier)}
            >
              {TIER_LABEL[tier]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className={styles.field} htmlFor={ids.stock} style={{ gridAutoFlow: "column", alignItems: "center" }}>
        <input
          id={ids.stock}
          type="checkbox"
          data-testid="offers-in-stock"
          checked={params.in_stock === true}
          onChange={(e) => onChange({ ...params, in_stock: e.target.checked ? true : undefined })}
        />
        <span>In stock only</span>
      </label>

      <label className={styles.field} htmlFor={ids.rating}>
        <span>Min. rating</span>
        <select
          id={ids.rating}
          className="rv-select"
          data-testid="offers-min-rating"
          value={params.min_rating === undefined ? "" : String(params.min_rating)}
          onChange={(e) => onChange({ ...params, min_rating: e.target.value === "" ? undefined : Number(e.target.value) })}
        >
          {MIN_RATING_CHOICES.map((c) => (
            <option key={c} value={c}>
              {c === "" ? "Any (unrated included)" : `${c}+ (unrated excluded)`}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field} htmlFor={ids.price}>
        <span>Max. price</span>
        <input
          id={ids.price}
          className="rv-input"
          data-testid="offers-max-price"
          inputMode="decimal"
          placeholder="e.g. 5.00"
          value={params.max_price ?? ""}
          onChange={(e) => onChange({ ...params, max_price: e.target.value.trim() === "" ? undefined : e.target.value.trim() })}
          style={{ width: 90 }}
        />
      </label>

      <label className={styles.field} htmlFor={ids.currency}>
        <span>Currency</span>
        <select
          id={ids.currency}
          className="rv-select"
          data-testid="offers-currency"
          value={params.currency ?? ""}
          onChange={(e) => onChange({ ...params, currency: e.target.value === "" ? undefined : e.target.value })}
        >
          <option value="">All (no conversion)</option>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      {hasFilters && (
        <button
          type="button"
          className="rv-btn rv-btn--ghost rv-btn--small"
          data-testid="offers-clear-filters"
          onClick={() => onChange({ sort: params.sort })}
        >
          Clear filters
        </button>
      )}
    </form>
  );
}
