import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** WCAG 2.x AA: 4.5:1 for text, 3:1 for control boundaries (1.4.11). */
const CSS = readFileSync(resolve(__dirname, '../src/styles/system.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--ui-([a-z-]+):\s*(#[0-9a-f]{6})\b/gi)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['text', 'muted', 'subtle', 'accent-text', 'danger', 'warn', 'ok', 'info'];
const SURFACES = ['bg', 'surface', 'raised'];

const PAIRS: Array<[fg: string, bg: string, min: number]> = [
  ...TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg, 4.5] as [string, string, number])),
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'accent-hover', 4.5],
  ['on-inverse', 'inverse', 4.5],
  ['accent-text', 'accent-soft', 4.5],
  ['danger', 'danger-bg', 4.5],
  ['warn', 'warn-bg', 4.5],
  ['ok', 'ok-bg', 4.5],
  ['muted', 'sunken', 4.5],
  ['text', 'sunken', 4.5],
  ['border-strong', 'bg', 3],
  ['border-strong', 'surface', 3],
];

describe.each([
  ['light', ":root[data-theme='light']"],
  ['dark', ":root[data-theme='dark']"],
])('%s theme meets WCAG AA', (_name, selector) => {
  const tokens = block(selector);

  it.each(PAIRS)('%s on %s', (fg, bg, min) => {
    expect(tokens[fg], `--ui-${fg} missing`).toBeDefined();
    expect(tokens[bg], `--ui-${bg} missing`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });
});
