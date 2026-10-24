import { useEffect, useRef, type CSSProperties } from "react";
import styles from "./BuildGuide.module.css";
import { KitItemBadge } from "./KitItemBadge";
import { isBlocking, LINK_STATUS_LABEL, usableUrl } from "./helpers";
import { availabilityLabel, componentById, formatDay, productFacts } from "./product";
import type { BuildPlan, CatalogComponent, VerificationFinding } from "./types";

export interface ProductCardProps {
  plan: BuildPlan;
  catalog: CatalogComponent[];
  /** The card describes one catalog part; every instance and its BOM row show the same card. */
  catalogId: string;
}

function Value({ value, testId }: { value: string | number | null | undefined; testId?: string }) {
  const known = value !== null && value !== undefined && String(value).trim() !== "";
  return (
    <span data-testid={testId} data-known={known ? "true" : "false"}>
      {known ? String(value) : "Unknown"}
    </span>
  );
}

function SourceLink({ label, url, testId }: { label: string; url: string | null | undefined; testId: string }) {
  const href = usableUrl(url);
  return (
    <li>
      {label}:{" "}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
          {href}
        </a>
      ) : (
        <span data-testid={testId} aria-disabled="true">
          Not available
        </span>
      )}
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function FindingItem({ finding }: { finding: VerificationFinding }) {
  const urls = finding.evidence_urls.map((u) => [u, usableUrl(u)] as const);
  return (
    <li
      className={styles.finding}
      data-testid={`inspector-finding-${finding.rule_id}`}
      data-result={finding.result}
      data-blocking={isBlocking(finding) ? "true" : "false"}
    >
      <strong>{finding.result}</strong> · {isBlocking(finding) ? "blocking" : finding.severity} · <code>{finding.rule_id}</code>
      <p>{finding.message}</p>
      {finding.affected_instance_ids.length > 0 && (
        <p className={styles.muted}>Concerns {finding.affected_instance_ids.join(", ")}</p>
      )}
      {urls.length > 0 ? (
        <ul className={styles.urls} aria-label={`Sources for ${finding.rule_id}`}>
          {urls.map(([raw, href]) => (
            <li key={raw}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {href}
                </a>
              ) : (
                raw
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>No source URL recorded.</p>
      )}
    </li>
  );
}

/**
 * One real-product card: identity, vendor link and when it was verified, price with its
 * currency and check date, availability as recorded, fit evidence (the findings that
 * concern this part, with their sources) and reference URLs. The same component and the
 * same facts serve a part picked in 3D, in the parts list or in the BOM.
 */
export function ProductCard({ plan, catalog, catalogId }: ProductCardProps) {
  const f = productFacts(plan, catalog, catalogId);
  const { entry, bomRow } = f;
  const check = plan.provenance.sourcing?.link_checks?.[catalogId];
  const open = f.findings.filter((x) => x.result !== "PASS");
  const passed = f.findings.filter((x) => x.result === "PASS");
  const vendor =
    f.vendorUrl && f.linkStatus === "verified_product" ? (
      <>
        <a href={f.vendorUrl} target="_blank" rel="noopener noreferrer">
          Product listing
        </a>{" "}
        <span className={styles.muted}>({hostOf(f.vendorUrl)})</span>
      </>
    ) : f.vendorUrl && f.linkStatus === "manufacturer_reference_only" ? (
      <>
        <a href={f.vendorUrl} target="_blank" rel="noopener noreferrer">
          Manufacturer reference
        </a>{" "}
        <span className={styles.muted}>(not a store listing)</span>
      </>
    ) : (
      "No vendor link"
    );

  return (
    <article
      aria-label={`Product card: ${entry?.identity.model ?? catalogId}`}
      data-testid="product-card"
      data-catalog-id={catalogId}
      className={`rivet-panel ${styles.card}`}
    >
      <div>
        <p className={styles.eyebrow}>{f.synthetic ? "Product card · synthetic data" : "Product card"}</p>
        <h2 className={styles.title} data-testid="inspector-title">
          {entry?.identity.model ?? catalogId}
        </h2>
        {entry && (
          <p className={styles.sub}>
            {entry.identity.manufacturer || "Unknown manufacturer"} · SKU {entry.identity.sku || "unknown"}
          </p>
        )}
      </div>

      {check && <section aria-label="Latest supplier check" data-testid="product-link-check" data-status={check.status}>
        <strong>Latest supplier check: {check.status}</strong>
        <p>Checked: {formatDay(check.checked_at) ?? "Not checked"}. Catalog verified: {formatDay(check.catalog_verified_at) ?? "Unknown"}.</p>
        <p>{check.detail}</p>
        {!check.fresh && <p role="note">Link evidence is older than 30 days or missing. Recheck before buying.</p>}
        {check.flags.length > 0 && <p role="note">Changes to review: {check.flags.join(", ").replace(/_/g, " ")}. Listed price and availability are historical catalog values.</p>}
      </section>}
      {f.unmodeledIds.length > 0 && (
        <p className={styles.note} role="note" data-testid="product-unmodeled">
          <KitItemBadge /> Real kit item in the BOM with no 3D model: it is not drawn in the 3D view, and the
          assembly steps below say where it is used.
        </p>
      )}
      {f.synthetic && (
        <p className={styles.note} role="note" data-testid="inspector-synthetic-notice">
          Synthetic / fixture data. Not verified hardware; do not build or buy from this record.
        </p>
      )}
      {!entry && (
        <p className={styles.alert} role="alert" data-testid="inspector-missing-catalog">
          Catalog entry <code>{catalogId}</code> was not found. Part data is unavailable.
        </p>
      )}

      {entry && (
        <dl className={styles.facts} aria-label="Product facts">
          <dt>Manufacturer</dt>
          <dd>
            <Value value={entry.identity.manufacturer} testId="inspector-manufacturer" />
          </dd>
          <dt>Model</dt>
          <dd>
            <Value value={entry.identity.model} testId="inspector-model" />
          </dd>
          <dt>SKU</dt>
          <dd>
            <Value value={entry.identity.sku} testId="inspector-sku" />
          </dd>
          <dt>Catalog ID</dt>
          <dd>
            <code data-testid="inspector-catalog-id">{entry.catalog_id}</code>
          </dd>
          <dt>Vendor link</dt>
          <dd data-testid="product-vendor-link" data-link-status={f.linkStatus ?? "none"}>
            {vendor}
          </dd>
          {bomRow && (
            <>
              <dt>Link status</dt>
              <dd data-testid="inspector-link-status" data-link-status={f.linkStatus ?? "not_available"}>
                {LINK_STATUS_LABEL[f.linkStatus ?? "not_available"]}
              </dd>
            </>
          )}
          <dt>Link verified</dt>
          <dd data-testid="product-link-verified" data-known={f.linkVerifiedAt ? "true" : "false"}>
            {formatDay(f.linkVerifiedAt) ?? "Not recorded"}
          </dd>
          <dt>Unit price</dt>
          <dd>
            <span data-testid="inspector-price">{f.price ?? "Unknown"}</span>
            {f.priceCheckedAt && <span data-testid="product-price-checked"> · checked {formatDay(f.priceCheckedAt)}</span>}
            {f.price && !f.inBomSubtotal && (
              <span className={styles.muted} data-testid="product-price-not-in-subtotal">
                {" "}
                · not in the BOM subtotal
              </span>
            )}
          </dd>
          <dt>Availability</dt>
          <dd data-testid="inspector-availability" data-availability={f.availability ?? "unknown"}>
            {availabilityLabel(f.availability)}{" "}
            <span className={styles.muted}>
              (as recorded in {plan.provenance.catalog_version}; not a live stock check)
            </span>
          </dd>
          <dt>In this build</dt>
          <dd data-testid="product-instances">
            {f.instanceIds.length} × {f.instanceIds.join(", ") || "none"}
          </dd>
        </dl>
      )}

      <section aria-label="Fit evidence" className={styles.section}>
        <h3 className={styles.sectionTitle}>Fit evidence</h3>
        {f.findings.length === 0 ? (
          <p className={styles.muted} data-testid="inspector-findings-empty">
            No findings reference this part.
          </p>
        ) : (
          <>
            {open.length > 0 ? (
              <ul className={styles.list} data-testid="inspector-findings">
                {open.map((x, i) => (
                  <FindingItem key={`${x.rule_id}-${i}`} finding={x} />
                ))}
              </ul>
            ) : (
              <p className={styles.ok} data-testid="product-no-open-findings">
                No FAIL, UNKNOWN or WARN finding concerns this part.
              </p>
            )}
            {passed.length > 0 && (
              <details className={styles.details} data-testid="product-passed-checks">
                <summary>
                  {passed.length} passed check{passed.length === 1 ? "" : "s"}
                </summary>
                <ul className={styles.list}>
                  {passed.map((x, i) => (
                    <FindingItem key={`${x.rule_id}-${i}`} finding={x} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      {entry && (
        <section aria-label="Sources" className={styles.section}>
          <h3 className={styles.sectionTitle}>Sources</h3>
          <ul className={styles.list}>
            <SourceLink
              label="Manufacturer reference"
              url={entry.sourcing.manufacturer_reference_url}
              testId="inspector-link-manufacturer"
            />
            <SourceLink label="Datasheet" url={entry.sourcing.datasheet_url} testId="inspector-link-datasheet" />
            <SourceLink label="Purchase" url={check?.status === "broken" ? null : entry.sourcing.purchase_url} testId="inspector-link-purchase" />
          </ul>
        </section>
      )}

      <section aria-label="Assembly steps for this part" className={styles.section}>
        <h3 className={styles.sectionTitle}>Assembly steps</h3>
        {f.steps.length ? (
          <ol className={styles.list} data-testid="product-steps">
            {f.steps.map((s) => (
              <li key={s.step} data-testid={`product-step-${s.step}`}>
                Step {s.step} · {s.title}
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.alert} role="alert" data-testid="product-steps-empty">
            No assembly step references this part.
          </p>
        )}
      </section>

      {entry && entry.evidence.notes.length > 0 && (
        <section aria-label="Catalog notes" className={styles.section}>
          <h3 className={styles.sectionTitle}>Catalog notes</h3>
          <ul className={styles.urls} data-testid="inspector-evidence-notes">
            {entry.evidence.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export interface SelectedProductCardProps {
  plan: BuildPlan;
  catalog: CatalogComponent[];
  selectedInstanceId: string | null;
  style?: CSSProperties;
}

/** The product card for the selected part (e.g. picked from a BOM row), scrolled into view. */
export function SelectedProductCard({ plan, catalog, selectedInstanceId, style }: SelectedProductCardProps) {
  const ref = useRef<HTMLElement>(null);
  const component = componentById(plan, selectedInstanceId);
  const shownId = component?.instance_id ?? null;

  useEffect(() => {
    if (shownId) ref.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [shownId]);

  if (!component) return null;
  return (
    <section
      ref={ref}
      aria-label="Selected part"
      data-testid="inspector-product-section"
      data-instance-id={component.instance_id}
      style={style}
    >
      <p className={styles.sub} style={{ margin: "0 0 8px" }}>
        Selected <code>{component.instance_id}</code>
      </p>
      <ProductCard plan={plan} catalog={catalog} catalogId={component.catalog_id} />
    </section>
  );
}
