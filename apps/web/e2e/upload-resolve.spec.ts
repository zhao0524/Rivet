import { expect, test } from '@playwright/test';
import path from 'node:path';
import { watchPageErrors } from './helpers';

const IMAGE = path.resolve(__dirname, '../../../fixtures/images/rover-reference.png');

test('uploading an image reaches a resolution with per-part evidence (fixture outcome)', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/studio?start=upload');
  const intake = page.getByRole('dialog', { name: 'New build' });
  await intake.getByTestId('image-dropzone-input').setInputFiles(IMAGE);
  await expect(intake.getByText(/not uploaded yet/)).toBeVisible();
  await intake.getByRole('button', { name: 'Upload and generate' }).click();
  await expect(intake).toBeHidden();

  await page.goto('/studio?resolve=exact_match');
  const dialog = page.getByRole('dialog', { name: 'Product match' });
  await expect(dialog.getByTestId('resolve-result')).toHaveAttribute('data-outcome', 'exact_match');
  await expect(dialog.getByTestId('resolve-saved-banner')).toContainText('not a live lookup');
  await expect(dialog.getByTestId('part-status').first()).toHaveText('Verified');
  expect(errors).toEqual([]);
});
