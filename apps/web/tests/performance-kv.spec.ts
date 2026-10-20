import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — logistics, hospitality and technical a line at a time (Marco,
 * 2026-10-20): «+ add line», a key and a value, «saved» on the row, it
 * survives a reload, it can be edited and removed. Saved in place
 * (ADR-139 p7): no button to save. The spec owns its line and removes it,
 * so the fixture gig ends as it started.
 */

async function openDetails(page: Page) {
  const lid = page.getByTestId('record-details').locator('button.lid');
  if ((await lid.getAttribute('aria-expanded')) !== 'true') await lid.click();
}

const KEY = `zzz e2e ${Date.now()}`;

test.describe('performance production lines', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('add → reload → edit → remove a hospitality line', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/h/playwright/performance/zzz-e2e-1');
    await waitForLoaded(page);
    await openDetails(page);

    const block = page.getByTestId('perf-hospitality');
    await block.getByRole('button', { name: '+ add line' }).click();
    await block.getByLabel('key', { exact: true }).fill(KEY);
    await block.getByLabel('value', { exact: true }).fill('Hotel Ibis');
    await block.getByLabel('value', { exact: true }).press('Enter');
    await expect(block.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();

    await page.reload();
    await waitForLoaded(page);
    await openDetails(page);
    const row = page.getByTestId('perf-hospitality').getByLabel(KEY, { exact: true });
    await expect(row).toHaveValue('Hotel Ibis');

    await row.fill('Hotel Central');
    await row.press('Enter');
    await expect(page.getByTestId('perf-hospitality').getByRole('status').filter({ hasText: 'saved' })).toBeVisible();

    await page.getByTestId('perf-hospitality').getByRole('button', { name: `Remove “${KEY}”` }).click();
    await expect(page.getByTestId('perf-hospitality').getByLabel(KEY, { exact: true })).toHaveCount(0);

    await page.reload();
    await waitForLoaded(page);
    await openDetails(page);
    await expect(page.getByTestId('perf-hospitality').getByLabel(KEY, { exact: true })).toHaveCount(0);
  });
});
