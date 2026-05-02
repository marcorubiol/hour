import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

test.describe('smoke', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with workspace_membership in hour-phase0).',
  );

  test('login → /booking shows engagements → sign out', async ({ page }) => {
    await page.goto('/login');

    await page.locator('input[type=email]').fill(EMAIL!);
    await page.locator('input[type=password]').fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL('**/booking');

    // status-bar__count renders "<n> contacts" once the engagements query resolves.
    const countLabel = page.locator('.status-bar__count');
    await expect(countLabel).toBeVisible();
    await expect(countLabel).toHaveText(/^\d+\s+contacts$/);

    const tableRows = page.locator('table tbody tr');
    expect(await tableRows.count()).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
  });
});
