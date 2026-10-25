import { expect, test } from '@playwright/test';
import { expectUrl, projectRecord, readProject, readProjects, seedProjects, watchPageErrors } from './helpers';

const PROMPT = 'Build a small rover that avoids obstacles';

test.describe('Prompt → Clarify → Generate', () => {
  test('three clarify cards with a budget choice, then the saved example loads and Review marks the project ready', async ({
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

    await expectUrl(page, /\/p\/p_[a-z0-9]+\/clarify$/);
    const id = page.url().split('/')[4]!;
    await expect(page.getByTestId('clarify-screen')).toBeVisible();

    // Card 1: what Rivet understood, honestly labelled offline.
    await expect(page.getByTestId('clarify-progress')).toHaveText('Question 1 of 3');
    await expect(page.getByTestId('clarify-understood')).toBeVisible();
    await expect(page.getByTestId('clarify-understood')).toContainText('The saved example is an indoor rover');
    await expect(page.getByTestId('clarify-offline')).toContainText("This is a saved example. Rivet didn't read your words");
    await expect(page.getByTestId('clarify-thinking-label')).toHaveText(/^Answered in \d/);
    await expect(page.getByTestId('clarify-thinking-steps').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('clarify-next')).toHaveText(/^Next/);
    await page.getByTestId('clarify-next').click();

    // Card 2: budget. A custom amount needs a number before Next works.
    await expect(page.getByTestId('clarify-progress')).toHaveText('Question 2 of 3');
    await expect(page.getByTestId('clarify-budget-none')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('clarify-budget-custom').click();
    await expect(page.getByTestId('clarify-next')).toBeDisabled();
    await page.getByTestId('clarify-budget-amount').fill('75');
    await expect(page.getByTestId('clarify-next')).toBeEnabled();
    await page.getByTestId('clarify-budget-50').click();
    await expect(page.getByTestId('clarify-budget-50')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('clarify-next').click();

    // Card 3: size, then Generate.
    await expect(page.getByTestId('clarify-progress')).toHaveText('Question 3 of 3');
    await expect(page.getByTestId('clarify-size-none')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('clarify-next')).toHaveText(/^Generate/);
    await page.getByTestId('clarify-next').click();

    await expectUrl(page, `/p/${id}/generate`);
    await expect(page.getByTestId('generate-screen')).toBeVisible();
    expect(await readProject(page, id)).toMatchObject({
      phase: 'generating',
      clarify: { max_budget: 50, max_length_mm: null, interpretation_choice: 'as_interpreted' },
    });

    // Fixture mode: the saved example arrives as one real event; nothing pretends to generate.
    await expect(page.getByTestId('generate-done')).toBeVisible();
    await expect(page.getByTestId('generate-fixture-note')).toContainText("This is a saved example. Rivet didn't design it from your words.");
    await expect(page.getByTestId('generate-thinking-label')).toHaveText('Loaded instantly');
    await expect(page.getByTestId('generate-thinking-steps').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('generate-status')).toHaveText(/^Done: \d+ parts, ready to review$/);
    await expect(page.getByTestId('generate-decided-parts')).toContainText(/Picked \d+ parts/);
    await expect(page.getByTestId('generate-decided-checks')).toContainText(/Ran \d+ checks/);
    // The folded trace reopens on click.
    await expect(page.getByTestId('generate-thinking-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('generate-thinking-toggle').click();
    await expect(page.getByTestId('generate-thinking-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('generate-thinking-steps')).toContainText('Opened a saved example');
    // The tree: parts open in plain groups; keyboard moves through it.
    const tree = page.getByTestId('generate-tree');
    await expect(page.getByTestId('generate-phase-parts')).toHaveAttribute('aria-expanded', 'true');
    await expect(tree).toContainText('Wheels & motors');
    await page.getByTestId('generate-phase-understand').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('generate-phase-understand')).toHaveAttribute('aria-expanded', 'true');
    await tree.getByText('Frame', { exact: true }).click();
    await page.getByTestId('generate-part-chassis-1').locator('> .tv-row').click();
    await expect(page.getByTestId('generate-part-chassis-1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('generate-picked')).toContainText('highlighted in the model');
    await expect(page.getByTestId('generate-viewport')).toBeVisible();
    await expect(page.getByTestId('generate-cancel')).toHaveCount(0);

    await page.getByTestId('generate-review').click();
    await expectUrl(page, `/p/${id}/review`);
    await expect(page.getByTestId('review-step')).toBeVisible();
    await expect(page.getByTestId('stepper')).toBeVisible();
    const project = await readProject(page, id);
    expect(project.phase).toBe('ready');
    expect(project.buildId).toBeTruthy();
    expect(project.furthestStep).toBe('review');
    await expect(page.getByTestId('rover-scene').first()).toHaveAttribute('data-build-id', project.buildId!);

    expect(errors).toEqual([]);
  });

  test('"Skip the rest" generates with the defaults', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = projectRecord({ id: 'p_e2eskip', prompt: PROMPT, phase: 'clarify' });
    await seedProjects(page, [record]);
    await page.goto(`/p/${record.id}/clarify`);
    await expect(page.getByTestId('clarify-understood')).toBeVisible();
    await page.getByTestId('clarify-skip').click();
    await expectUrl(page, `/p/${record.id}/generate`);
    expect(await readProject(page, record.id)).toMatchObject({
      phase: 'generating',
      clarify: { max_budget: null, max_length_mm: null },
    });
    await expect(page.getByTestId('generate-review')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('/p/:id resumes where the project is, and an unknown id says so', async ({ page }) => {
    const clarifying = projectRecord({ id: 'p_e2eclar', prompt: PROMPT, phase: 'clarify' });
    await seedProjects(page, [clarifying]);
    await page.goto(`/p/${clarifying.id}`);
    await expectUrl(page, `/p/${clarifying.id}/clarify`);

    await page.goto('/p/p_doesnotexist/review');
    await expect(page.getByTestId('project-missing')).toBeVisible();
    expect(await readProjects(page)).toHaveLength(1);
  });
});
