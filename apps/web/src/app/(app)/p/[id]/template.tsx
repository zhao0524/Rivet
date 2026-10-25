import type { ReactNode } from 'react';
import { PageTransition } from '../../../../components/system/PageTransition';

/** Moving between a project's steps: the header and stepper stay put, the step rises in. */
export default function StepTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
