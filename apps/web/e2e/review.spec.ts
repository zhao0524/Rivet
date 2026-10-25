import { expect, test } from '@playwright/test';
import { blockers } from '../src/lib/flow/derive';
import { expectUrl, pickOverflow, readProject, seedExample, SOURCED_PLAN, watchPageErrors } from './helpers';

const EXPECTED_BLOCKERS = blockers(SOURCED_PLAN);

test.describe('Review', () => {
  test('shows only the blocking checks; a fix fails offline with the engine reason; continuing unlocks Parts', async ({ page }) => {
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
      await expect(card.getByTestId('review-fix')).toHaveCount(1);
    }
    // Advisory warnings stay off this screen.
    await expect(page.getByTestId('review-step')).not.toContainText('brown-out');
    // Later steps are locked until Review is continued.
    await expect(page.getByTestId('stepper-parts')).toHaveAttribute('data-state', 'locked');
    const primary = page.getByTestId('review-primary');
    await expect(primary).toBeEnabled();
    await expect(page.getByTestId('review-step')).toContainText(`${EXPECTED_BLOCKERS.length} checks are unresolved`);
    await expect(page.getByTestId('review-assumptions')).toContainText('Assumptions (1)');

    // Fix this → offline fixtures cannot validate edits, and the card says so instead of pretending.
    const first = cards.first();
    const rule = await first.getAttribute('data-rule');
    await first.getByTestId('review-fix').click();
    const failed = first.getByTestId('review-fix-failed');
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("Couldn't fix this automatically.");
    await expect(failed).toContainText('edits cannot be validated in fixture mode');
    await expect(first.getByTestId('review-fix')).toHaveText('Try the fix again');
    await expect(cards).toHaveCount(EXPECTED_BLOCKERS.length);
    const swap = first.getByTestId('review-swap-manually');
    const affected = EXPECTED_BLOCKERS[0]!.affected_instance_ids.find((id) => id !== 'chassis-1')!;
    await expect(swap).toHaveAttribute('href', `/p/${record.id}/parts?part=${affected}`);
    expect(rule).toBe(EXPECTED_BLOCKERS[0]!.rule_id);

    // The scene focuses the blocker's part.
    await expect(page.getByTestId('review-viewport')).toContainText('Showing');

    await primary.click();
    await expectUrl(page, `/p/${record.id}/parts`);
    await expect(page.getByTestId('parts-step')).toBeVisible();
    await expect(page.getByTestId('stepper-review')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('stepper-parts')).toHaveAttribute('data-state', 'current');
    expect(await readProject(page, record.id)).toMatchObject({ reviewDone: true, furthestStep: 'parts' });

    expect(errors).toEqual([]);
  });

  test('"Change something" shows the engine reason when the edit is not accepted', async ({ page }) => {
    const errors = watchPageErrors(page);
    const record = await seedExample(page);
    await page.goto(`/p/${record.id}/review`);
    await expect(page.getByTestId('review-blocker').first()).toBeVisible();

    await pickOverflow(page, 'overflow-iterate');
    const modal = page.getByTestId('iterate');
    await expect(modal).toBeVisible();
    await page.getByTestId('iterate-example').first().click();
    await expect(page.getByTestId('iterate-text')).toHaveValue('Increase obstacle stop distance to 0.40 m');
    await page.getByTestId('iterate-apply').click();

    const reason = page.getByTestId('iterate-reason');
    await expect(reason).toBeVisible();
    await expect(reason).toContainText('edits cannot be validated in fixture mode');
    await expect(reason).toContainText('Increase obstacle stop distance to 0.40 m');
    // The text stays so it can be retried on the live engine; the modal did not close.
    await expect(page.getByTestId('iterate-text')).toHaveValue('Increase obstacle stop distance to 0.40 m');
    await expect(modal).toBeVisible();
    expect((await readProject(page, record.id)).revision).toBeNull();

    await page.getByTestId('iterate-discard').click();
    await expect(modal).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
