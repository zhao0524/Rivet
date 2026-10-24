'use client';

import { useMemo } from 'react';
import { getSyntheticCatalog, getSyntheticRoverPlan } from '../../lib/fixtures';
import { RoverScene } from '../three/RoverScene';

/**
 * Live 3D hero for the landing page: the saved synthetic starter rover, read-only.
 * Labelled as a saved example so it is never mistaken for a sourced, generated build.
 */
export function HeroRover() {
  const plan = useMemo(() => getSyntheticRoverPlan(), []);
  const catalog = useMemo(() => getSyntheticCatalog(), []);

  return (
    <div className="rv-home__stage" data-testid="home-hero-stage">
      <RoverScene plan={plan} catalog={catalog} showGrid />
      <span className="rv-badge rv-badge--neutral rv-home__stage-label">Saved example · synthetic parts</span>
    </div>
  );
}
