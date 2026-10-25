import { expect, test } from '@playwright/test';
import { expectUrl, ACCOUNT_KEY, DRAFT_KEY, EXAMPLE_ID, readJson, readProjects, watchPageErrors } from './helpers';

const PROMPT = 'A two-wheel ESP32 robot that stops 40 cm from a wall';

test.describe('Landing', () => {
  test('Build it previews, Save and continue stores a local account and hands the draft to /new', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/');
    await expect(page.getByTestId('home-page')).toBeVisible();

    await page.getByTestId('home-prompt-input').fill(PROMPT);
    await page.getByTestId('home-prompt-submit').click();

    const preview = page.getByTestId('guest-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Here is what Rivet will make');
    await expect(preview).toContainText('Nothing is generated yet');
    await expect(preview).toContainText(PROMPT);
    // No project exists yet: the preview generates nothing.
    expect(await readProjects(page)).toEqual([]);

    await page.getByTestId('preview-continue').click();
    const save = page.getByTestId('save-modal');
    await expect(save).toBeVisible();
    await expect(preview).toBeHidden();

    // A bad email is refused in place.
    await page.getByTestId('save-email').fill('not-an-email');
    await page.getByTestId('save-continue-email').click();
    await expect(save.getByRole('alert')).toContainText('Enter an email address');
    await expect(save).toBeVisible();

    await page.getByTestId('save-email').fill('becca@example.edu');
    await page.getByTestId('save-continue-email').click();

    await expectUrl(page, /\/new\?draft=p_[a-z0-9]+$/);
    const draftId = new URL(page.url()).searchParams.get('draft')!;
    const stored = await readJson<{ id: string; text: string }>(page, DRAFT_KEY);
    expect(stored).toEqual({ id: draftId, text: PROMPT });
    expect(await readJson<{ email: string; provider: string }>(page, ACCOUNT_KEY)).toMatchObject({
      email: 'becca@example.edu',
      provider: 'email',
    });

    // The app prompt restores the same text under the same draft id and submits it as that project.
    await expect(page.getByTestId('new-prompt-input')).toHaveValue(PROMPT);
    await expect(page.getByLabel('Saved as becca@example.edu')).toBeVisible();
    await page.getByTestId('new-prompt-submit').click();
    await expectUrl(page, `/p/${draftId}/clarify`);
    const [project] = await readProjects(page);
    expect(project).toMatchObject({ id: draftId, prompt: PROMPT, phase: 'clarify' });

    expect(errors).toEqual([]);
  });

  test('a saved account skips the save modal next time', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.addInitScript(
      ([key, json]) => window.localStorage.setItem(key, json),
      [ACCOUNT_KEY, JSON.stringify({ email: 'becca@example.edu', provider: 'google', savedAt: new Date().toISOString() })] as const,
    );
    await page.goto('/');
    await page.getByTestId('home-prompt-input').fill(PROMPT);
    await page.getByTestId('home-prompt-submit').click();
    await page.getByTestId('preview-continue').click();
    await expectUrl(page, /\/new\?draft=p_/);
    await expect(page.getByTestId('save-modal')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('See an example saves a ready project and opens its Review step', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/');
    await page.getByTestId('home-see-example').click();

    await expectUrl(page, /\/p\/p_[a-z0-9]+\/review$/);
    await expect(page.getByTestId('review-step')).toBeVisible();
    await expect(page.getByTestId('project-title')).toHaveText('Indoor obstacle rover (example)');
    await expect(page.getByTestId('stepper')).toBeVisible();
    await expect(page.getByTestId('stepper-review')).toHaveAttribute('data-state', 'current');

    const [project] = await readProjects(page);
    expect(project).toMatchObject({ exampleId: EXAMPLE_ID, buildId: EXAMPLE_ID, phase: 'ready', furthestStep: 'review' });
    // The 3D view shows that build.
    await expect(page.getByTestId('rover-scene').first()).toHaveAttribute('data-build-id', EXAMPLE_ID);
    expect(errors).toEqual([]);
  });

  test('the retired /studio route redirects into the flow', async ({ page }) => {
    await page.goto('/studio?prompt=Build%20a%20desk%20rover');
    await expectUrl(page, /\/new\?prompt=Build(%20|\+| )a(%20|\+| )desk(%20|\+| )rover$/);
    await expect(page.getByTestId('new-prompt-input')).toHaveValue('Build a desk rover');

    await page.goto('/studio');
    await expectUrl(page, /\/projects$/);
    await expect(page.getByTestId('projects-screen')).toBeVisible();
  });
});
