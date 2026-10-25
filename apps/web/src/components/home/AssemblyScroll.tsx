'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSyntheticCatalog, getSyntheticRoverPlan } from '../../lib/fixtures';
import { scrubToStep } from '../three/assembly';
import { useThemeMode } from '../system/ThemeToggle';
import { RoverScene } from '../three/RoverScene';

/** Timeline positions per rendered frame: keeps scroll-driven renders to ~100 per pass. */
const QUANTUM = 0.08;

/**
 * Scroll demo: the saved synthetic rover assembles itself as the section is scrolled.
 * GSAP pins the section and scrubs a timeline position in [0, stepCount], which the
 * assembly engine turns into the current step and its seat-in progress.
 */
export function AssemblyScroll() {
  const plan = useMemo(() => getSyntheticRoverPlan(), []);
  const catalog = useMemo(() => getSyntheticCatalog(), []);
  const steps = useMemo(
    () => [...plan.assembly_steps].sort((a, b) => a.step - b.step),
    [plan],
  );
  const stepCount = steps.length;
  const themeMode = useThemeMode();

  const sectionRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    const pin = pinRef.current;
    if (!section || !pin) return;

    // Reduced motion, or no layout engine to scroll against (tests): show the finished build.
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setPosition(stepCount);
      setVisible(true);
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: 'bottom bottom',
        pin,
        pinSpacing: false,
        scrub: 0.6,
        onToggle: (self) => setVisible(self.isActive || self.progress > 0),
        onUpdate: (self) => {
          const next = Math.round((self.progress * stepCount) / QUANTUM) * QUANTUM;
          setPosition((prev) => (prev === next ? prev : next));
          if (barRef.current) barRef.current.style.transform = `scaleX(${self.progress})`;
        },
      });

      gsap.from('.mk-build__copy > *', {
        y: 24,
        opacity: 0,
        stagger: 0.08,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: section, start: 'top 70%' },
      });
    }, section);

    // Mount the canvas a little before the section reaches the viewport.
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), {
      rootMargin: '400px 0px',
    });
    io.observe(section);

    return () => {
      io.disconnect();
      ctx.revert();
    };
  }, [stepCount]);

  const { step, progress } = scrubToStep(position, stepCount);
  const activeIndex = Math.max(0, step - 1);
  const done = position >= stepCount;

  return (
    <section
      ref={sectionRef}
      className="mk-build"
      aria-labelledby="mk-build-title"
      style={{ height: `${100 + stepCount * 45}vh` }}
      data-testid="home-assembly-scroll"
    >
      <div ref={pinRef} className="mk-build__pin">
        <div className="mk-build__panel mk-dark">
          <div className="mk-build__copy">
            <span className="mk-eyebrow">Scroll to assemble</span>
            <h2 id="mk-build-title" className="mk-build__title">
              From prompt to parts, <span className="mk-dim">one step at a time.</span>
            </h2>
            <p className="mk-build__lede mk-dim">
              Every Rivet design comes with build steps in order. This is a saved example rover, made of
              placeholder parts, putting itself together step by step.
            </p>
            <ol className="mk-build__steps">
              {steps.map((s, i) => (
                <li
                  key={s.step}
                  className="mk-build__step"
                  data-state={done || i < activeIndex ? 'done' : i === activeIndex && step > 0 ? 'active' : 'todo'}
                >
                  <span className="mk-build__num">{String(s.step).padStart(2, '0')}</span>
                  <span>{s.title}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mk-build__stage" data-testid="home-hero-stage">
            {visible ? (
              <RoverScene
                plan={plan}
                catalog={catalog}
                assemblyMode="step"
                assemblyStep={step}
                assemblyProgress={progress}
                previousStepsDisplay="solid"
                themeMode={themeMode}
                showGrid
              />
            ) : null}
            <div className="mk-build__hud">
              <span className="mk-build__counter">
                {done ? 'Assembled' : step === 0 ? 'Parts laid out' : `Step ${step} of ${stepCount}`}
              </span>
              <span className="mk-build__tag">Saved example · placeholder parts</span>
            </div>
            <div className="mk-build__bar" aria-hidden="true">
              <div ref={barRef} className="mk-build__bar-fill" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
