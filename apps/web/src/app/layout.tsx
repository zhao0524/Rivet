import type { Metadata, Viewport } from 'next';
import { DM_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { THEME_BOOT_SCRIPT } from '../components/system/ThemeToggle';
import '../styles/system.css';
import '../styles/flow.css';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Rivet: hardware designed and built with AI',
  description:
    'Describe a robot and Rivet designs it from real catalog parts: review the checks, parts, wiring and firmware, then buy and build it step by step.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eeedeb' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e10' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
