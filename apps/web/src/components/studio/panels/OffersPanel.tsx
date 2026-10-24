import { useMemo, useState } from "react";
import styles from "./Offers.module.css";
import { OfferCard, type OfferSection } from "./OfferCard";
import { OffersToolbar } from "./OffersToolbar";
import { usableUrl } from "./helpers";
import {
  EMPTY_AFTER_FILTER_MESSAGE,
  HONESTY_FOOTER,
  NOT_FOUND_MESSAGE,
  NOT_LIVE_LABEL,
  REFUSED_MESSAGE,
  SYNTHETIC_LABEL,
  formatFreshness,
} from "../../../lib/offers/format";
import { applyOfferParams } from "../../../lib/offers/sort";
import type { LedgerEntry, Offer, OfferListParams, OfferSet, VendorTier } from "../../../lib/offers/types";

export interface OffersErrorInfo {
  code: string;
  message: string;
  hint?: string;
  retryable?: boolean;
}

/** What the data layer produced for one part. The panel is presentational and renders each case. */
export type OffersState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; offerSet: OfferSet }
  | { status: "refused"; offerSet: OfferSet | null; message: string }
  | { status: "error"; error: OffersErrorInfo };

export interface OffersPanelProps {
  state: OffersState;
  /** True when the data source is the offline fixture source, so even a `recorded` set is labelled not live. */
  savedExample?: boolean;
  /** Freshness clock; tests inject it. */
  now?: Date;
  onRetry?: () => void;
  /** Initial sort/filter; the user can change them in the toolbar. */
  initialParams?: OfferListParams;
}

function OfferList({ offers, section, now }: { offers: readonly Offer[]; section: OfferSection; now?: Date }) {
  return (
    <ul className={styles.cards} data-testid={`offers-list-${section}`}>
      {offers.map((o) => (
        <OfferCard key={o.offer_id} offer={o} section={section} now={now} />
      ))}
    </ul>
  );
}

