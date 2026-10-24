'use client';

import { Suspense } from 'react';
import { PartsStep } from '../../../../../components/steps/parts/PartsStep';

/** Step 2 of 5: Parts. Suspense is for `useSearchParams` (`?part=<instanceId>`). */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <PartsStep />
    </Suspense>
  );
}
