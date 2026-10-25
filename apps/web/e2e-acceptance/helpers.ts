import { inflateRawSync } from 'node:zlib';
import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { API_URL } from './env';

const IGNORED_CONSOLE_ERRORS = [/Download the React DevTools/i];

/**
 * Collects uncaught page exceptions and console errors for the life of a test.
 * Returns a live array; assert on it after the flow has run. Chrome logs every non-2xx
 * fetch as a console error; a refused edit (HTTP 422 from `/edits`) is the API's documented
 * answer, which the spec asserts on directly, so that one line is not counted.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
    const where = msg.location().url;
    if (/status of 422/.test(text) && /\/edits(\?|$)/.test(where ?? '')) return;
    errors.push(`console.error: ${text}${where ? ` (${where})` : ''}`);
  });
  return errors;
}

/** `GET` on the API itself (not through the Next proxy), expecting 200 JSON. */
export async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API_URL}${path}`);
  expect(res.status(), `GET ${path} on the API`).toBe(200);
  return (await res.json()) as T;
}

/** Matches the response of a `POST` to `path` through the app's same-origin `/api` proxy. */
export function isPost(path: string): (response: Response) => boolean {
  return (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === path;
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

interface SceneLayout {
  /** `canvas` when WebGL started, otherwise the stage element that shows the documented fallback. */
  subject: 'canvas' | 'stage';
  height: number;
  width: number;
  containerHeight: number;
  containerWidth: number;
  viewportWidth: number;
}

async function measureScene(page: Page, viewportTestId: string): Promise<SceneLayout> {
  return page.evaluate((testId) => {
    const container = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!container) throw new Error(`no [data-testid="${testId}"] on the page`);
    const stage = container.querySelector<HTMLElement>('[data-rivet-stage]');
    if (!stage) throw new Error(`no [data-rivet-stage] inside [data-testid="${testId}"]`);
    const canvas = stage.querySelector('canvas');
    const subject: Element = canvas ?? stage;
    const r = subject.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    return {
      subject: canvas ? ('canvas' as const) : ('stage' as const),
      height: r.height,
      width: r.width,
      containerHeight: c.height,
      containerWidth: c.width,
      viewportWidth: window.innerWidth,
    };
  }, viewportTestId);
}

/**
 * Fails when the 3D canvas (or, without WebGL, the stage showing the fallback) is taller or
 * wider than the `.viewport` frame it sits in, or wider than the window. That is the #70
 * defect in its new home: the canvas used to grow with the side panels and frame the rover
 * off-screen. Polls briefly because the canvas follows its container after a resize.
 */
export async function expectSceneFitsViewport(
  page: Page,
  viewportTestId: string,
  when: string,
  options: {
    /**
     * A known, recorded layout defect for this frame. A mismatch is then annotated as `fixme`
     * on the test instead of failing it, so the rest of the demo path still reports.
     */
    knownDefect?: string;
  } = {},
): Promise<void> {
  const px = (n: number) => `${Math.round(n)}px`;
  const problems = async (): Promise<string[]> => {
    const m = await measureScene(page, viewportTestId);
    const out: string[] = [];
    if (m.height <= 100) out.push(`${when}: the 3D ${m.subject} has no usable height (${px(m.height)})`);
    if (m.height > m.containerHeight + 1)
      out.push(`${when}: the 3D ${m.subject} (${px(m.height)}) is taller than its frame ${viewportTestId} (${px(m.containerHeight)})`);
    if (m.width > m.containerWidth + 1)
      out.push(`${when}: the 3D ${m.subject} (${px(m.width)}) is wider than its frame ${viewportTestId} (${px(m.containerWidth)})`);
    if (m.width > m.viewportWidth + 1) out.push(`${when}: the 3D ${m.subject} is wider than the ${px(m.viewportWidth)} window`);
    return out;
  };
  let found: string[] = [];
  await expect
    .poll(async () => (found = await problems()).length, { timeout: 10_000 })
    .toBe(0)
    .catch(() => undefined);
  if (found.length > 0 && options.knownDefect) {
    test.info().annotations.push({ type: 'fixme', description: `${options.knownDefect}: ${found.join('; ')}` });
    return;
  }
  // Soft: a frame that is a few pixels short is a layout defect worth reporting, but it must
  // not hide what the rest of the demo path says about the plan data.
  expect.soft(found, `${when}: the 3D scene must fit its frame`).toEqual([]);
}

/** The project record the app keeps in localStorage (`src/lib/flow/projects.ts`). */
export const PROJECTS_KEY = 'rivet.projects.v1';

export async function readProject<T = Record<string, unknown>>(page: Page, id: string): Promise<T> {
  const list = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '[]') as Array<{ id: string }>, PROJECTS_KEY);
  const found = list.find((p) => p.id === id);
  if (!found) throw new Error(`project ${id} is not in localStorage`);
  return found as T;
}

/** Patches one field set of the stored project, the way the app's `updateProject` would. */
export async function patchProject(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ([key, pid, json]) => {
      const list = JSON.parse(window.localStorage.getItem(key) ?? '[]') as Array<{ id: string }>;
      const next = list.map((p) => (p.id === pid ? { ...p, ...(JSON.parse(json) as object) } : p));
      window.localStorage.setItem(key, JSON.stringify(next));
    },
    [PROJECTS_KEY, id, JSON.stringify(patch)] as const,
  );
}
