import type { ReactNode } from 'react';
import { PageTransition } from '../../components/system/PageTransition';

/** Moving between app screens (Start building, Projects, a project) rises in. */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
