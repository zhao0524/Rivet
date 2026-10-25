import type { ReactNode } from 'react';
import { FlowProvider } from '../../components/flow/FlowProvider';

/** Every app screen shares one plan store, so a running job survives navigation between screens. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <FlowProvider>
      <div className="app">{children}</div>
    </FlowProvider>
  );
}
