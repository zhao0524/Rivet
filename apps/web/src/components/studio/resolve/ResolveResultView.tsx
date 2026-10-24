'use client';

import { useMemo, useState } from 'react';
import type {
  ClaimResult,
  ClaimStatus,
  Evidence,
  LedgerEntry,
  PartResult,
  Resolution,
} from '../../../lib/resolve/types';
import {
  checkResult,
  claimsEvidence,
  evidenceFor,
  indexLedger,
  type EvidenceIndex,
  type ResolveVerdict,
  type Verdict,
} from '../../../lib/resolve/verify';

const TIER_LABEL: Record<Evidence['source_host_tier'], string> = {
  manufacturer: 'Manufacturer',
  distributor: 'Distributor',
  teardown: 'Teardown',
  community: 'Community or web search',
};

const STATUS: Record<ClaimStatus, { label: string; tone: 'ok' | 'warn' | 'bad'; help: string }> = {
  verified: { label: 'Verified', tone: 'ok', help: 'Confirmed on a manufacturer or distributor page.' },
  inferred: { label: 'Inferred', tone: 'warn', help: 'From a teardown or a model reading of a page. Not confirmed by the maker.' },
  not_found: { label: 'Not found', tone: 'bad', help: 'No source confirmed this part.' },
  conflict: { label: 'Sources disagree', tone: 'bad', help: 'Sources give different answers. None is chosen.' },
  stale: { label: 'Out of date', tone: 'warn', help: 'The source was checked too long ago to rely on.' },
  unavailable: { label: 'Not sold separately', tone: 'warn', help: 'The part is not sold or not published on its own.' },
};

const CLAIM_LABEL: Record<string, string> = { sku: 'Part number', material: 'Material', price: 'Price', mpn: 'MPN' };

const SUPPORT_LABEL: Record<LedgerEntry['support'], string> = {
  verified: 'Confirms',
  inferred: 'Suggests',
  stale: 'Out of date',
  rejected: 'Rejected',
};

export function formatFetchedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return d.toISOString().slice(0, 10);
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "DJI Mini 4" with brand "DJI" stays "DJI Mini 4"; never "DJI DJI Mini 4". */
function productName(p: { brand: string; name: string }): string {
  return p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? p.name : `${p.brand} ${p.name}`;
}

