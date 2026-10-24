import styles from "./Offers.module.css";
import type { OffersState } from "./OffersPanel";
import { usableUrl } from "./helpers";
import { AVAILABILITY_LABEL, formatPrice, NOT_FOUND_MESSAGE, REFUSED_MESSAGE } from "../../../lib/offers/format";
import { sortOffers } from "../../../lib/offers/sort";

export const WHERE_TO_BUY_MAX_ROWS = 3;

export interface WhereToBuyProps {
  catalogId: string;
  state: OffersState;
}

/**
 * Compact per-BOM-row summary of the top offers (by reliability). Links keep the same
 * `noopener noreferrer` rule as the catalog purchase link; stub and synthetic sets are
 * labelled test-only rather than shown as live prices.
 */
export function WhereToBuy({ catalogId, state }: WhereToBuyProps) {
  const testId = `bom-offers-${catalogId}`;
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className={styles.whereToBuyHint} role="status" data-testid={testId} data-state="loading">
        Checking vendors...
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className={styles.whereToBuyHint} role="alert" data-testid={testId} data-state="error">
        Offers unavailable ({state.error.code}).
      </p>
    );
  }
  if (state.status === "refused") {
    return (
      <p className={styles.whereToBuyHint} role="note" data-testid={testId} data-state="refused">
        {REFUSED_MESSAGE}
      </p>
    );
  }
  const { offerSet } = state;
  const top = sortOffers(offerSet.offers, "reliability").slice(0, WHERE_TO_BUY_MAX_ROWS);
  const testOnly = offerSet.synthetic || offerSet.provider_mode === "stub";
  if (top.length === 0) {
    return (
      <p className={styles.whereToBuyHint} data-testid={testId} data-state="not_found">
        {NOT_FOUND_MESSAGE}
      </p>
    );
  }
  return (
    <div data-testid={testId} data-state="ready" data-synthetic={offerSet.synthetic ? "true" : "false"}>
      <ul className={styles.whereToBuy} aria-label={`Where to buy ${catalogId}`}>
        {top.map((o) => {
          const href = usableUrl(o.url);
          return (
            <li key={o.offer_id} data-testid={`bom-offer-${o.offer_id}`} data-status={o.status}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {o.vendor.name}
                </a>
              ) : (
                o.vendor.name
              )}
              {": "}
              {formatPrice(o.price_amount, o.currency)} · {AVAILABILITY_LABEL[o.availability]}
              {o.status !== "ok" ? ` · ${o.status}` : ""}
            </li>
          );
        })}
      </ul>
      <p className={styles.whereToBuyHint}>
        {testOnly ? "Test-only or stub data, not a live lookup. " : ""}
        {offerSet.offers.length > top.length ? `${offerSet.offers.length - top.length} more in the part's Offers panel. ` : ""}
        Prices as of the check time; Rivet does not sell parts.
      </p>
    </div>
  );
}
