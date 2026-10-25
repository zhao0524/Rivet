'use client';

import { Suspense } from 'react';
import { NewProjectScreen } from '../../../components/start/NewProjectScreen';

/** A1 Prompt. Suspense is required around `useSearchParams` in the App Router. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <NewProjectScreen />
    </Suspense>
  );
}
