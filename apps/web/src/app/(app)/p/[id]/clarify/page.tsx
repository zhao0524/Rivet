'use client';

import { useEffect } from 'react';
import { useAppRouter } from '../../../../../components/system/Navigation';
import { projectPath } from '../../../../../lib/flow/steps';

/** Older links: Clarify and Generate now happen inside the workspace chat. */
export default function Page({ params }: { params: { id: string } }) {
  const router = useAppRouter();
  useEffect(() => {
    router.replace(projectPath(params.id, 'workspace'));
  }, [params.id, router]);
  return null;
}
