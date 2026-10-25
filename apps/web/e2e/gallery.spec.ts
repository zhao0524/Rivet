import { expect, test, type Locator } from '@playwright/test';
import { exampleProject, expectNoHorizontalScroll, expectUrl, EXAMPLE_ID, readProjects, seedProjects, watchPageErrors } from './helpers';

/** Computed opacity of a card's rim light. */
const rimOpacity = (card: Locator) => card.locator('.elc__rim').evaluate((el) => Number(getComputedStyle(el).opacity));

test.describe('Recent projects gallery (/new)', () => {
  test('hover lights the rim near the pointer, leaving puts it out; keyboard focus lights it too', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/new');
    const card = page.getByTestId('new-sample-card-quadcopter');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-lit', 'false');

    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 5 });
    await expect(card).toHaveAttribute('data-lit', 'true');
    await expect(card).toHaveAttribute('data-mode', 'pointer');
    await expect.poll(() => rimOpacity(card)).toBeGreaterThan(0.5);

    await page.mouse.move(2, 2);
    await expect(card).toHaveAttribute('data-lit', 'false');
    await expect.poll(() => rimOpacity(card)).toBe(0);

    // Keyboard: tab onto the card's button.
    const other = page.getByTestId('new-sample-card-electric-car');
    await page.getByTestId('new-sample-card-quadcopter').getByRole('button').focus();
    await page.keyboard.press('Tab');
    await expect(other).toHaveAttribute('data-mode', 'focus');
    await expect.poll(() => rimOpacity(other)).toBeGreaterThan(0.5);
    await page.keyboard.press('Tab');
    await expect(other).toHaveAttribute('data-lit', 'false');
    expect(errors).toEqual([]);
  });

  test('a sample idea fills and focuses the prompt; the rover sample opens the saved example', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/new');
    const card = page.getByTestId('new-sample-card-robot-arm');
    await expect(card).toContainText('Sample');
    await expect(card).toContainText('Robot arms are coming later. Rivet will build the closest rover.');
    await card.getByRole('button', { name: 'Start from this idea: Desk robot arm' }).click();
    const input = page.getByTestId('new-prompt-input');
    await expect(input).toHaveValue('A desk robot arm with a gripper that can pick up small blocks');
    await expect(input).toBeFocused();
    expect(await readProjects(page)).toEqual([]);

    await page.getByTestId('new-sample-example').click();
    await expectUrl(page, /\/p\/p_[a-z0-9]+\/workspace$/);
    await expect(page.getByTestId('workspace')).toBeVisible();
    const [project] = await readProjects(page);
    expect(project).toMatchObject({ exampleId: EXAMPLE_ID, buildId: EXAMPLE_ID, phase: 'ready' });
    expect(errors).toEqual([]);
  });

  test("the user's projects come first", async ({ page }) => {
    const mine = exampleProject({ id: 'p_e2egal', title: 'My desk rover', furthestStep: 'parts' });
    await seedProjects(page, [mine]);
    await page.goto('/new');
    const first = page.getByTestId('new-gallery-list').locator('li[data-kind]').first();
    await expect(first).toHaveAttribute('data-kind', 'project');
    await expect(first).toContainText('My desk rover');
    await expect(first.getByRole('link', { name: 'Open My desk rover' })).toHaveAttribute('href', `/p/${mine.id}`);
  });
});

test.describe('Gallery on a phone (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('one column and no sideways scroll on /new and /projects', async ({ page }) => {
    await seedProjects(page, [exampleProject({ id: 'p_e2egalm' })]);
    await page.goto('/new');
    const cards = page.getByTestId('new-gallery-list').locator('.elc');
    await expect(cards.first()).toBeVisible();
    const [a, b] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
    expect(Math.abs(a.x - b.x)).toBeLessThan(2);
    await expectNoHorizontalScroll(page, 'new gallery');
    await page.goto('/projects');
    await expect(page.getByTestId('projects-list')).toBeVisible();
    await expectNoHorizontalScroll(page, 'projects gallery');
  });
});
