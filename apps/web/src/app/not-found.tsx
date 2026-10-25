import type { Metadata } from 'next';
import Link from 'next/link';
import { AppHeader } from '../components/flow/AppHeader';

export const metadata: Metadata = { title: 'Page not found · Rivet' };

/** Unknown URLs keep the app frame and offer a way back, instead of Next's bare default 404. */
export default function NotFound() {
  return (
    <div className="app">
      <AppHeader />
      <main className="app-main app-main--narrow" data-testid="not-found">
        <section className="ui-card ui-card--pad">
          <p className="ui-eyebrow" style={{ marginBottom: 8 }}>
            404
          </p>
          <h1 className="ui-h2">There&apos;s nothing at this address</h1>
          <p className="ui-muted">The link may be old or mistyped. Projects you saved in this browser are still here.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
            <Link href="/" className="ui-btn ui-btn--primary" data-testid="not-found-home">
              Go to the home page
            </Link>
            <Link href="/projects" className="ui-btn ui-btn--secondary" data-testid="not-found-projects">
              Your projects
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
