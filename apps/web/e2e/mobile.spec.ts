import { expect, test } from '@playwright/test';
import { exampleProject, expectNoHorizontalScroll, projectRecord, seedProjects, SOURCED_PLAN, watchPageErrors } from './helpers';

const STEPS = ['review', 'parts', 'wiring', 'buy', 'build', 'done'] as const;

test.describe('Mobile layout (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no screen scrolls sideways', async ({ page }) => {
    // A dozen screens, most with a 3D scene: give it the long timeout.
    test.slow();
    const errors = watchPageErrors(page);
    const ready = exampleProject({ furthestStep: 'done', buildStep: 4, acknowledgedSteps: [4] });
    const clarifying = projectRecord({ id: 'p_e2emclar', prompt: 'A cheap indoor rover with a distance sensor', phase: 'clarify' });
    const generating = projectRecord({ id: 'p_e2emgen', prompt: 'A cheap indoor rover with a distance sensor', phase: 'generating' });
    await seedProjects(page, [ready, clarifying, generating]);

    await page.goto('/');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expectNoHorizontalScroll(page, 'landing');
    await page.getByTestId('home-prompt-input').fill('A tiny rover');
    await page.getByTestId('home-prompt-submit').click();
    await expect(page.getByTestId('save-modal')).toBeVisible();
    await expectNoHorizontalScroll(page, 'sign in');
    await page.keyboard.press('Escape');

    await page.goto('/projects');
    await expect(page.getByTestId('projects-list')).toBeVisible();
    await expectNoHorizontalScroll(page, 'projects');

    await page.goto('/new');
    await expect(page.getByTestId('new-prompt')).toBeVisible();
    await expectNoHorizontalScroll(page, 'new');

    // The workspace shows one panel at a time on a phone; none of them scrolls sideways.
    await page.goto(`/p/${clarifying.id}/workspace`);
    await expect(page.getByTestId('workspace-question-budget')).toBeAttached();
    for (const pane of ['model', 'files', 'chat'] as const) {
      await page.getByTestId(`workspace-tab-${pane}`).click();
      await expectNoHorizontalScroll(page, `workspace ${pane}`);
    }

    await page.goto(`/p/${generating.id}/workspace`);
    await expect(page.getByTestId('workspace-question-budget')).toBeAttached();
    await expectNoHorizontalScroll(page, 'workspace after a reload mid-build');

    for (const step of STEPS) {
      await page.goto(`/p/${ready.id}/${step}`);
      await expect(page.getByTestId(`${step}-step`)).toBeVisible();
      // Buy is the one step without a 3D scene; its list is the "ready" signal there.
      if (step === 'buy') await expect(page.getByTestId('buy-vendors')).toBeVisible();
      else await expect(page.getByTestId('rover-scene').first()).toHaveAttribute('data-build-id', SOURCED_PLAN.build_id);
      await expectNoHorizontalScroll(page, step);
    }

    // Modals too: the spec drawer and the cart.
    await page.goto(`/p/${ready.id}/parts?part=controller-1`);
    await expect(page.getByTestId('spec-drawer')).toBeVisible();
    await expectNoHorizontalScroll(page, 'spec drawer');
    await page.goto(`/p/${ready.id}/buy`);
    await page.getByTestId('buy-primary').click();
    await expect(page.getByTestId('buy-cart')).toBeVisible();
    await expectNoHorizontalScroll(page, 'cart');

    expect(errors).toEqual([]);
  });
});