function Ledger({ entries }: { entries: readonly LedgerEntry[] }) {
  return (
    <details className={styles.ledger} data-testid="offers-ledger">
      <summary>
        Sources checked ({entries.length}): {entries.filter((e) => e.status === "offer").length} gave an offer
      </summary>
      {entries.length === 0 ? (
        <p className={styles.sectionHint}>No source was consulted.</p>
      ) : (
        <table className={styles.ledgerTable}>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Reason</th>
              <th scope="col">Checked</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const href = usableUrl(e.url);
              return (
                <tr key={`${e.source}-${i}`} data-testid={`offers-ledger-${e.status}`}>
                  <td>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {e.source}
                      </a>
                    ) : (
                      e.source
                    )}
                  </td>
                  <td>
                    <code>{e.status}</code>
                  </td>
                  <td>{e.reason || "no reason given"}</td>
                  <td>{e.checked_at ?? "not checked"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </details>
  );
}

function Footer() {
  return (
    <p className={styles.footer} data-testid="offers-honesty-footer">
      {HONESTY_FOOTER} Open the vendor site to check the current price and stock yourself.
    </p>
  );
}

function ReadySet({
  offerSet,
  savedExample,
  now,
  initialParams,
}: {
  offerSet: OfferSet;
  savedExample: boolean;
  now?: Date;
  initialParams?: OfferListParams;
}) {
  const [params, setParams] = useState<OfferListParams>(initialParams ?? { sort: "reliability" });
  const shown = useMemo(() => applyOfferParams(offerSet, params), [offerSet, params]);
  const currencies = useMemo(
    () => [...new Set(offerSet.offers.map((o) => o.currency).filter((c): c is string => c !== null))].sort(),
    [offerSet.offers],
  );
  const tiers = useMemo(() => [...new Set(offerSet.offers.map((o) => o.vendor.tier))] as VendorTier[], [offerSet.offers]);
  const notLive = savedExample || offerSet.provider_mode === "stub";
  const allStale = offerSet.offers.length > 0 && offerSet.offers.every((o) => o.status === "stale");
  const notFound = offerSet.outcome === "not_found" || offerSet.outcome === "refused";
  const partial = offerSet.outcome === "partial";

  return (
    <>
      {(notLive || offerSet.synthetic) && (
        <p className={styles.banner} role="status" data-testid="offers-banner" data-synthetic={offerSet.synthetic ? "true" : "false"}>
          {offerSet.synthetic ? `${SYNTHETIC_LABEL}: vendors on test hosts were never fetched. ` : ""}
          {notLive ? `${NOT_LIVE_LABEL}: ${savedExample ? "saved example from checked-in fixtures" : "stub provider answered"}. ` : ""}
          Nothing here is a current price.
        </p>
      )}
      {partial && (
        <p className={styles.notice} role="status" data-testid="offers-partial-notice">
          Partial result: some sources could not be checked. See &ldquo;Sources checked&rdquo; below.
        </p>
      )}
      {allStale && (
        <p className={styles.banner} role="status" data-testid="offers-stale-warning">
          Every offer here was checked more than 30 days ago. Treat prices and stock as historical.
        </p>
      )}
      {offerSet.notices.map((n) => (
        <p key={n} className={styles.notice} role="note" data-testid="offers-notice">
          {n}
        </p>
      ))}

      <section aria-label="Ranked offers">
        <h3 className={styles.sectionTitle}>
          Offers ({shown.offers.length}
          {shown.offers.length !== offerSet.offers.length ? ` of ${offerSet.offers.length}` : ""})
        </h3>
        {offerSet.offers.length > 0 && <OffersToolbar params={params} onChange={setParams} currencies={currencies} tiers={tiers} />}
        {notFound && offerSet.offers.length === 0 ? (
          <p className={styles.state} data-testid="offers-not-found">
            {offerSet.outcome === "refused" ? REFUSED_MESSAGE : NOT_FOUND_MESSAGE}
          </p>
        ) : offerSet.offers.length === 0 ? (
          <p className={styles.state} data-testid="offers-empty">
            The provider returned no ranked offer for this query. {NOT_FOUND_MESSAGE}
          </p>
        ) : shown.offers.length === 0 ? (
          <p className={styles.state} data-testid="offers-empty-after-filter">
            {EMPTY_AFTER_FILTER_MESSAGE}
          </p>
        ) : (
          <OfferList offers={shown.offers} section="offers" now={now} />
        )}
      </section>

      {offerSet.possible_matches.length > 0 && (
        <section aria-label="Possible matches" data-testid="offers-possible-matches">
          <h3 className={styles.sectionTitle}>Possible matches ({offerSet.possible_matches.length})</h3>
          <p className={styles.sectionHint}>
            Listings that resemble this part but did not quote its SKU or MPN. They are not verified offers and are
            never ranked with them.
          </p>
          <OfferList offers={offerSet.possible_matches} section="possible_matches" now={now} />
        </section>
      )}

      {offerSet.alternatives.length > 0 && (
        <section aria-label="Alternatives" data-testid="offers-alternatives">
          <h3 className={styles.sectionTitle}>Alternatives ({offerSet.alternatives.length})</h3>
          <p className={styles.sectionHint}>Offers for a different, substitute part, each with its own identifiers.</p>
          <OfferList offers={offerSet.alternatives} section="alternatives" now={now} />
        </section>
      )}

      <Ledger entries={offerSet.ledger} />
      <p className={styles.footer} data-testid="offers-generated-at">
        Query <code>{offerSet.query.normalized_key}</code> · provider {offerSet.provider_mode} · set{" "}
        {formatFreshness(offerSet.generated_at, now).replace(/^checked/, "generated")}
      </p>
      <Footer />
    </>
  );
}

/**
 * Where to buy the selected part. Vendor cards from a validated `OfferSet`, with local
 * sort and filters, and explicit loading / not-found / refused / stale / partial / error
 * states. Never shows a stub or synthetic set as live and never shows a link that was
 * not verified.
 */
export function OffersPanel({ state, savedExample = false, now, onRetry, initialParams }: OffersPanelProps) {
  return (
    <section aria-label="Offers" data-testid="offers-panel" data-state={state.status} className={styles.panel}>
      <h2 style={{ margin: 0, fontSize: "var(--rv-text-section)", color: "var(--rv-text-strong)" }}>Where to buy</h2>
      {state.status === "idle" && (
        <p className={styles.state} data-testid="offers-idle">
          Offers are not available from this data source.
        </p>
      )}
      {state.status === "loading" && (
        <p className={styles.state} role="status" aria-live="polite" data-testid="offers-loading">
          Checking vendors for this part. Nothing is shown until a page has been verified.
        </p>
      )}
      {state.status === "error" && (
        <div>
          <p className={styles.state} role="alert" data-tone="error" data-testid="offers-error" data-code={state.error.code}>
            Could not load offers ({state.error.code}): {state.error.message}
            {state.error.hint ? ` ${state.error.hint}` : ""}
          </p>
          {onRetry && state.error.retryable !== false && (
            <button type="button" className="rv-btn rv-btn--small" data-testid="offers-retry" onClick={onRetry} style={{ marginTop: 6 }}>
              Retry
            </button>
          )}
          <Footer />
        </div>
      )}
      {state.status === "refused" && (
        <div>
          <p className={styles.state} role="note" data-testid="offers-refused">
            {state.message || REFUSED_MESSAGE}
          </p>
          {state.offerSet && state.offerSet.notices.map((n) => (
            <p key={n} className={styles.notice} role="note" data-testid="offers-notice">
              {n}
            </p>
          ))}
          {state.offerSet && <Ledger entries={state.offerSet.ledger} />}
          <Footer />
        </div>
      )}
      {state.status === "ready" && (
        <ReadySet offerSet={state.offerSet} savedExample={savedExample} now={now} initialParams={initialParams} />
      )}
    </section>
  );
}
