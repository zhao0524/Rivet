import type { SVGProps } from 'react';

/** 16px stroke icons. Decorative by default; pass `aria-label` via a wrapping control. */
const PATHS = {
  close: 'M4 4l8 8M12 4l-8 8',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  check: 'M3 8.5 6.5 12 13 4.5',
  arrowRight: 'M3 8h10M9 4l4 4-4 4',
  arrowLeft: 'M13 8H3M7 4 3 8l4 4',
  sparkle: 'M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.5 1.5M10.5 10.5 12 12M12 4l-1.5 1.5M5.5 10.5 4 12',
  sun: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z',
  plus: 'M8 3v10M3 8h10',
  download: 'M8 2.5v8M4.75 7.25 8 10.5l3.25-3.25M3 13.5h10',
  external: 'M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5',
  alert: 'M8 2 14.5 13.5h-13L8 2ZM8 6.5v3M8 11.5h.01',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 7.5v4M8 5h.01',
  share: 'M5.5 7 10.5 4.5M5.5 9l5 2.5M4 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  cart: 'M1.5 2.5h2l1.5 8h7.5l1.5-6H4.4M6.5 13.5h.01M11.5 13.5h.01',
  cube: 'M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5ZM2 5l6 3.5L14 5M8 8.5v6',
  image: 'M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6h.01',
  bolt: 'M9 1.5 3 9h4.5L7 14.5 13 7H8.5L9 1.5Z',
  play: 'M5 3.5v9l7-4.5-7-4.5Z',
  edit: 'M10.5 2.5l3 3L6 13H3v-3l7.5-7.5Z',
  chevronRight: 'M6 3.5 10.5 8 6 12.5',
  chevronDown: 'M3.5 6 8 10.5 12.5 6',
  folder: 'M1.75 4.25a1 1 0 0 1 1-1h3.5l1.5 1.75h5.5a1 1 0 0 1 1 1v6.75a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1V4.25Z',
  folderOpen: 'M1.75 12V4.25a1 1 0 0 1 1-1h3.5l1.5 1.75h4.5a1 1 0 0 1 1 1V7M1.75 12l1.9-4.3a1 1 0 0 1 .9-.6h9.2a.6.6 0 0 1 .55.85L12.6 12.4a1 1 0 0 1-.9.6H2.6a.85.85 0 0 1-.85-1Z',
  file: 'M4 1.75h5l3 3v9.5H4V1.75ZM9 1.75v3h3',
  spinner: 'M8 2a6 6 0 1 0 6 6',
  replay: 'M2.5 3v3.5H6M2.9 9.5A5.25 5.25 0 1 0 3.6 5L2.5 6.5',
  minus: 'M3.5 8h9',
  /** A 3D printer: frame, gantry, nozzle and the part on the bed. */
  print: 'M2.5 2.5h11v11h-11ZM2.5 5h11M7 5v1.5h2V5M8 6.5v1M6 11.5h4v-2H6ZM2.5 11.5h1M12.5 11.5h1',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 2.4 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
