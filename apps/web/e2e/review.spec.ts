import { expect, test } from '@playwright/test';
import { blockers } from '../src/lib/flow/derive';
import { expectUrl, pickOverflow, readProject, seedExample, SOURCED_PLAN, watchPageErrors } from './helpers';

const EXPECTED_BLOCKERS = blockers(SOURCED_PLAN);

test.describe('Review', () => {
  test('keeps unresolved checks visible and offers inspection for saved examples', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page);
    await page.goto(`/p/${record.id}/review`);
    await expect(page.getByTestId('review-step')).toBeVisible();

    const cards = page.getByTestId('review-blocker');
    expect(EXPECTED_BLOCKERS.length).toBeGreaterThan(0);
    await expect(cards).toHaveCount(EXPECTED_BLOCKERS.length);
    for (const [i, finding] of EXPECTED_BLOCKERS.entries()) {
      const card = cards.nth(i);
      await expect(card).toHaveAttribute('data-rule', /./);
      await expect(card).toContainText(finding.message);
      await expect(card.getByTestId('review-fix')).toHaveCount(0);
      await expect(card.getByTestId('review-inspect')).toHaveCount(1);
      await expect(card).toContainText('Needs verification');
    }
    // Advisory warnings stay off this screen.
    await expect(page.getByTestId('review-step')).not.toContainText('brown-out');
    // Later steps are locked until Review is continued.
    await expect(page.getByTestId('stepper-parts')).toHaveAttribute('data-state', 'locked');
    const primary = page.getByTestId('review-primary');
    await expect(primary).toBeEnabled();
    await expect(primary).toHaveText('Review parts and open checks');
    await expect(page.getByTestId('review-step')).toContainText(`${EXPECTED_BLOCKERS.length} problems are still open`);
    await expect(page.getByTestId('review-assumptions')).toContainText('What Rivet assumed (1)');
    // Plain headlines lead each card; no rule-id title reaches the screen.
    await expect(cards.first().getByRole('heading', { level: 3 })).toHaveText('The left motor may not fit the frame');
    await expect(page.getByTestId('review-step')).not.toContainText('Fit evidence');
    await expect(page.getByTestId('review-saved-note')).toContainText("Rivet didn't design it from your words");

    // Saved examples offer inspection instead of an edit that always fails.
    const first = cards.first();
    const rule = await first.getAttribute('data-rule');
    await expect(cards).toHaveCount(EXPECTED_BLOCKERS.length);
    const swap = first.getByTestId('review-inspect');
    const affected = EXPECTED_BLOCKERS[0]!.affected_instance_ids.find((id) => id !== 'chassis-1')!;
    await expect(swap).toHaveAttribute('href', `/p/${record.id}/parts?part=${affected}`);
    expect(rule).toBe(EXPECTED_BLOCKERS[0]!.rule_id);

    await primary.click();
    await expectUrl(page, `/p/${record.id}/parts`);
    await expect(page.getByTestId('parts-step')).toBeVisible();
    await expect(page.getByTestId('stepper-review')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('stepper-parts')).toHaveAttribute('data-state', 'current');
    expect(await readProject(page, record.id)).toMatchObject({ reviewDone: true, furthestStep: 'parts' });

    expect(errors).toEqual([]);
  });

  test('"Change something" on an example offers a new project without sending an unsupported edit', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page);
    await page.goto(`/p/${record.id}/review`);
    await expect(page.getByTestId('review-blocker').first()).toBeVisible();

    await pickOverflow(page, 'overflow-iterate');
    const modal = page.getByTestId('iterate');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('cannot be edited');
    await expect(page.getByTestId('iterate-apply')).toHaveCount(0);
    await expect(modal.getByRole('link', { name: 'Start a new build' })).toHaveAttribute('href', '/new');
    expect((await readProject(page, record.id)).revision).toBeNull();

    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
