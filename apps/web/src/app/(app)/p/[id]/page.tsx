'use client';

import { useAppRouter } from '../../../../components/system/Navigation';
import { useEffect } from 'react';
import { getProject } from '../../../../lib/flow/projects';
import { projectPath } from '../../../../lib/flow/steps';

/** `/p/:id` opens the project's workspace. */
export default function ProjectIndex({ params }: { params: { id: string } }) {
  const router = useAppRouter();
  useEffect(() => {
    const project = getProject(params.id);
    router.replace(project ? projectPath(project.id, 'workspace') : '/projects');
  }, [params.id, router]);
  return null;
}
