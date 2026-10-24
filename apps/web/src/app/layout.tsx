import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Rivet — Component-Backed Hardware Studio',
  description:
    'Interpret a rover reference image or prompt into a versioned BuildPlan with interactive 3D assembly, BOM, verification checks, wiring, simulation, and ESP32 starter firmware.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
