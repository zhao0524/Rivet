import { inflateRawSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

const IGNORED_CONSOLE_ERRORS = [/Download the React DevTools/i];

/**
 * Collects uncaught page exceptions and console errors for the life of a test.
 * Returns a live array; assert on it after the flow has run.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
    const where = msg.location().url;
    errors.push(`console.error: ${text}${where ? ` (${where})` : ''}`);
  });
  return errors;
}

/**
 * Minimal ZIP reader (stored or deflated entries, no ZIP64), enough to open the firmware
 * export without adding a dependency. Returns entry name -> uncompressed bytes.
 */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP archive: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(offset) !== CENTRAL) throw new Error(`bad central directory entry at ${offset}`);
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (buf.readUInt32LE(localOffset) !== LOCAL) throw new Error(`bad local header for ${name}`);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

interface Box {
  top: number;
  bottom: number;
  height: number;
  width: number;
}

interface StageLayout {
  /** `canvas` when WebGL started, otherwise the stage element that shows the documented fallback. */
  subject: 'canvas' | 'stage';
  box: Box;
  viewportHeight: number;
  /** Every element from the subject's parent up to the studio shell. */
  containers: Array<{ element: string; height: number }>;
}

async function measureStage(page: Page): Promise<StageLayout> {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-rivet-stage]');
    if (!stage) throw new Error('no [data-rivet-stage] element in the studio');
    const canvas = stage.querySelector('canvas');
    const subject: Element = canvas ?? stage;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    const describe = (el: Element) => {
      const attrs = ['data-testid', 'data-slot', 'data-rivet', 'data-rivet-stage']
        .filter((a) => el.hasAttribute(a))
        .map((a) => `[${a}="${el.getAttribute(a)}"]`)
        .join('');
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${attrs || cls}`;
    };
    const containers: Array<{ element: string; height: number }> = [];
    for (let el = subject.parentElement; el && el !== document.body; el = el.parentElement) {
      containers.push({ element: describe(el), height: el.getBoundingClientRect().height });
      if (el.matches('[data-rivet="studio-shell"]')) break;
    }
    return {
      subject: canvas ? ('canvas' as const) : ('stage' as const),
      box: box(subject),
      viewportHeight: window.innerHeight,
      containers,
    };
  });
}

/**
 * Fails when the 3D canvas (or, without WebGL, the stage showing the fallback) is taller
 * than any of its containers up to the studio shell, or runs past the bottom of the window.
 * That is the #70 defect: the canvas grew with the side panels and the rover was framed
 * off-screen. Polls briefly because the canvas follows its container after a resize.
 */
export async function expectSceneFitsContainer(page: Page, when: string): Promise<void> {
  await expect(async () => {
    const m = await measureStage(page);
    const px = (n: number) => `${Math.round(n)}px`;
    expect(m.box.height, `${when}: the 3D ${m.subject} has no usable height`).toBeGreaterThan(100);
    for (const c of m.containers) {
      expect(
        m.box.height,
        `${when}: the 3D ${m.subject} (${px(m.box.height)}) is taller than its container ${c.element} (${px(c.height)})`,
      ).toBeLessThanOrEqual(c.height + 1);
    }
    expect(
      m.box.bottom,
      `${when}: the 3D ${m.subject} ends at ${px(m.box.bottom)}, below the ${px(m.viewportHeight)} window`,
    ).toBeLessThanOrEqual(m.viewportHeight + 1);
    expect(m.box.top, `${when}: the 3D ${m.subject} starts above the window`).toBeGreaterThanOrEqual(-1);
  }).toPass({ timeout: 10_000 });
}
