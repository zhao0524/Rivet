import { expect, type Locator, type Page } from '@playwright/test';
import type { ProjectRecord } from '../src/lib/flow/projects';
import type { StepId } from '../src/lib/flow/steps';
import type { BuildPlan } from '../src/lib/rivet/types';
import rawSourcedPlan from '../src/lib/rivet/fixtures/sourced-rover-obstacle-v1.json';

const IGNORED_CONSOLE_ERRORS = [/favicon/i, /Download the React DevTools/i, /net::ERR_INTERNET_DISCONNECTED/i];

/**
 * Collects uncaught page exceptions and console error messages for the life of
 * a test. Returns a live array; assert on it after the flow has run.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

/* ── Fixture data the specs assert against ─────────────── */

/** The sourced saved example that "See an example" opens (`src/lib/fixtures.ts`). */
export const EXAMPLE_ID = 'rivet-intent-rover-001';
/** Its checked-in plan, so expectations come from the data, not from retyped numbers. */
export const SOURCED_PLAN = rawSourcedPlan as unknown as BuildPlan;

export const PROJECTS_KEY = 'rivet.projects.v1';
export const DRAFT_KEY = 'rivet.draft.v1';
export const ACCOUNT_KEY = 'rivet.account.v1';
export const THEME_KEY = 'rivet.theme';

/* ── Projects in localStorage ──────────────────────────── */

let seq = 0;

/** A `ProjectRecord` with the same defaults as `createProjectRecord`, for seeding. */
export function projectRecord(input: Partial<ProjectRecord> & { prompt: string }): ProjectRecord {
  const now = new Date().toISOString();
  seq += 1;
  return {
    id: input.id ?? `p_e2e${seq.toString(36)}${Date.now().toString(36).slice(-4)}`,
    title: input.title ?? input.prompt,
    prompt: input.prompt,
    imageAssetId: input.imageAssetId ?? null,
    imagePreviewUrl: input.imagePreviewUrl ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    phase: input.phase ?? 'draft',
    intentId: input.intentId ?? null,
    assumptions: input.assumptions ?? [],
    clarify: input.clarify ?? { max_budget: null, max_length_mm: null },
    exampleId: input.exampleId ?? null,
    buildId: input.buildId ?? null,
    revision: input.revision ?? null,
    furthestStep: input.furthestStep ?? 'review',
    reviewDone: input.reviewDone ?? false,
    ownedCatalogIds: input.ownedCatalogIds ?? [],
    buildStep: input.buildStep ?? 0,
    acknowledgedSteps: input.acknowledgedSteps ?? [],
    missingCatalogIds: input.missingCatalogIds ?? [],
    completedAt: input.completedAt ?? null,
  };
}

/** A ready project on the sourced saved example, as "See an example" creates it. */
export function exampleProject(patch: Partial<ProjectRecord> = {}): ProjectRecord {
  return projectRecord({
    prompt: 'Indoor obstacle rover',
    title: 'Indoor obstacle rover (example)',
    exampleId: EXAMPLE_ID,
    buildId: EXAMPLE_ID,
    phase: 'ready',
    assumptions: ['Runs indoors on a flat floor'],
    ...patch,
  });
}

/**
 * Seeds the projects list before any page script runs. Only fills the key when it is still
 * empty, so progress the app saves during the test survives a reload.
 */
export async function seedProjects(page: Page, records: readonly ProjectRecord[]): Promise<void> {
  await page.addInitScript(
    ([key, json]) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, json);
      } catch {
        // Blocked storage: the app degrades to memory and the test will show it.
      }
    },
    [PROJECTS_KEY, JSON.stringify(records)] as const,
  );
}

/** Seeds one ready example project and returns its record. */
export async function seedExample(page: Page, patch: Partial<ProjectRecord> = {}): Promise<ProjectRecord> {
  const record = exampleProject(patch);
  await seedProjects(page, [record]);
  return record;
}

export async function readProjects(page: Page): Promise<ProjectRecord[]> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '[]') as ProjectRecord[], PROJECTS_KEY);
}

export async function readProject(page: Page, id: string): Promise<ProjectRecord> {
  const found = (await readProjects(page)).find((p) => p.id === id);
  if (!found) throw new Error(`project ${id} is not in localStorage`);
  return found;
}

export async function readJson<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }, key) as Promise<T | null>;
}

/* ── Navigation ────────────────────────────────────────── */

export function stepPath(id: string, step: StepId | 'clarify' | 'generate'): string {
  return `/p/${id}/${step}`;
}

/**
 * URL after a client-side push. Longer than the default expect timeout because `next dev`
 * compiles a route the first time it is requested, and the URL only changes once it answers.
 */
export async function expectUrl(page: Page, url: string | RegExp): Promise<void> {
  await expect(page).toHaveURL(url, { timeout: 45_000 });
}

/** Opens a step and waits for its frame (the build may still be loading). */
export async function gotoStep(page: Page, id: string, step: StepId | 'clarify' | 'generate'): Promise<void> {
  await page.goto(stepPath(id, step));
  await expect(page.getByTestId(`${step}-step`).or(page.getByTestId(`${step}-screen`))).toBeVisible();
}

/** Opens the step footer's overflow menu and picks one item. */
export async function pickOverflow(page: Page, itemTestId: string): Promise<void> {
  await page.getByTestId('step-overflow').click();
  const item = page.getByTestId(itemTestId);
  await expect(item).toBeVisible();
  await item.click();
}

/* ── Layout ────────────────────────────────────────────── */

/** The page must not scroll sideways (390 px rule from the brief). */
export async function expectNoHorizontalScroll(page: Page, when: string): Promise<void> {
  // Polled: canvases size themselves and reveal animations finish a moment after the screen reports ready.
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  try {
    await expect.poll(overflow, { timeout: 10_000 }).toBeLessThanOrEqual(0);
  } catch {
    // Name what sticks out, so a failure here points at the element, not just the number.
    const detail = await page.evaluate(() => {
      const w = window.innerWidth;
      const offenders: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.right <= w + 1 && r.width <= w + 1) continue;
        const id = el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : '';
        const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        offenders.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(r.right)} width=${Math.round(r.width)}`);
      }
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth: w, offenders: offenders.slice(0, 12) };
    });
    throw new Error(
      `${when}: document.documentElement.scrollWidth ${detail.scrollWidth} > window.innerWidth ${detail.innerWidth}\n` +
        (detail.offenders.length ? `elements past the right edge:\n  ${detail.offenders.join('\n  ')}` : 'no element box is wider than the viewport (transform or scroll container?)'),
    );
  }
}

/** Ticks a checkbox-like control (the app renders real `<input type=checkbox>`). */
export async function setChecked(control: Locator, checked: boolean): Promise<void> {
  if ((await control.isChecked()) !== checked) await control.click();
  await expect(control).toBeChecked({ checked });
}
