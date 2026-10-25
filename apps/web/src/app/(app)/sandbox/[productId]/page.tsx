'use client';

import { SandboxViewer } from '../../../../components/sandbox/SandboxViewer';

/** Sandbox viewer for one catalogue product. `?part=<part_id>` preselects a part. */
export default function Page({ params }: { params: { productId: string } }) {
  return <SandboxViewer productId={decodeURIComponent(params.productId)} />;
}
