'use client';

import { useAppRouter } from '../../../../components/system/Navigation';
import { useEffect } from 'react';
import { getProject } from '../../../../lib/flow/projects';
import { projectPath } from '../../../../lib/flow/steps';

/** `/p/:id` resumes where the project left off. */
export default function ProjectIndex({ params }: { params: { id: string } }) {
  const router = useAppRouter();
  useEffect(() => {
    const project = getProject(params.id);
    if (!project) router.replace('/projects');
    else if (project.phase === 'ready') router.replace(projectPath(project.id, project.furthestStep));
    else if (project.phase === 'generating') router.replace(projectPath(project.id, 'generate'));
    else router.replace(projectPath(project.id, 'clarify'));
  }, [params.id, router]);
  return null;
}
