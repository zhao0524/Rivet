import { useId } from "react";
import styles from "./Offers.module.css";
import { describeFactor, reliabilityLevel, RELIABILITY_LEVEL_LABEL } from "../../../lib/offers/format";
import type { Reliability } from "../../../lib/offers/types";

export interface ReliabilityBadgeProps {
  reliability: Reliability;
  /** Used in test ids so one card's badge can be addressed. */
  offerId: string;
}

/**
 * Score badge (high / medium / low) whose hover or keyboard focus reveals the factors
 * the engine returned, so the number is never a black box.
 */
export function ReliabilityBadge({ reliability, offerId }: ReliabilityBadgeProps) {
  const tipId = useId();
  const level = reliabilityLevel(reliability.score);
  const factors = reliability.factors;
  return (
    <div className={styles.badgeWrap}>
      <span
        className={styles.badge}
        tabIndex={0}
        role="img"
        aria-label={`${RELIABILITY_LEVEL_LABEL[level]}, score ${reliability.score}`}
        aria-describedby={tipId}
        data-testid={`offer-reliability-${offerId}`}
        data-level={level}
        data-score={reliability.score}
      >
        {RELIABILITY_LEVEL_LABEL[level]} · {reliability.score}
      </span>
      <div id={tipId} role="tooltip" className={styles.tooltip} data-testid={`offer-reliability-tooltip-${offerId}`}>
        <strong>Reliability factors</strong>
        {factors.length === 0 ? (
          <div>No factors were returned for this offer.</div>
        ) : (
          <ul>
            {factors.map((f) => (
              <li key={f.key}>{describeFactor(f)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