function SourcePopover({ id, evidence }: { id: string; evidence: Evidence[] }) {
  const [open, setOpen] = useState(false);
  if (evidence.length === 0) {
    return (
      <span className="rv-muted" data-testid={`no-source-${id}`}>
        No source
      </span>
    );
  }
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="rv-btn rv-btn--small"
        data-testid={`source-toggle-${id}`}
        aria-expanded={open}
        aria-controls={`source-${id}`}
        onClick={() => setOpen((o) => !o)}
      >
        {evidence.length === 1 ? 'Source' : `Sources (${evidence.length})`}
      </button>
      {open ? (
        <div
          id={`source-${id}`}
          role="group"
          aria-label="Source details"
          data-testid={`source-popover-${id}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          style={{
            position: 'absolute',
            zIndex: 5,
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 'min(320px, 80vw)',
            padding: 10,
            background: 'var(--rv-surface-raised)',
            border: '1px solid var(--rv-border-strong)',
            borderRadius: 'var(--rv-radius-md)',
            textAlign: 'left',
            display: 'grid',
            gap: 10,
          }}
        >
          {evidence.map((e, i) => (
            <div key={`${e.source_url}-${i}`} style={{ display: 'grid', gap: 2, fontSize: 'var(--rv-text-caption)' }}>
              <a
                href={e.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--rv-accent-text)', wordBreak: 'break-all' }}
              >
                {e.source_url}
              </a>
              <span>
                <strong>{TIER_LABEL[e.source_host_tier]}</strong> source · fetched {formatFetchedDate(e.fetched_at)}
              </span>
              <span className="rv-muted">
                {CLAIM_LABEL[e.claim] ?? e.claim} {e.value} · found text: &ldquo;{e.matched_text}&rdquo;
              </span>
              {e.source_host_tier === 'teardown' || e.source_host_tier === 'community' ? (
                <span className="rv-muted">Not a maker or distributor page, so this cannot count as verified.</span>
              ) : e.extractor === 'llm-extract' ? (
                <span className="rv-muted">Read from the page by a model, so this cannot count as verified.</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function StatusBadge({ status }: { status: ClaimStatus }) {
  const s = STATUS[status];
  return (
    <span className={`rv-badge rv-badge--${s.tone}`} title={s.help} data-testid="part-status" data-status={status}>
      {s.label}
    </span>
  );
}

/** Claims besides the part number (material, price, ...), each with how sure we are. */
function OtherClaims({ claims, partId }: { claims: ClaimResult[]; partId: string }) {
  const others = claims.filter((c) => c.claim !== 'sku');
  if (others.length === 0) return null;
  return (
    <>
      {others.map((c) => (
        <span key={c.claim} className="rv-muted" data-testid={`resolve-claim-${partId}-${c.claim}`}>
          {CLAIM_LABEL[c.claim] ?? c.claim}:{' '}
          {c.status === 'conflict'
            ? `sources disagree (${c.conflicting_values.join(' vs ')})`
            : c.value !== null && (c.status === 'verified' || c.status === 'inferred')
              ? `${c.value}${c.status === 'inferred' ? ' (inferred)' : ''}`
              : STATUS[c.status].label.toLowerCase()}
        </span>
      ))}
    </>
  );
}

function PartRow({ part, verdict, index }: { part: PartResult; verdict: Verdict; index: EvidenceIndex }) {
  const sku = part.claims.find((c) => c.claim === 'sku');
  const shownSku = verdict.status === 'verified' || verdict.status === 'inferred' ? part.sku : null;
  return (
    <li
      data-testid={`resolve-part-${part.part_id}`}
      data-status={verdict.status}
      data-claimed-status={verdict.claimed}
      style={{ display: 'grid', gap: 4, padding: '8px 0', borderBottom: '1px solid var(--rv-border)' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>{part.name}</strong>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge status={verdict.status} />
          <SourcePopover id={part.part_id} evidence={claimsEvidence(part.claims, index)} />
        </span>
      </div>
      {shownSku ? <span className="rv-muted">Part number {shownSku}</span> : null}
      {verdict.status === 'conflict' && sku && sku.conflicting_values.length > 0 ? (
        <span className="rv-muted" data-testid={`resolve-conflict-${part.part_id}`}>
          Sources give {sku.conflicting_values.join(' and ')}. Neither is chosen.
        </span>
      ) : null}
      <OtherClaims claims={part.claims} partId={part.part_id} />
      {part.note && verdict.status !== 'conflict' ? <span className="rv-muted">{part.note}</span> : null}
      {verdict.reason ? (
        <span data-testid={`resolve-downgrade-${part.part_id}`} className="rv-muted">
          {verdict.reason}
        </span>
      ) : null}
    </li>
  );
}

function headline(result: Resolution, verdict: ResolveVerdict): { title: string; body: string } {
  const p = result.product;
  const total = verdict.parts.length;
  // Section 4: "could not confirm N of M" counts every part that is neither verified nor
  // explicitly unavailable. An inferred part is shown with its link, but it is not confirmed.
  const unconfirmed = verdict.parts.filter((x) => x.status !== 'verified' && x.status !== 'unavailable').length;

  // Section 6: no copy may imply certainty the evidence does not support. Without a confirmed
  // product number we may say what we think it is, never that we found it.
  if (p !== null && !verdict.productConfirmed) {
    return {
      title: `This may be ${productName(p)}, but we could not confirm it`,
      body: `No current manufacturer or distributor page we checked confirms ${
        p.sku ? `the product number ${p.sku}` : 'its product number'
      }. Treat everything below as unconfirmed.`,
    };
  }

  switch (verdict.outcome) {
    case 'exact_match':
      return {
        title: `We found this product: ${p ? productName(p) : 'unknown'}`,
        body: 'Here are its parts, each with its source. Parts the maker does not sell separately are marked, not guessed.',
      };
    case 'partial_match':
      return total === 0
        ? {
            title: `We found ${p ? productName(p) : 'the product'} but could not confirm any of its parts`,
            body: 'Here is what similar products use.',
          }
        : {
            title: `We found the product but could not confirm ${unconfirmed} of ${total} parts`,
            body: 'Here is what we do know, and what similar products use for the rest.',
          };
    case 'no_match_with_alternatives':
      return {
        title: 'We could not find this exact product',
        body: 'These are the closest products we could verify, and what comparable products typically use. None of this describes your product.',
      };
    case 'unsupported':
      // A product we could not read is not "not a product": say only what we know.
      return result.guess.category === 'not_a_product'
        ? {
            title: 'This is not something Rivet can break into parts',
            body: result.unsupported_reason ?? 'Rivet works on manufactured products.',
          }
        : {
            title: 'We could not tell which product this is',
            body: result.unsupported_reason ?? 'Upload a clearer photo or describe the product in words.',
          };
  }
}

function Ledger({ ledger }: { ledger: LedgerEntry[] }) {
  if (ledger.length === 0) return null;
  return (
    <details data-testid="resolve-ledger">
      <summary>Every source we checked ({ledger.length})</summary>
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 6 }}>
        {ledger.map((e) => (
          <li
            key={e.evidence_id}
            data-testid={`ledger-${e.evidence_id}`}
            data-support={e.support}
            style={{ display: 'grid', gap: 2, fontSize: 'var(--rv-text-caption)' }}
          >
            <span>
              <strong>{SUPPORT_LABEL[e.support]}</strong> · {e.subject.replace(':', ': ')} ·{' '}
              {CLAIM_LABEL[e.evidence.claim] ?? e.evidence.claim} {e.evidence.value}
            </span>
            <a
              href={e.evidence.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--rv-accent-text)', wordBreak: 'break-all' }}
            >
              {e.evidence.source_url}
            </a>
            <span className="rv-muted">
              {TIER_LABEL[e.evidence.source_host_tier]} · fetched {formatFetchedDate(e.evidence.fetched_at)} · {e.reason}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export interface ResolveResultViewProps {
  result: Resolution;
  /** Override the clock, so freshness checks are deterministic in tests. */
  now?: Date;
}

export function ResolveResultView({ result, now }: ResolveResultViewProps) {
  // The response states a status per claim; `checkResult` decides what the evidence lets us show.
  const verdict = useMemo(() => checkResult(result, now ?? new Date()), [result, now]);
  const index = useMemo(() => indexLedger(result), [result]);
  const { title, body } = headline(result, verdict);
  const counts = {
    verified: verdict.parts.filter((x) => x.status === 'verified').length,
    inferred: verdict.parts.filter((x) => x.status === 'inferred').length,
    unavailable: verdict.parts.filter((x) => x.status === 'unavailable').length,
    open: verdict.parts.filter((x) => !['verified', 'inferred', 'unavailable'].includes(x.status)).length,
  };
  const productSku = result.product?.claims.filter((c) => c.claim === 'sku') ?? [];

  return (
    <div
      data-testid="resolve-result"
      data-outcome={verdict.outcome}
      data-claimed-outcome={verdict.claimedOutcome}
      style={{ display: 'grid', gap: 16 }}
    >
      {result.provenance.saved_example ? (
        <p role="note" data-testid="resolve-provenance-banner" className="rv-muted" style={{ margin: 0 }}>
          {result.provenance.banner ?? 'Saved example: built-in sample data, not a live lookup.'}
        </p>
      ) : null}

      <header style={{ display: 'grid', gap: 4 }}>
        <h3
          data-testid="resolve-headline"
          style={{ margin: 0, fontSize: 'var(--rv-text-title)', color: 'var(--rv-text-strong)' }}
        >
          {title}
        </h3>
        <p style={{ margin: 0 }} className="rv-muted">
          {body}
        </p>
        {result.product && verdict.productConfirmed && result.product.sku ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span data-testid="resolve-sku">Product number {result.product.sku}</span>
            <SourcePopover id="product" evidence={claimsEvidence(productSku, index)} />
          </div>
        ) : null}
      </header>

      {verdict.outcomeReason !== undefined || verdict.downgrades.length > 0 ? (
        <p data-testid="resolve-downgrade-notice" className="rv-muted" style={{ margin: 0 }}>
          {verdict.outcomeReason !== undefined ? `${verdict.outcomeReason} ` : ''}
          {verdict.downgrades.length > 0
            ? `${verdict.downgrades.length} ${
                verdict.downgrades.length === 1 ? 'part claims' : 'parts claim'
              } more than the sources attached to ${
                verdict.downgrades.length === 1 ? 'it' : 'them'
              } support, so ${verdict.downgrades.length === 1 ? 'it is' : 'they are'} shown at the weaker label.`
            : ''}
        </p>
      ) : null}

      {verdict.outcome === 'unsupported' ? (
        <section data-testid="resolve-unsupported-help">
          <h4 style={{ margin: '0 0 4px' }}>What to upload instead</h4>
          <p style={{ margin: 0 }} className="rv-muted">
            A clear photo of one product with its brand or model label visible, such as a drone, a robot or an
            appliance, or a description that names the brand and model.
          </p>
        </section>
      ) : null}

      {result.parts.length > 0 ? (
        <section data-testid="resolve-parts">
          <h4 style={{ margin: '0 0 4px' }}>Parts</h4>
          <p className="rv-muted" style={{ margin: '0 0 4px' }} data-testid="resolve-part-counts">
            {counts.verified} verified · {counts.inferred} inferred · {counts.open} not confirmed
            {counts.unavailable > 0 ? ` · ${counts.unavailable} not sold separately` : ''}
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {result.parts.map((p, i) => (
              <PartRow key={p.part_id} part={p} verdict={verdict.parts[i]} index={index} />
            ))}
          </ul>
        </section>
      ) : verdict.outcome === 'exact_match' || verdict.outcome === 'partial_match' ? (
        <p data-testid="resolve-no-parts" className="rv-muted">
          No parts list is published for this product, so none is shown.
        </p>
      ) : null}

      {verdict.alternatives.length > 0 ? (
        <section data-testid="resolve-alternatives">
          <h4 style={{ margin: '0 0 4px' }}>Closest products we could verify</h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {verdict.alternatives.map((a) => (
              <li
                key={a.sku}
                data-testid={`alternative-${slug(a.sku)}`}
                style={{ display: 'grid', gap: 2, padding: '6px 0' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span>
                    {productName(a)} <span className="rv-muted">({a.sku})</span>
                  </span>
                  <SourcePopover id={`alt-${slug(a.sku)}`} evidence={evidenceFor(a.evidence_ids, index)} />
                </div>
                {a.reason ? <span className="rv-muted">{a.reason}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : verdict.outcome === 'no_match_with_alternatives' ? (
        <p data-testid="resolve-no-alternatives" className="rv-muted">
          No comparable product could be verified either.
        </p>
      ) : null}

      {verdict.typical.length > 0 ? (
        <section
          data-testid="resolve-typical"
          style={{ border: '1px dashed var(--rv-border-strong)', borderRadius: 'var(--rv-radius-md)', padding: 12 }}
        >
          <h4 style={{ margin: '0 0 2px' }}>What similar products use</h4>
          <p className="rv-muted" style={{ margin: '0 0 6px' }}>
            Typical for this kind of product. These are not parts of your product.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {verdict.typical.map((t) => (
              <li key={t.name} data-testid={`typical-${slug(t.name)}`} style={{ display: 'grid', gap: 2, padding: '6px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong>
                    {t.name}
                    {t.sku ? <span className="rv-muted"> ({t.sku})</span> : null}
                  </strong>
                  <SourcePopover id={`typical-${slug(t.name)}`} evidence={evidenceFor(t.evidence_ids, index)} />
                </div>
                <span className="rv-muted">{t.rationale}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : verdict.outcome === 'partial_match' || verdict.outcome === 'no_match_with_alternatives' ? (
        <p data-testid="resolve-no-typical" className="rv-muted">
          We have no sourced reference for what similar products use, so we are not suggesting anything.
        </p>
      ) : null}

      {verdict.hiddenSuggestions > 0 ? (
        <p data-testid="resolve-hidden-suggestions" className="rv-muted" style={{ margin: 0 }}>
          {verdict.hiddenSuggestions} {verdict.hiddenSuggestions === 1 ? 'suggestion was' : 'suggestions were'} hidden
          because no current manufacturer or distributor page confirms {verdict.hiddenSuggestions === 1 ? 'it' : 'them'}.
        </p>
      ) : null}

      <Ledger ledger={result.ledger} />
    </div>
  );
}
