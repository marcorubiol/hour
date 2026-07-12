import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — Money lens (ADR-046 + ADR-050): the lens renders, the fee write
 * path round-trips (set → persist → clear), and an invoice is created
 * from the fee (VAT math server-side), status-checked and discarded — all
 * on a fixture gig in the test user's own workspace. Self-cleaning: the
 * fee ends null and the draft invoice is discarded.
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

    // Pin the STABLE collab-fixture gig (2031 dates) — never `.first()`:
    // performance-write runs in parallel and creates/deletes transient
    // 2032 gigs in this same workspace, so row order shifts mid-test.
    const row = page.locator('tbody tr', { hasText: '2031' }).first();
    const fee = row.locator('.mny__fee');
    await expect(fee).toBeVisible();

    // Set a fee.
    await fee.click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Amount').fill('1234.56');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(fee).toContainText('1,234.56', { timeout: 10_000 });

    // Persists across reload.
    await page.reload();
    await expect(
      page.locator('tbody tr', { hasText: '2031' }).first().locator('.mny__fee'),
    ).toContainText('1,234.56', { timeout: 10_000 });

    // ── Invoice from the fee (ADR-050) ──────────────────────────────────
    await page
      .locator('tbody tr', { hasText: '2031' })
      .first()
      .getByRole('button', { name: 'Invoice' })
      .click();
    const invDialog = page.locator('dialog[open]');
    await invDialog.getByLabel('VAT %').fill('21');
    // Total preview = server math: 1234.56 + 21% = 1,493.82.
    await expect(invDialog.locator('.mny__inv-total-preview')).toContainText('1,493.82');
    await invDialog.getByRole('button', { name: 'Create draft' }).click();
    await expect(invDialog).not.toBeVisible({ timeout: 10_000 });

    // The draft lands in the Invoices section with the right total.
    const invRow = page.locator('.mny__invoices li').first();
    await expect(invRow).toContainText('1,493.82', { timeout: 10_000 });
    await expect(invRow).toContainText('draft');

    // Discard the draft — self-cleaning, and the discard path IS the test.
    await invRow.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('.mny__invoices li', { hasText: '1,493.82' })).toHaveCount(0, {
      timeout: 10_000,
    });

    // Clear it (empty amount → null) — leaves the fixture clean.
    const rowAgain = page.locator('tbody tr', { hasText: '2031' }).first();
    await rowAgain.locator('.mny__fee').click();
    const dialog2 = page.locator('dialog[open]');
    await dialog2.getByLabel('Amount').fill('');
    await dialog2.getByRole('button', { name: 'Save' }).click();
    await expect(rowAgain.locator('.mny__fee')).toContainText('—', {
      timeout: 10_000,
    });
  });
});
