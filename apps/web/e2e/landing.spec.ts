import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectUrl, ACCOUNT_KEY, DRAFT_KEY, EXAMPLE_ID, readJson, readProjects, watchPageErrors } from './helpers';

const PROMPT = 'A two-wheel ESP32 robot that stops 40 cm from a wall';
const REFERENCE_IMAGE = path.resolve(__dirname, '../../../fixtures/images/rover-reference.png');

test.describe('Landing', () => {
  test('Build it signed out: sign in, then the workspace builds the prompt with no retyping', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/');
    await expect(page.getByTestId('home-page')).toBeVisible();

    await page.getByTestId('home-prompt-input').fill(PROMPT);
    await page.getByTestId('home-prompt-file').setInputFiles(REFERENCE_IMAGE);
    await page.getByTestId('home-prompt-submit').click();

    // No preview modal: signing in is the only step.
    await expect(page.getByTestId('guest-preview')).toHaveCount(0);
    const save = page.getByTestId('save-modal');
    await expect(save).toBeVisible();
    await expect(save).toContainText('Sign in to build');

    // A bad email is refused in place.
    await page.getByTestId('save-email').fill('not-an-email');
    await page.getByTestId('save-continue-email').click();
    await expect(save.getByRole('alert')).toContainText('Enter an email address');
    await expect(save).toBeVisible();

    await page.getByTestId('save-email').fill('becca@example.edu');
    await page.getByTestId('save-continue-email').click();

    await expectUrl(page, /\/p\/p_[a-z0-9]+\/workspace$/);
    const id = page.url().split('/')[4]!;
    await expect(page.getByTestId('workspace-chat-prompt')).toContainText(PROMPT);
    await expect(page.getByTestId('workspace-question-budget')).toBeVisible();
    const [project] = await readProjects(page);
    // The picture went with it: uploaded in the workspace before Rivet read the prompt.
    expect(project).toMatchObject({ id, prompt: PROMPT, phase: 'ready' });
    expect(project!.imageAssetId).toBeTruthy();
    expect(await readJson(page, DRAFT_KEY)).toBeNull();
    expect(await readJson<{ email: string; provider: string }>(page, ACCOUNT_KEY)).toMatchObject({
      email: 'becca@example.edu',
      provider: 'email',
    });

    expect(errors).toEqual([]);
  });

  test('signed in, Build it goes straight to the workspace', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.addInitScript(
      ([key, json]) => window.localStorage.setItem(key, json),
      [ACCOUNT_KEY, JSON.stringify({ email: 'becca@example.edu', provider: 'google', savedAt: new Date().toISOString() })] as const,
    );
    await page.goto('/');
    await page.getByTestId('home-prompt-input').fill(PROMPT);
    await page.getByTestId('home-prompt-submit').click();
    await expectUrl(page, /\/p\/p_[a-z0-9]+\/workspace$/);
    await expect(page.getByTestId('save-modal')).toHaveCount(0);
    await expect(page.getByTestId('workspace-chat-prompt')).toContainText(PROMPT);
    expect(errors).toEqual([]);
  });

  test('See an example saves a ready project and opens its workspace', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/');
    await page.getByTestId('home-see-example').click();

    await expectUrl(page, /\/p\/p_[a-z0-9]+\/workspace$/);
    await expect(page.getByTestId('workspace')).toBeVisible();
    await expect(page.getByTestId('project-title')).toHaveText('Indoor obstacle rover (example)');
    // The name stands alone: no example or status tag next to it once the build is in.
    await expect(page.getByTestId('workspace-chat-built')).toBeVisible();
    await expect(page.getByTestId('workspace-status')).toHaveCount(0);

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
