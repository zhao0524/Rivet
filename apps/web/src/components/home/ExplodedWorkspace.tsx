'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSourcedCatalog, getSourcedRoverPlan } from '../../lib/fixtures';
import { useThemeMode } from '../system/ThemeToggle';
import { RoverScene } from '../three/RoverScene';

/**
 * "See every part" visual: the saved example rover in a small 3D workspace. It turns slowly on its
 * own and can be dragged to orbit (zoom stays off, so it never fights the page scroll), and every few
 * seconds it pulls apart into the exploded view and back, with the view switch following along.
 * The canvas only mounts and runs while the card is on screen.
 */
const HOLD_MS = 2600;

export function ExplodedWorkspace() {
  const plan = useMemo(() => getSourcedRoverPlan(), []);
  const catalog = useMemo(() => getSourcedCatalog(), []);
  const themeMode = useThemeMode();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setStill(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Assembled, then exploded, then back, while on screen. Reduced motion holds the exploded view still.
  useEffect(() => {
    if (still) {
      setExploded(true);
      return;
    }
    if (!visible) return;
    const t = window.setInterval(() => setExploded((e) => !e), HOLD_MS);
    return () => window.clearInterval(t);
  }, [visible, still]);

  return (
    <div className="mk-workspace" ref={ref} data-testid="home-workspace">
      <div className="mk-workspace__head" aria-hidden="true">
        <b>3D workspace</b>
        <span className="mk-workspace__switch" data-on={exploded ? 'exploded' : 'assembled'}>
          <span>Assembled</span>
          <span>Exploded</span>
        </span>
      </div>
      <div className="mk-workspace__stage">
        {visible ? (
          <RoverScene
            plan={plan}
            catalog={catalog}
            assemblyMode="exploded"
            assemblyProgress={exploded ? 1 : 0}
            themeMode={themeMode}
            showGrid
            orbitOnly
            autoRotate={!still}
            enclosure="none"
            framePadding={0.04}
            active={visible}
          />
        ) : null}
        <span className="mk-workspace__hint" aria-hidden="true">
          Drag to turn it around
        </span>
      </div>
    </div>
  );
}
