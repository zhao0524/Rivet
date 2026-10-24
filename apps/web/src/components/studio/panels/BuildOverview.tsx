import { computeStepCoverage } from "../../three/assembly/coverage";
import styles from "./BuildGuide.module.css";
import { KitItemIcon } from "./KitItemBadge";
import { isSyntheticPlan, LINK_STATUS_LABEL, PLAN_STATUS_LABEL } from "./helpers";
import { formatDay, partName, summarizeBuild } from "./product";
import type { BuildPlan, CatalogComponent } from "./types";

export interface BuildOverviewProps {
  plan: BuildPlan;
  catalog: CatalogComponent[];
  /** Opens a part's product card (buy-list rows select the line's first instance). */
  onSelectInstance?: (instanceId: string) => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the inspector shows when no part is selected: the build as one story. Part
 * count, price (known subtotal versus lines with no price), verified vendor links,
 * blocking findings, assembly coverage and the buy list. Every number is read from
 * the plan; prices are never summed or guessed here.
 */
export function BuildOverview({ plan, catalog, onSelectInstance }: BuildOverviewProps) {
  const s = summarizeBuild(plan, catalog);
  const coverage = computeStepCoverage(plan);
  const currency = plan.bom.currency;
  const notInBuyList = plan.bom.items.filter((i) => !s.verifiedLinkLines.includes(i));

  return (
    <section aria-label="Build overview" data-testid="build-overview" className={styles.card}>
      <div>
        <p className={styles.eyebrow}>Build overview</p>
        <h2 className={styles.title}>{plan.title}</h2>
        <p className={styles.sub}>
          Select a part in the 3D view, the parts list or the BOM to open its product card.
        </p>
      </div>

      {isSyntheticPlan(plan) && (
        <p className={styles.note} role="note" data-testid="overview-synthetic-notice">
          {plan.provenance.generation_mode === "fixture" || plan.provenance.generation_mode === "manual_template"
            ? "Saved or synthetic data, not a fresh live generation."
            : "Not a live generation."}{" "}
          Check every part before you buy or build.
        </p>
      )}

      <dl className={styles.stats}>
        <dt>Status</dt>
        <dd data-testid="overview-status" data-status={plan.status}>
          {PLAN_STATUS_LABEL[plan.status]}
        </dd>

        <dt>Parts</dt>
        <dd data-testid="overview-part-count" data-placed={s.placedCount} data-lines={s.lineCount}>
          {plural(s.placedCount, "placed part")} · {plural(s.lineCount, "BOM line")} ({plural(s.unitCount, "unit")})
          {s.unmodeledCount > 0 && (
            <span className={styles.muted} data-testid="overview-unmodeled-count">
              {" "}
              · <KitItemIcon size={11} /> {plural(s.unmodeledCount, "unmodeled kit item")} (in the BOM and steps, not
              drawn in 3D)
            </span>
          )}
        </dd>

        <dt>Price</dt>
        <dd data-testid="overview-price" data-complete={s.complete ? "true" : "false"}>
          {s.complete ? (
            <>Total: {s.knownSubtotal} (every line priced)</>
          ) : (
            <>
              Known subtotal: {s.knownSubtotal ?? "Unknown"} ·{" "}
              <span data-testid="overview-unpriced" data-count={s.unpricedLines.length}>
                {s.unpricedLines.length} of {plural(s.lineCount, "line")} with no price
              </span>
              {currency ? <span className={styles.muted}> · total unavailable</span> : null}
            </>
          )}
        </dd>

        <dt>Vendor links</dt>
        <dd data-testid="overview-verified-links" data-count={s.verifiedLinkLines.length}>
          {s.verifiedLinkLines.length} of {plural(s.lineCount, "line")} with a verified product link
          {s.referenceOnlyLines.length > 0 && (
            <span className={styles.muted}> · {s.referenceOnlyLines.length} manufacturer reference only</span>
          )}
          {s.noLinkLines.length > 0 && <span className={styles.muted}> · {s.noLinkLines.length} with no link</span>}
        </dd>

        <dt>Blocking</dt>
        <dd data-testid="overview-blocking" data-count={s.blocking.length}>
          {s.blocking.length === 0 ? "No blocking findings" : `${plural(s.blocking.length, "blocking finding")} unresolved`}
        </dd>

        <dt>Assembly</dt>
        <dd data-testid="overview-coverage" data-complete={coverage.complete ? "true" : "false"}>
          {coverage.complete
            ? `${plural(plan.assembly_steps.length, "step")} covering all ${plural(coverage.total, "BOM line")}`
            : `${coverage.uncovered.length} of ${plural(coverage.total, "BOM line")} not in any assembly step`}
        </dd>
      </dl>

      <section aria-label="Buy list" className={styles.section}>
        <h3 className={styles.sectionTitle}>Buy list ({s.buyList.length})</h3>
        {s.buyList.length === 0 ? (
          <p className={styles.muted} data-testid="overview-buy-list-empty">
            No BOM line has a verified vendor link in this revision.
          </p>
        ) : (
          <ol className={styles.list} data-testid="overview-buy-list">
            {s.buyList.map((line) => (
              <li key={line.catalogId} className={styles.buyRow} data-testid={`overview-buy-${line.catalogId}`}>
                {line.firstInstanceId && onSelectInstance ? (
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => onSelectInstance(line.firstInstanceId as string)}
                    data-testid={`overview-buy-select-${line.catalogId}`}
                  >
                    {line.name}
                  </button>
                ) : (
                  <span>{line.name}</span>
                )}
                <a href={line.url} target="_blank" rel="noopener noreferrer" data-testid={`overview-buy-link-${line.catalogId}`}>
                  Product listing
                </a>
                <span className={styles.buyMeta}>
                  ×{line.quantity} · {line.unitPrice ? `${line.unitPrice} each` : "price unknown"} · link verified{" "}
                  {formatDay(line.linkVerifiedAt) ?? "date not recorded"}
                </span>
              </li>
            ))}
          </ol>
        )}
        {notInBuyList.length > 0 && (
          <p className={styles.sub} data-testid="overview-not-in-buy-list">
            Not in the buy list (no verified product link):{" "}
            {notInBuyList.map((i) => `${partName(catalog, i.catalog_id)} (${LINK_STATUS_LABEL[i.link_status]})`).join("; ")}.
          </p>
        )}
      </section>
    </section>
  );
}
