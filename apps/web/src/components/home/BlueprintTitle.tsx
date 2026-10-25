'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Hero headline that draws its own blueprint first: a dot grid, a dashed frame with guides
 * running past its corners, and one skeleton bar per wrapped line, then the real text wipes
 * in over the plan. Adapted from Bencho's Blueprint loader (bencho.dev, Pro licence).
 *
 * The plan is measured off the laid-out heading (a Range's client rects, one per line), so
 * it lands exactly where the text will at any width. Plays once on load; a click replays it.
 * The heading stays real text throughout, and reduced motion skips straight to it.
 */

const DRAW = 650;
const WIPE = 450;
/** Dot grid pitch. */
const G = 14;
/** Breathing room between the text and its frame. */
const PAD = 14;

type Rule = { x: number; y: number; w: number; h: number; i: number };
/** `w`/`h` size the SVG to the heading box; `frame` is the inked text's own bounds. */
type Plan = { rules: Rule[]; w: number; h: number; frame: { x: number; y: number; w: number; h: number } };
type Beat = 'rest' | 'plan' | 'reveal' | 'done';

export function BlueprintTitle({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  const title = useRef<HTMLHeadingElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [beat, setBeat] = useState<Beat>('rest');
  const [run, setRun] = useState(0);
  const uid = useId().replace(/:/g, '');
  const dots = `mk-bp-dots-${uid}`;
  const soft = `mk-bp-soft-${uid}`;
  const blur = `mk-bp-blur-${uid}`;

  useLayoutEffect(() => {
    const el = title.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const range = document.createRange();
      // No layout engine to measure against (tests): just show the heading.
      if (typeof range.getClientRects !== 'function') return setBeat('done');
      range.selectNodeContents(el);
      // One rule per line the text actually wraps to.
      const lines = new Map<number, { left: number; right: number; top: number; height: number }>();
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 2) continue;
        const key = Math.round(r.top);
        const had = lines.get(key);
        lines.set(
          key,
          had
            ? { left: Math.min(had.left, r.left), right: Math.max(had.right, r.right), top: had.top, height: had.height }
            : { left: r.left, right: r.right, top: r.top, height: r.height },
        );
      }
      const rules = [...lines.values()].map((l, i) => {
        // A bar about the text's x-height, centred on the line.
        const h = Math.max(10, Math.round(l.height * 0.4));
        return { x: l.left - base.left, y: l.top - base.top + l.height / 2, w: l.right - l.left, h, i };
      });
      if (!rules.length) return setBeat('done');
      const x0 = Math.min(...rules.map((r) => r.x)) - PAD;
      const x1 = Math.max(...rules.map((r) => r.x + r.w)) + PAD;
      const y0 = Math.max(0, Math.min(...[...lines.values()].map((l) => l.top - base.top)));
      const y1 = Math.min(base.height, Math.max(...[...lines.values()].map((l) => l.top - base.top + l.height)));
      const frame = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
      setPlan({ rules, w: Math.round(base.width), h: Math.round(base.height), frame });
    };
    measure();
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      live = false;
      ro?.disconnect();
    };
  }, []);

  const ready = plan !== null;
  useEffect(() => {
    if (!ready) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setBeat('done');
      return;
    }
    setBeat('rest');
    const timers = [
      window.setTimeout(() => setBeat('plan'), 30),
      window.setTimeout(() => setBeat('reveal'), 30 + DRAW),
      window.setTimeout(() => setBeat('done'), 30 + DRAW + WIPE),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [ready, run]);

  const per = plan ? (DRAW * 0.6) / Math.max(1, plan.rules.length) : 0;
  const f = plan?.frame ?? { x: 0, y: 0, w: 0, h: 0 };

  return (
    <div className="mk-bp" data-beat={beat} onClick={() => beat === 'done' && setRun((n) => n + 1)}>
      {plan && (
        <svg
          className="mk-bp__plan"
          width={plan.w}
          height={plan.h}
          viewBox={`0 0 ${plan.w} ${plan.h}`}
          aria-hidden="true"
        >
          <defs>
            <pattern id={dots} width={G} height={G} patternUnits="userSpaceOnUse">
              <circle cx={G / 2} cy={G / 2} r="1" className="mk-bp__dot" />
            </pattern>
            {/* The grid and guides have no edge: they fade out past the frame. */}
            <filter id={blur} filterUnits="userSpaceOnUse" x={f.x - 200} y={f.y - 200} width={f.w + 400} height={f.h + 400}>
              <feGaussianBlur stdDeviation="26" />
            </filter>
            <mask id={soft} maskUnits="userSpaceOnUse" x={f.x - 200} y={f.y - 200} width={f.w + 400} height={f.h + 400}>
              <rect x={f.x - 72} y={f.y - 72} width={f.w + 144} height={f.h + 144} rx="80" fill="#fff" filter={`url(#${blur})`} />
            </mask>
          </defs>
          <rect
            className="mk-bp__grid"
            x={f.x - 160}
            y={f.y - 160}
            width={f.w + 320}
            height={f.h + 320}
            fill={`url(#${dots})`}
            mask={`url(#${soft})`}
          />
          <g className="mk-bp__frame">
            <rect x={f.x + 0.5} y={f.y + 0.5} width={f.w - 1} height={f.h - 1} rx="14" />
            <g mask={`url(#${soft})`}>
              <line x1={f.x - 160} y1={f.y + 0.5} x2={f.x + f.w + 160} y2={f.y + 0.5} />
              <line x1={f.x - 160} y1={f.y + f.h - 0.5} x2={f.x + f.w + 160} y2={f.y + f.h - 0.5} />
              <line x1={f.x + 0.5} y1={f.y - 160} x2={f.x + 0.5} y2={f.y + f.h + 160} />
              <line x1={f.x + f.w - 0.5} y1={f.y - 160} x2={f.x + f.w - 0.5} y2={f.y + f.h + 160} />
            </g>
            <text x={f.x + f.w / 2} y={f.y + f.h + 22} textAnchor="middle" className="mk-bp__label">
              {`${f.w} × ${f.h}`}
            </text>
          </g>
          {plan.rules.map((r) => (
            <g key={r.i} className="mk-bp__rule" style={{ '--d': `${80 + r.i * per}ms` } as CSSProperties}>
              <rect x={r.x} y={r.y - r.h / 2} width={r.w} height={r.h} rx={r.h / 2} />
              <rect className="mk-bp__caret" x={r.x + r.w + 6} y={r.y - r.h / 2 - 4} width="3" height={r.h + 8} rx="1.5" />
            </g>
          ))}
        </svg>
      )}
      <h1 ref={title} id={id} className={`mk-bp__text ${className ?? ''}`}>
        {children}
      </h1>
    </div>
  );
}
