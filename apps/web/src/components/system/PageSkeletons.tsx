import type { CSSProperties } from 'react';
import { CardSkeletons } from '../start/gallery/ProjectCards';

/**
 * Loading placeholders shaped like the screens they stand in for, built from the same layout classes,
 * so nothing jumps when the real page replaces them. Used by the routes' `loading.tsx` files while a
 * page's code arrives, and by screens while they read the project from this browser.
 */

function Bar({ w, h = 14, style }: { w: number | string; h?: number; style?: CSSProperties }) {
  return <span className="ui-skeleton" style={{ display: 'block', width: w, height: h, ...style }} />;
}

/** The app header's place: logo, title, actions. */
export function HeaderSkeleton() {
  return (
    <header className="app-header" aria-hidden="true">
      <div className="app-header__left">
        <Bar w={64} h={28} style={{ borderRadius: 8 }} />
      </div>
      <div className="app-header__center">
        <Bar w={180} h={14} style={{ margin: '0 auto' }} />
      </div>
      <div className="app-header__right">
        <Bar w={32} h={32} style={{ borderRadius: 999 }} />
      </div>
    </header>
  );
}

/** One build step: title and purpose, the 3D stage, the side panel, and the footer action. */
export function StepSkeleton() {
  return (
    <section className="step" aria-busy="true" aria-label="Loading this step" data-testid="step-skeleton">
      <header className="step__head">
        <div style={{ display: 'grid', gap: 12 }}>
          <Bar w={220} h={40} />
          <Bar w="min(560px, 90%)" h={16} />
        </div>
      </header>
      <div className="step__body">
        <div className="ui-page-skeleton__split">
          <span className="ui-skeleton ui-page-skeleton__stage" />
          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <Bar w="40%" h={12} />
            <Bar w="80%" h={26} />
            <Bar w="100%" h={72} />
            <Bar w="100%" h={44} />
            <Bar w="100%" h={44} />
          </div>
        </div>
      </div>
      <footer className="step__foot" aria-hidden="true">
        <Bar w={32} h={20} />
        <Bar w={180} h={48} style={{ borderRadius: 10 }} />
      </footer>
    </section>
  );
}

/** Start building: the prompt, then the gallery. */
export function StartSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <main className="app-main" aria-busy="true" aria-label="Loading" data-testid="start-skeleton">
        <div className="start-prompt" style={{ display: 'grid', gap: 16, justifyItems: 'center' }}>
          <Bar w="min(520px, 90%)" h={44} />
          <Bar w="min(420px, 80%)" h={16} />
          <Bar w="min(720px, 100%)" h={128} style={{ borderRadius: 16, marginTop: 12 }} />
        </div>
        <section className="gal">
          <Bar w={180} h={22} />
          <ul className="gal-grid">
            <CardSkeletons count={4} />
          </ul>
        </section>
      </main>
    </>
  );
}

/** Projects: the heading, then a grid of cards. */
export function ProjectsSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <main className="app-main" aria-busy="true" aria-label="Loading projects" data-testid="projects-skeleton">
        <div className="start-head" style={{ display: 'grid', gap: 10 }}>
          <Bar w={200} h={40} />
          <Bar w={320} h={16} />
        </div>
        <ul className="gal-grid" style={{ marginTop: 24 }}>
          <CardSkeletons count={8} />
        </ul>
      </main>
    </>
  );
}

/** Any other page: a heading and a few blocks of content. */
export function PageSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <main className="app-main" aria-busy="true" aria-label="Loading" data-testid="page-skeleton">
        <div style={{ display: 'grid', gap: 14 }}>
          <Bar w={260} h={40} />
          <Bar w="min(520px, 90%)" h={16} />
        </div>
        <div className="ui-page-skeleton__split" style={{ marginTop: 28 }}>
          <span className="ui-skeleton ui-page-skeleton__stage" />
          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <Bar w="100%" h={96} />
            <Bar w="100%" h={96} />
          </div>
        </div>
      </main>
    </>
  );
}
