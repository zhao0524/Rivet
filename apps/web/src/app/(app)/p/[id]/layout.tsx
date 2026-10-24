import type { ReactNode } from 'react';
import { ProjectShell } from '../../../../components/flow/ProjectShell';

export default function ProjectLayout({ children, params }: { children: ReactNode; params: { id: string } }) {
  return <ProjectShell id={params.id}>{children}</ProjectShell>;
}
