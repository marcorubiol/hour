import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — Books lens (ADR-087, money v3): the bolo spine renders grouped by
 * obra, and the fee write path round-trips on a fixture deal — set →
 * persists in the obra roll and survives a reload → clear. Self-cleaning:
 * the fee ends null.
 *
 * The invoice/payment cycle of the retired money-v2 spec (ADR-046/050 UI:
 * tbody rows, VAT dialog, invoice-anchored payments) does not port 1:1 —
 * v3 numbers invoices per fiscal identity and decouples payments from
 * issuing, so that coverage needs its own spec against the v3 dialogs.
 * Tracked in _tasks.md (follow-up de money v3).
 */

test.describe('books lens', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('fee set → persists in totals → clear', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/money'); // ADR-067: lens is space-less + cross-space
    await expect(page.locator('.mny__totals')).toBeVisible();

    // Pin the STABLE collab-fixture deal. The obra section carries the
    // project name as aria-label, and the fixture holds TWO 2031 deals
    // (15 and 16 Jan, seeded 2026-07-02) — pin the exact rendered day
    // (dayLabel → en-GB "Wed, 15 Jan 2031") and resolve the deal ONCE so
    // every later step, including the cleanup, speaks about the same one.
    // The spine waits on the pins-gated bolos/invoices/expenses queries
    // behind the nav caches — give the first paint a real window.
    const obra = page.locator('section.obra[aria-label="ZZZ e2e collab"]');
    await expect(obra).toBeVisible({ timeout: 15_000 });
    const deal = obra.locator('.fee').filter({ hasText: '15 Jan 2031' });
    const fee = deal.locator('.fee__fee');
    await expect(fee).toBeVisible();

    // Set a fee.
    await fee.click();
    let dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Amount').fill('1234.56');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(fee).toContainText('1,234.56', { timeout: 10_000 });

    // The obra roll and the deal's collected line reflect the contract.
    await expect(obra.locator('.obra__stat', { hasText: 'contracted' })).toContainText(
      '1,234.56',
    );
    await expect(deal).toContainText('/ 1,234.56');

    // Persists across reload. `fee` is a lazy locator — it re-resolves
    // against the fresh DOM, so it must not be re-derived elsewhere.
    await page.reload();
    await expect(fee).toContainText('1,234.56', { timeout: 10_000 });

    // Clear it (empty amount → null) — leaves the fixture clean. Same
    // `deal` locator as the one the fee was set on: the assertion is only
    // meaningful about the deal this test actually wrote to.
    await fee.click();
    dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Amount').fill('');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(fee).toContainText('—', { timeout: 10_000 });
  });
});
