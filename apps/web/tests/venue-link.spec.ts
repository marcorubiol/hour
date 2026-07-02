import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — venue entity linking (ADR-049): promote the typed venue fields to
 * a venue row from the edit dialog, link it, verify it persists, unlink.
 *
 * Cleanup note: the venue ROW stays (client soft-delete is impossible by
 * construction, ADR-048) — but create_venue is idempotent on name+city,
 * so reruns reuse the same fixture row instead of accumulating.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(EMAIL!);
  await page.locator('input[type=password]').fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\//);
}

test.describe('venue linking', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('promote fields → link persists → unlink', async ({ page }) => {
    test.setTimeout(90_000);

    await login(page);
    await page.goto('/h/playwright/performance/zzz-e2e-1');
    await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();

    // Open the dialog, type a venue trio, promote it.
    await page.getByRole('button', { name: 'Edit details' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Venue', { exact: true }).fill('ZZZ E2E Venue');
    await dialog.getByLabel('City').fill('Testville');
    await dialog.getByRole('button', { name: 'Save fields as venue' }).click();

    // The select links to the (possibly pre-existing, idempotent) venue.
    const select = dialog.locator('#f-venue-entity');
    await expect(select).not.toHaveValue('', { timeout: 10_000 });
    const venueId = await select.inputValue();

    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Persists: reopen and the select still points at the venue.
    await page.reload();
    await page.getByRole('button', { name: 'Edit details' }).click();
    const dialog2 = page.locator('dialog[open]');
    await expect(dialog2.locator('#f-venue-entity')).toHaveValue(venueId, {
      timeout: 10_000,
    });

    // Unlink (leave the fixture gig as it was; the venue row remains as a
    // stable fixture).
    await dialog2.locator('#f-venue-entity').selectOption('');
    await dialog2.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog2).not.toBeVisible({ timeout: 10_000 });

    await page.reload();
    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.locator('dialog[open] #f-venue-entity')).toHaveValue('', {
      timeout: 10_000,
    });
  });
});
