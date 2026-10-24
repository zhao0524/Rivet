'use client';

import { useMemo, useState } from 'react';
import type { Evidence, PartStatus, ResolveResult, ResolvedPart } from '../../../lib/resolve/types';
import { checkResult, type ResolveVerdict, type Verdict } from '../../../lib/resolve/verify';

const TIER_LABEL: Record<Evidence['source_host_tier'], string> = {
  manufacturer: 'Manufacturer',
  distributor: 'Distributor',
  teardown: 'Teardown',
  community: 'Community or web search',
};

const STATUS: Record<PartStatus, { label: string; tone: 'ok' | 'warn' | 'bad'; help: string }> = {
  verified: { label: 'Verified', tone: 'ok', help: 'Confirmed on a manufacturer or distributor page.' },
  inferred: { label: 'Inferred', tone: 'warn', help: 'From a teardown or community source. Not confirmed by the maker.' },
  not_found: { label: 'Not found', tone: 'bad', help: 'No source confirmed this part.' },
  conflict: { label: 'Sources disagree', tone: 'bad', help: 'Sources give different answers. None is chosen.' },
  stale: { label: 'Out of date', tone: 'warn', help: 'The source was checked too long ago to rely on.' },
};

export function formatFetchedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return d.toISOString().slice(0, 10);
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
              <span className="rv-muted">Found text: &ldquo;{e.matched_text}&rdquo;</span>
              {e.source_host_tier === 'teardown' || e.source_host_tier === 'community' ? (
                <span className="rv-muted">Not a maker or distributor page, so this cannot count as verified.</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function StatusBadge({ status }: { status: PartStatus }) {
  const s = STATUS[status];
  return (
    <span className={`rv-badge rv-badge--${s.tone}`} title={s.help} data-testid="part-status" data-status={status}>
      {s.label}
    </span>
  );
}

function PartRow({ part, verdict }: { part: ResolvedPart; verdict: Verdict }) {
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
          <SourcePopover id={part.part_id} evidence={part.evidence} />
        </span>
      </div>
      {part.sku ? <span className="rv-muted">Part number {part.sku}</span> : null}
      {part.material ? <span className="rv-muted">Material: {part.material}</span> : null}
      {part.note ? <span className="rv-muted">{part.note}</span> : null}
      {verdict.reason ? (
        <span data-testid={`resolve-downgrade-${part.part_id}`} className="rv-muted">
          {verdict.reason}
        </span>
      ) : null}
    </li>
  );
}

function headline(result: ResolveResult, verdict: ResolveVerdict): { title: string; body: string } {
  const p = result.product;
  const total = verdict.parts.length;
  const unconfirmed = verdict.parts.filter((x) => x.status !== 'verified' && x.status !== 'inferred').length;

  // Section 6: no copy may imply certainty the evidence does not support. Without a confirmed
  // product number we may say what we think it is, never that we found it.
  if (p !== null && !verdict.productConfirmed) {
    return {
      title: `We think this is ${p.brand} ${p.name}, but we could not confirm it`,
      body: `No manufacturer or distributor page we checked confirms the product number ${p.sku}. Treat everything below as unconfirmed.`,
    };
  }

  switch (verdict.outcome) {
    case 'exact_match':
      return {
        title: `We found this product: ${p?.brand} ${p?.name}`,
        body: 'Here are its parts, each with its source. Parts the maker does not publish are marked, not guessed.',
      };
    case 'partial_match':
      return {
        title: `We found the product but could not confirm ${unconfirmed} of ${total} parts`,
        body: 'Here is what we do know, and what similar products use for the rest.',
      };
    case 'no_match_with_alternatives':
      return {
        title: 'We could not find this exact product',
        body: 'These are the closest products we could verify, and what comparable products typically use. None of this describes your product.',
      };
    case 'unsupported':
      return {
        title: 'This is not something Rivet can break into parts',
        body: result.unsupported_reason ?? 'Rivet works on manufactured products.',
      };
  }
}

export interface ResolveResultViewProps {
  result: ResolveResult;
  /** Override the clock, so freshness checks are deterministic in tests. */
  now?: Date;
}

export function ResolveResultView({ result, now }: ResolveResultViewProps) {
  // The response states a status per part; `checkResult` decides what the evidence lets us show.
  const verdict = useMemo(() => checkResult(result, now ?? new Date()), [result, now]);
  const { title, body } = headline(result, verdict);
  const counts = {
    verified: verdict.parts.filter((x) => x.status === 'verified').length,
    inferred: verdict.parts.filter((x) => x.status === 'inferred').length,
    open: verdict.parts.filter((x) => x.status !== 'verified' && x.status !== 'inferred').length,
  };

  return (
    <div
      data-testid="resolve-result"
      data-outcome={verdict.outcome}
      data-claimed-outcome={verdict.claimedOutcome}
      style={{ display: 'grid', gap: 16 }}
    >
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
        {result.product ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span data-testid="resolve-sku">Product number {result.product.sku}</span>
            <SourcePopover id="product" evidence={result.product.evidence} />
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
            A clear photo of one product, such as a drone, a robot or an appliance, or a description that names the
            brand and model.
          </p>
        </section>
      ) : null}

      {result.parts.length > 0 ? (
        <section data-testid="resolve-parts">
          <h4 style={{ margin: '0 0 4px' }}>Parts</h4>
          <p className="rv-muted" style={{ margin: '0 0 4px' }} data-testid="resolve-part-counts">
            {counts.verified} verified · {counts.inferred} inferred · {counts.open} not confirmed
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {result.parts.map((p, i) => (
              <PartRow key={p.part_id} part={p} verdict={verdict.parts[i]} />
            ))}
          </ul>
        </section>
      ) : verdict.outcome === 'exact_match' || verdict.outcome === 'partial_match' ? (
        <p data-testid="resolve-no-parts" className="rv-muted">
          No parts list is published for this product, so none is shown.
        </p>
      ) : null}

      {result.alternatives.length > 0 ? (
        <section data-testid="resolve-alternatives">
          <h4 style={{ margin: '0 0 4px' }}>Closest products we could verify</h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {result.alternatives.map((a) => (
              <li
                key={a.sku}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', alignItems: 'center' }}
              >
                <span>
                  {a.brand} {a.name} <span className="rv-muted">({a.sku})</span>
                </span>
                <SourcePopover id={`alt-${a.sku}`} evidence={a.evidence} />
              </li>
            ))}
          </ul>
        </section>
      ) : verdict.outcome === 'no_match_with_alternatives' ? (
        <p data-testid="resolve-no-alternatives" className="rv-muted">
          No comparable product could be verified either.
        </p>
      ) : null}

      {result.typical.length > 0 ? (
        <section
          data-testid="resolve-typical"
          style={{ border: '1px dashed var(--rv-border-strong)', borderRadius: 'var(--rv-radius-md)', padding: 12 }}
        >
          <h4 style={{ margin: '0 0 2px' }}>What similar products use</h4>
          <p className="rv-muted" style={{ margin: '0 0 6px' }}>
            Typical for this kind of product. These are not parts of your product.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {result.typical.map((t) => (
              <li key={t.role} data-testid={`typical-${t.role}`} style={{ display: 'grid', gap: 2, padding: '6px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong>
                    {t.role}: {t.suggestion}
                  </strong>
                  <SourcePopover id={`typical-${t.role}`} evidence={t.evidence} />
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
    </div>
  );
}
