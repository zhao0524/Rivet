'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect } from 'react';

/**
 * Drifts the hero's decorative renders at different speeds as the hero scrolls away.
 * GSAP writes `transform`; the CSS float animation uses `translate`/`rotate`, so they compose.
 */
export function HeroParallax() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('.mk-hero .mk-decor__item').forEach((el, i) => {
        gsap.to(el, {
          yPercent: -18 - (i % 3) * 14,
          ease: 'none',
          scrollTrigger: { trigger: '.mk-hero', start: 'top top', end: 'bottom top', scrub: 0.4 },
        });
      });
    });
    return () => ctx.revert();
  }, []);
  return null;
}
