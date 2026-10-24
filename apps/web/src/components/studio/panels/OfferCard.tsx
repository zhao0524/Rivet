import styles from "./Offers.module.css";
import { ReliabilityBadge } from "./ReliabilityBadge";
import { usableUrl } from "./helpers";
import {
  AVAILABILITY_LABEL,
  MATCH_KIND_LABEL,
  formatFreshness,
  formatPack,
  formatPrice,
  formatRating,
  statusLabel,
  TIER_LABEL,
} from "../../../lib/offers/format";
import type { Offer } from "../../../lib/offers/types";

export type OfferSection = "offers" | "possible_matches" | "alternatives";

export interface OfferCardProps {
  offer: Offer;
  section: OfferSection;
  /** Freshness is judged against this clock; tests inject it. */
  now?: Date;
}

/**
 * One vendor card. Every field is shown as the fetched page stated it: a missing price
 * says "Price not stated", a missing rating says so, and `stale` / `demoted` offers keep
 * their label and reason instead of disappearing.
 */
export function OfferCard({ offer, section, now }: OfferCardProps) {
  const href = usableUrl(offer.url);
  const pack = formatPack(offer);
  const status = statusLabel(offer, now);
  return (
    <li
      className={styles.card}
      data-testid={`offer-card-${offer.offer_id}`}
      data-offer-id={offer.offer_id}
      data-section={section}
      data-status={offer.status}
      data-vendor-tier={offer.vendor.tier}
      data-currency={offer.currency ?? "none"}
    >
      <div className={styles.cardHead}>
        <span>
          <span className={styles.vendor} data-testid="offer-vendor">
            {offer.vendor.name}
          </span>{" "}
          <span className={styles.meta} style={{ display: "inline" }} data-testid="offer-tier">
            · {TIER_LABEL[offer.vendor.tier]}
          </span>
        </span>
        <span className={styles.price} data-testid="offer-price" data-known={offer.price_amount === null ? "false" : "true"}>
          {formatPrice(offer.price_amount, offer.currency)}
        </span>
      </div>
      {pack && (
        <div className={styles.meta} data-testid="offer-pack">
          {pack}
        </div>
      )}
      <div className={styles.meta}>
        <span data-testid="offer-availability" data-availability={offer.availability}>
          {AVAILABILITY_LABEL[offer.availability]}
        </span>
        <span data-testid="offer-rating" data-known={offer.rating ? "true" : "false"}>
          {formatRating(offer.rating)}
        </span>
        {offer.min_order_qty !== null && offer.min_order_qty > 1 && <span>Min. order {offer.min_order_qty}</span>}
        {offer.shipping && (
          <span data-testid="offer-shipping">
            Shipping {offer.shipping.amount === null ? "not stated" : `${offer.shipping.amount} ${offer.shipping.currency}`}
            {offer.shipping.note ? ` (${offer.shipping.note})` : ""}
          </span>
        )}
      </div>
      <div className={styles.meta}>
        <ReliabilityBadge reliability={offer.reliability} offerId={offer.offer_id} />
        <span data-testid="offer-freshness">{formatFreshness(offer.fetched_at, now)}</span>
        <span data-testid="offer-match" data-match-kind={offer.match.kind}>
          {MATCH_KIND_LABEL[offer.match.kind]}
        </span>
      </div>
      {status && (
        <p className={styles.statusLabel} role="note" data-testid="offer-status-label">
          {status}
        </p>
      )}
      {offer.match.evidence_quote && (
        <p className={styles.evidence} data-testid="offer-evidence">
          Page quoted: &ldquo;{offer.match.evidence_quote}&rdquo;
        </p>
      )}
      <div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="offer-open-vendor"
            data-link-status={offer.link_status}
          >
            Open vendor site
          </a>
        ) : (
          <span aria-disabled="true" data-testid="offer-open-vendor" data-link-status="invalid_url">
            Link withheld: not an https URL
          </span>
        )}{" "}
        <span className={styles.meta} style={{ display: "inline" }}>
          ({offer.vendor.domain}
          {offer.link_status !== "pass" ? `, link check ${offer.link_status}` : ""})
        </span>
      </div>
    </li>
  );
}
