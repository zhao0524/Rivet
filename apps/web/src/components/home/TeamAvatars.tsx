'use client';

import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from 'react';

/**
 * The team, as an overlapping row of faces in the hero pill (adapted from Bencho's avatar group).
 * Point along the row and it lifts round the pointer while one name tip slides to each face.
 * Each face links to that person's Devpost profile.
 */

const LIFT = 4;
const GROW = 8;
const FALLOFF = 0.45;
const IN = 'cubic-bezier(0.22, 1, 0.36, 1)';
const OUT = 'cubic-bezier(0.34, 3.85, 0.64, 1)';

const TEAM = [
  { name: 'Emaad Qazi', photo: '/team/emaad.webp', href: 'https://devpost.com/qaziemaad' },
  { name: 'David Zhao', photo: '/team/david.webp', href: 'https://devpost.com/zhao0524' },
  { name: 'Rohan Gottipati', photo: '/team/rohan.webp', href: 'https://devpost.com/rohan-gottipati' },
  { name: 'Rebecca Sun', photo: '/team/rebecca.webp', href: 'https://devpost.com/rebecca-sun656' },
] as const;

export function TeamAvatars() {
  const [at, setAt] = useState<number | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const down = useRef(false);

  const nearest = (x: number) => {
    const faces = row.current?.querySelectorAll<HTMLElement>('.mk-team__face');
    if (!faces?.length) return null;
    let best = 0;
    let gap = Infinity;
    faces.forEach((el, i) => {
      const b = el.getBoundingClientRect();
      const d = Math.abs(x - (b.left + b.width / 2));
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    return best;
  };

  return (
    <div
      ref={row}
      className="mk-team"
      role="list"
      aria-label="Made by"
      onPointerDown={(e) => {
        down.current = true;
        setAt(nearest(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' || down.current) setAt(nearest(e.clientX));
      }}
      onPointerUp={(e) => {
        down.current = false;
        if (e.pointerType !== 'mouse') setAt(null);
      }}
      onPointerCancel={() => {
        down.current = false;
        setAt(null);
      }}
      onPointerLeave={() => {
        if (!down.current) setAt(null);
      }}
    >
      {TEAM.map((p, i) => {
        const d = at === null ? null : Math.abs(i - at);
        const shift = d === null ? 0 : -LIFT * Math.pow(FALLOFF, d);
        const scale = d === 0 ? 1 + GROW / 100 : 1;
        return (
          <a
            key={p.name}
            href={p.href}
            target="_blank"
            rel="noreferrer"
            className="mk-team__face"
            role="listitem"
            aria-label={p.name}
            onFocus={() => setAt(i)}
            onBlur={() => setAt(null)}
            style={
              {
                // The curve first, so the move below uses it.
                transitionTimingFunction: at === null ? OUT : IN,
                transform: `translateY(${shift.toFixed(2)}px) scale(${scale})`,
              } as CSSProperties
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static headshots */}
            <img src={p.photo} alt="" width={64} height={64} draggable={false} />
          </a>
        );
      })}
      <Tip row={row} at={at} />
    </div>
  );
}

/** One name pill that slides to whichever face is under the pointer and resizes to fit the name. */
function Tip({ row, at }: { row: RefObject<HTMLDivElement | null>; at: number | null }) {
  const [last, setLast] = useState(0);
  const [place, setPlace] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  const word = useRef<HTMLSpanElement>(null);
  if (at !== null && at !== last) setLast(at);

  useLayoutEffect(() => {
    const face = row.current?.querySelectorAll<HTMLElement>('.mk-team__face')[last];
    const text = word.current;
    if (!face || !text) return;
    const w = Math.ceil(text.scrollWidth) + 20;
    setPlace({ x: face.offsetLeft + face.offsetWidth / 2 - w / 2, w });
  }, [last, row]);
  useLayoutEffect(() => {
    if (!place || ready) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [place, ready]);

  return (
    <span
      className="mk-team__tip"
      aria-hidden="true"
      data-on={at !== null && !!place}
      data-ready={ready || undefined}
      style={place ? { width: place.w, transform: `translateX(${place.x}px)` } : undefined}
    >
      <span ref={word}>{TEAM[last].name}</span>
    </span>
  );
}
