'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAccount } from '../../lib/flow/projects';
import { ThemeToggle } from '../system/ThemeToggle';

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Rivet home">
      <span className="logo__mark" aria-hidden="true" />
      Rivet
    </Link>
  );
}

/** App top bar: logo, an optional center slot (project title), projects link, theme. */
export function AppHeader({ center, actions }: { center?: ReactNode; actions?: ReactNode }) {
  const account = useAccount();
  return (
    <header className="app-header">
      <div className="app-header__left">
        <Logo />
        <Link href="/projects" className="ui-btn ui-btn--ghost ui-btn--sm" data-testid="nav-projects">
          Projects
        </Link>
      </div>
      <div className="app-header__center">{center}</div>
      <div className="app-header__right">
        {actions}
        <ThemeToggle />
        {account ? (
          <span className="app-header__avatar" title={`Saved on this device as ${account.email}`} aria-label={`Saved as ${account.email}`}>
            {account.email.charAt(0).toUpperCase()}
          </span>
        ) : null}
      </div>
    </header>
  );
}
