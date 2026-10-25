import { expect, test } from '@playwright/test';
import { expectUrl, projectRecord, readProject, readProjects, seedProjects, watchPageErrors } from './helpers';

const PROMPT = 'Build a small rover that avoids obstacles';

test.describe('Prompt → workspace', () => {
  test('a prompt goes straight to the workspace: Rivet reads it, builds it, then asks about budget and size in the chat', async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.goto('/new');
    await expect(page.getByTestId('new-screen')).toBeVisible();

    // A sample chip fills the box; typing replaces it.
    await page.getByTestId('new-sample').first().click();
    await expect(page.getByTestId('new-prompt-input')).not.toHaveValue('');
    await page.getByTestId('new-prompt-input').fill(PROMPT);
    await page.getByTestId('new-prompt-submit').click();

    // No clarify or generate screens in between.
    await expectUrl(page, /\/p\/p_[a-z0-9]+\/workspace$/);
    const id = page.url().split('/')[4]!;
    await expect(page.getByTestId('workspace-chat-prompt')).toContainText(PROMPT);

    // What Rivet read, honestly labelled offline, then what it built.
    await expect(page.getByTestId('workspace-chat-understood')).toContainText('The saved example is an indoor rover');
    await expect(page.getByTestId('workspace-chat-offline')).toContainText("isn't connected");
    await expect(page.getByTestId('workspace-chat-built')).toContainText(/Picked \d+ parts/);
    await expect(page.getByTestId('workspace-chat-built')).toContainText("This is a saved example. Rivet didn't design it from your words.");
    const built = await readProject(page, id);
    expect(built.phase).toBe('ready');
    expect(built.buildId).toBeTruthy();
    await expect(page.getByTestId('rover-scene').first()).toHaveAttribute('data-build-id', built.buildId!);

    // Budget: a custom amount needs a number; a preset answers it and rebuilds within it.
    await expect(page.getByTestId('workspace-question-budget')).toBeVisible();
    await page.getByTestId('workspace-answer-budget-custom').click();
    await expect(page.getByTestId('workspace-answer-budget-set')).toBeDisabled();
    await page.getByTestId('workspace-answer-budget-amount').fill('75');
    await expect(page.getByTestId('workspace-answer-budget-set')).toBeEnabled();
    await page.getByTestId('workspace-answer-budget-50').click();
    await expect(page.getByTestId('workspace-question-size')).toBeVisible();
    await page.getByTestId('workspace-answer-size-none').click();
    await expect(page.getByTestId('workspace-chat-wrap')).toBeVisible();
    expect(await readProject(page, id)).toMatchObject({
      phase: 'ready',
      clarify: { max_budget: 50, max_length_mm: null, interpretation_choice: 'as_interpreted' },
    });

    // The Build tab is Buy then Build. It starts closed, with a hint beside Buy that goes once Buy is opened.
    await expect(page.getByTestId('workspace-guide-review')).toHaveCount(0);
    await expect(page.getByTestId('workspace-guide-buy-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('workspace-start-hint')).toContainText('Step 1: Buy');
    await page.getByTestId('workspace-guide-buy-toggle').click();
    await expect(page.getByTestId('workspace-start-hint')).toHaveCount(0);
    await expect(page.getByTestId('workspace-buy-total')).toContainText('$110.80');

    // The Parts tab: a part's store, picked in the model, and the printed body as a file to print.
    await page.getByTestId('workspace-tab-left-parts').click();
    await page.getByTestId('workspace-component-board.esp32_devkitc_v4_wroom32e').click();
    await expect(page.getByTestId('workspace-component-buy')).toContainText('Buy at Adafruit');
    await expect(page.getByTestId('workspace-picked')).toBeVisible();
    await page.getByTestId('workspace-component-printed-body').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('workspace-export-obj').click();
    expect((await download).suggestedFilename()).toMatch(/printed-body\.obj$/);

    // Saves show at the top right; Save and publish puts it in the community gallery.
    await page.getByTestId('workspace-save').click();
    await expect(page.getByTestId('workspace-saved')).toContainText('Saved just now');
    await page.getByTestId('workspace-publish').click();
    await page.getByTestId('publish-confirm').click();
    await expect(page.getByTestId('workspace-toast')).toContainText('published');
    expect((await readProject(page, id)).publishedAt).toBeTruthy();

    // The chat and the guide survive a reload.
    await page.reload();
    await expect(page.getByTestId('workspace-chat-wrap')).toBeVisible();
    await expect(page.getByTestId('workspace-guide-buy-toggle')).toHaveAttribute('aria-expanded', 'true');

    // Each guide step links to its full page, which links back here.
    await page.getByTestId('workspace-guide-buy-full').click();
    await expectUrl(page, `/p/${id}/buy`);
    await expect(page.getByTestId('buy-step')).toBeVisible();
    await page.getByTestId('stepper-workspace').click();
    await expectUrl(page, `/p/${id}/workspace`);

    expect(errors).toEqual([]);
  });

  test('a reload mid-build starts the build again', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = projectRecord({ id: 'p_e2egen', prompt: PROMPT, phase: 'generating' });
    await seedProjects(page, [record]);
    await page.goto(`/p/${record.id}/workspace`);
    await expect(page.getByTestId('workspace-question-budget')).toBeVisible();
    expect((await readProject(page, record.id)).phase).toBe('ready');
    expect(errors).toEqual([]);
  });

  test('/p/:id and old clarify links open the workspace, and an unknown id says so', async ({ page }) => {
    const clarifying = projectRecord({ id: 'p_e2eclar', prompt: PROMPT, phase: 'clarify' });
    await seedProjects(page, [clarifying]);
    await page.goto(`/p/${clarifying.id}`);
    await expectUrl(page, `/p/${clarifying.id}/workspace`);
    await page.goto(`/p/${clarifying.id}/clarify`);
    await expectUrl(page, `/p/${clarifying.id}/workspace`);

    await page.goto('/p/p_doesnotexist/review');
    await expect(page.getByTestId('project-missing')).toBeVisible();
    expect(await readProjects(page)).toHaveLength(1);
  });
});
