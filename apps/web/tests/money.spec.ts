import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — Money lens (ADR-046): the lens renders, and the fee write path
 * round-trips (set → persist → clear) on a fixture gig in the test
 * user's own workspace. Self-cleaning: the fee ends null.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(EMAIL!);
  await page.locator('input[type=password]').fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\//);
}

test.describe('money lens', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('fee set → persists in totals → clear', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await page.goto('/h/playwright/money');
    await expect(page.locator('.mny__totals')).toBeVisible();

    // The fixture workspace has gigs (zzz-e2e-collab project). Pick the
    // first row's fee cell.
    const firstFee = page.locator('.mny__fee').first();
    await expect(firstFee).toBeVisible();

    // Set a fee.
    await firstFee.click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Amount').fill('1234.56');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.mny__fee').first()).toContainText('1,234.56', {
      timeout: 10_000,
    });

    // Persists across reload.
    await page.reload();
    await expect(page.locator('.mny__fee').first()).toContainText('1,234.56', {
      timeout: 10_000,
    });

    // Clear it (empty amount → null) — leaves the fixture clean.
    await page.locator('.mny__fee').first().click();
    const dialog2 = page.locator('dialog[open]');
    await dialog2.getByLabel('Amount').fill('');
    await dialog2.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.mny__fee').first()).toContainText('—', {
      timeout: 10_000,
    });
  });
});
