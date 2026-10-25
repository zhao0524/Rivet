'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import '../../../styles/gallery.css';

/** Which token the rim light takes its colour from. */
export type EdgeGlow = 'accent' | 'pink' | 'orange';

export const EDGE_GLOWS: readonly EdgeGlow[] = ['accent', 'pink', 'orange'];

export interface EdgeLightCardProps {
  title: string;
  /** Second caption line (where the project is, or what a sample does). */
  meta: ReactNode;
  /** Small line at the right of the title, e.g. "2 days ago". */
  time?: ReactNode;
  /** Optional third line, e.g. what pressing a sample will do. */
  note?: ReactNode;
  /** Picture on the slab. Decorative: the title names the card. */
  image: string;
  /** Shown instead when `image` fails to load (e.g. an uploaded picture the API no longer has). */
  fallbackImage?: string;
  /** Small tag over the picture, e.g. "Sample". */
  tag?: ReactNode;
  /** Accessible name of the card's link or button. */
  label: string;
  /** Navigate with a link... */
  href?: string;
  /** ...or act with a button. */
  onPress?: () => void;
  /** Rendered outside the link/button (e.g. an OverflowMenu), top right. */
  menu?: ReactNode;
  glow?: EdgeGlow;
  testId?: string;
  /** Test id for the link/button itself. */
  actionTestId?: string;
  /** Extra data attribute on the action, e.g. the sample slug. */
  dataSample?: string;
}

/* Bencho "Edge light", adapted: the rim arc facing the pointer lights up once the pointer is
   past EDGE of the way from the middle to the edge (the 1px border past EDGE + 20), and the
   card leans a little toward it. Keyboard focus lights the whole rim gently instead. */
const EDGE = 40;
const TILT = 20;

const ramp = (near: number, from: number) => Math.max(0, (near * 100 - from) / (100 - from));

/**
 * A gallery card: picture on a slab with a short caption, whose rim catches light near the
 * pointer. It is one real link (`href`) or button (`onPress`) with an accessible name.
 */
export function EdgeLightCard({
  title,
  meta,
  time,
  note,
  image,
  fallbackImage,
  tag,
  label,
  href,
  onPress,
  menu,
  glow = 'accent',
  testId,
  actionTestId,
  dataSample,
}: EdgeLightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();
  const describedBy = note ? `${uid}-meta ${uid}-note` : `${uid}-meta`;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const shown = brokenImage === image && fallbackImage ? fallbackImage : image;

  function move(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    const dx = e.clientX - r.left - cx;
    const dy = e.clientY - r.top - cy;
    const kx = dx ? cx / Math.abs(dx) : Infinity;
    const ky = dy ? cy / Math.abs(dy) : Infinity;
    const near = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    let angle = dx || dy ? (Math.atan2(dy, dx) * 180) / Math.PI + 90 : 0;
    if (angle < 0) angle += 360;
    const lx = Math.max(-1, Math.min(1, dx / cx));
    const ly = Math.max(-1, Math.min(1, dy / cy));
    el.style.setProperty('--elc-a', `${angle.toFixed(2)}deg`);
    el.style.setProperty('--elc-glow', ramp(near, EDGE).toFixed(3));
    el.style.setProperty('--elc-rim', ramp(near, Math.min(95, EDGE + 20)).toFixed(3));
    el.style.setProperty('--elc-rx', `${(-ly * TILT * 0.16).toFixed(2)}deg`);
    el.style.setProperty('--elc-ry', `${(lx * TILT * 0.16).toFixed(2)}deg`);
  }

  function leave() {
    setHover(false);
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--elc-rx', '0deg');
    el.style.setProperty('--elc-ry', '0deg');
  }

  function onFocus(e: FocusEvent<HTMLDivElement>) {
    // Only the card's own action lights it, and only for keyboard focus.
    const target = e.target as HTMLElement;
    if (!target.classList.contains('elc__hit')) return;
    let visible = true;
    try {
      visible = target.matches(':focus-visible');
    } catch {
      visible = true;
    }
    setFocus(visible);
  }

  const lit = hover || focus;
  const body = (
    <>
      <span className="elc__photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shown} alt="" onError={() => setBrokenImage(image)} width={640} height={640} loading="lazy" decoding="async" draggable={false} />
        {tag ? <span className="elc__tag">{tag}</span> : null}
      </span>
      <span className="elc__cap">
        <span className="elc__row">
          <span className="elc__title">{title}</span>
          {time ? <span className="elc__time">{time}</span> : null}
        </span>
        <span className="elc__meta" id={`${uid}-meta`}>{meta}</span>
        {note ? <span className="elc__note" id={`${uid}-note`}>{note}</span> : null}
      </span>
    </>
  );

  return (
    <div
      ref={ref}
      className="elc"
      data-glow={glow}
      data-lit={lit ? 'true' : 'false'}
      data-mode={hover ? 'pointer' : focus ? 'focus' : 'off'}
      data-testid={testId}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return;
        setHover(true);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'touch') return;
        move(e);
      }}
      onPointerLeave={leave}
      onFocus={onFocus}
      onBlur={(e) => {
        if ((e.target as HTMLElement).classList.contains('elc__hit')) setFocus(false);
      }}
    >
      <div className="elc__slab">
        {href ? (
          <Link href={href} className="elc__hit" aria-label={label} aria-describedby={describedBy} data-testid={actionTestId}>
            {body}
          </Link>
        ) : (
          <button type="button" className="elc__hit" aria-label={label} aria-describedby={describedBy} onClick={onPress} data-testid={actionTestId} data-sample={dataSample}>
            {body}
          </button>
        )}
        {menu ? <div className="elc__menu">{menu}</div> : null}
      </div>
      <span className="elc__rim" aria-hidden="true" />
      <span className="elc__glow" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}
