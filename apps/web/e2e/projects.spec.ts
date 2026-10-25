import { expect, test } from '@playwright/test';
import { expectUrl, EXAMPLE_ID, exampleProject, projectRecord, readProjects, seedProjects, watchPageErrors } from './helpers';

test.describe('Projects', () => {
  test('empty state offers a new project and the example', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/projects');
    await expect(page.getByTestId('projects-empty')).toBeVisible();
    await expect(page.getByTestId('projects-new')).toHaveAttribute('href', '/new');

    await page.getByTestId('projects-example').click();
    await expectUrl(page, /\/p\/p_[a-z0-9]+\/review$/);
    await expect(page.getByTestId('review-step')).toBeVisible();
    const [project] = await readProjects(page);
    expect(project).toMatchObject({ exampleId: EXAMPLE_ID, phase: 'ready' });
    expect(errors).toEqual([]);
  });

  test('lists where each project is; rename, duplicate and delete persist', async ({ page }) => {
    const errors = watchPageErrors(page);
    const ready = exampleProject({ id: 'p_e2eready', furthestStep: 'wiring' });
    const clarifying = projectRecord({ id: 'p_e2eclarify', prompt: 'A line follower for my desk', phase: 'clarify' });
    await seedProjects(page, [ready, clarifying]);

    await page.goto('/projects');
    const list = page.getByTestId('projects-list');
    await expect(list).toBeVisible();
    const cards = list.locator('[data-testid^="projects-card-"]');
    await expect(cards).toHaveCount(2);
    await expect(page.getByTestId(`projects-card-${ready.id}`)).toContainText('Step 3 of 5');
    await expect(page.getByTestId(`projects-card-${clarifying.id}`)).toContainText('Clarifying');

    // Rename
    await page.getByTestId(`projects-menu-${ready.id}`).click();
    await page.getByTestId('projects-rename').click();
    await expect(page.getByTestId('projects-rename-modal')).toBeVisible();
    await expect(page.getByTestId('projects-rename-input')).toHaveValue(ready.title);
    await page.getByTestId('projects-rename-input').fill('Desk rover');
    await page.getByTestId('projects-rename-save').click();
    await expect(page.getByTestId('projects-rename-modal')).toHaveCount(0);
    await expect(page.getByTestId(`projects-card-${ready.id}`)).toContainText('Desk rover');

    // Duplicate
    await page.getByTestId(`projects-menu-${ready.id}`).click();
    await page.getByTestId('projects-duplicate').click();
    await expect(cards).toHaveCount(3);
    await expect(list).toContainText('Desk rover (copy)');

    // Delete asks first, then removes only that project.
    await page.getByTestId(`projects-menu-${clarifying.id}`).click();
    await page.getByTestId('projects-delete').click();
    const confirm = page.getByTestId('projects-delete-modal');
    await expect(confirm).toContainText('A line follower for my desk');
    await page.getByTestId('projects-delete-cancel').click();
    await expect(cards).toHaveCount(3);
    await page.getByTestId(`projects-menu-${clarifying.id}`).click();
    await page.getByTestId('projects-delete').click();
    await page.getByTestId('projects-delete-confirm').click();
    await expect(page.getByTestId(`projects-card-${clarifying.id}`)).toHaveCount(0);
    await expect(cards).toHaveCount(2);

    // Everything above is in localStorage, so a reload shows the same list.
    await page.reload();
    await expect(cards).toHaveCount(2);
    const saved = await readProjects(page);
    expect(saved.map((p) => p.title).sort()).toEqual(['Desk rover', 'Desk rover (copy)']);
    expect(saved.find((p) => p.id === clarifying.id)).toBeUndefined();

    // Opening a card resumes at its furthest step.
    await page.getByRole('link', { name: 'Open Desk rover', exact: true }).click();
    await expectUrl(page, `/p/${ready.id}/wiring`);
    await expect(page.getByTestId('wiring-step')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
