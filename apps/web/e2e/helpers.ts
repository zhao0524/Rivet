import type { Page } from '@playwright/test';

const IGNORED_CONSOLE_ERRORS = [/favicon/i, /Download the React DevTools/i, /net::ERR_INTERNET_DISCONNECTED/i];

/**
 * Collects uncaught page exceptions and console error messages for the life of
 * a test. Returns a live array; assert on it after the flow has run.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}
