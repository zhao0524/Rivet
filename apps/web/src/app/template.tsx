import type { ReactNode } from 'react';
import { PageTransition } from '../components/system/PageTransition';

/** Every top-level page change (home, the app) fades in. Opacity only: the home page's pinned scroll demo measures itself as it mounts. */
export default function RootTemplate({ children }: { children: ReactNode }) {
  return <PageTransition variant="fade">{children}</PageTransition>;
}
