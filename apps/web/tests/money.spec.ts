import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — Money lens (ADR-046 + ADR-050): the lens renders, the fee write
 * path round-trips (set → persist → clear), and an invoice is created
 * from the fee (VAT math server-side), expected collection edited, two
 * payments observed, paid status derived, then fully cleaned up — all
 * on a fixture gig in the test user's own workspace. Self-cleaning: the
 * fee ends null and the draft invoice is discarded.
 */

test.describe('money lens', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('fee set → persists in totals → clear', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/money'); // ADR-067: lens is space-less + cross-space
    await expect(page.locator('.mny__totals')).toBeVisible();

    // Pin a STABLE collab-fixture gig by its project name — never
    // `.first()` (performance-write creates/deletes transient gigs in
    // parallel) and never a bare year substring (the unpinned lens also
    // lists real muk-cia rows).
    const row = page.locator('tbody tr', { hasText: 'ZZZ e2e collab' }).filter({ hasText: '2031' }).first();
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
      page.locator('tbody tr', { hasText: 'ZZZ e2e collab' }).filter({ hasText: '2031' }).first().locator('.mny__fee'),
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
    let invRow = page.locator('.mny__invoices > li').first();
    await expect(invRow).toContainText('1,493.82', { timeout: 10_000 });
    await expect(invRow).toContainText('draft');

    // Two collection truths are editable and survive a reload.
    await invRow.getByRole('button', { name: 'Details' }).click();
    const expected = invRow.getByLabel(/Expected collection date/);
    await expected.fill('2031-08-31');
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/invoices/') &&
          response.request().method() === 'PATCH' &&
          response.ok(),
      ),
      expected.press('Tab'),
    ]);
    const condition = invRow.getByLabel('Payment condition');
    await condition.fill('Pays when the presenting venue pays them');
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/invoices/') &&
          response.request().method() === 'PATCH' &&
          response.ok(),
      ),
      condition.press('Tab'),
    ]);
    await page.reload();
    invRow = page.locator('.mny__invoices > li').first();
    await invRow.getByRole('button', { name: 'Details' }).click();
    await expect(invRow.getByLabel(/Expected collection date/)).toHaveValue('2031-08-31');
    await expect(invRow.getByLabel('Payment condition')).toHaveValue(
      'Pays when the presenting venue pays them',
    );

    // Issue it; "paid" is deliberately absent from the manual status menu.
    await invRow.getByRole('button', { name: 'Change invoice status' }).click();
    await expect(page.getByRole('menuitem', { name: 'paid', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'issued', exact: true }).click();
    await expect(invRow).toContainText('issued', { timeout: 10_000 });

    // Advance + rest: partial stays issued, full coverage derives paid.
    await invRow.getByRole('button', { name: 'Record payment' }).click();
    let paymentDialog = page.locator('dialog[open]');
    await paymentDialog.getByLabel('Amount').fill('500');
    await paymentDialog.getByLabel('Reference').fill('advance-e2e');
    await paymentDialog.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(invRow).toContainText('500.00 / 1,493.82', { timeout: 10_000 });
    await expect(invRow).toContainText('issued');

    await invRow.getByRole('button', { name: 'Record payment' }).click();
    paymentDialog = page.locator('dialog[open]');
    await expect(paymentDialog.getByLabel('Amount')).toHaveValue('993.82');
    await paymentDialog.getByLabel('Reference').fill('rest-e2e');
    await paymentDialog.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(invRow).toContainText('1,493.82 / 1,493.82', { timeout: 10_000 });
    await expect(invRow).toContainText('collected');
    await expect(invRow).toContainText('paid');

    // Removing observed payments recalculates the invoice back to issued.
    let removePayments = invRow.getByRole('button', { name: 'Remove', exact: true });
    await expect(removePayments).toHaveCount(2);
    await removePayments.first().click();
    removePayments = invRow.getByRole('button', { name: 'Remove', exact: true });
    await expect(removePayments).toHaveCount(1);
    await removePayments.first().click();
    await expect(invRow).toContainText('No payments recorded.', { timeout: 10_000 });
    await expect(invRow).toContainText('issued');

    // Return the invoice to draft so the existing discard path remains the cleanup.
    await invRow.getByRole('button', { name: 'Change invoice status' }).click();
    await page.getByRole('menuitem', { name: 'draft', exact: true }).click();
    await expect(invRow).toContainText('draft', { timeout: 10_000 });

    // Discard the draft — self-cleaning, and the discard path IS the test.
    await invRow.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('.mny__invoices li', { hasText: '1,493.82' })).toHaveCount(0, {
      timeout: 10_000,
    });

    // Clear it (empty amount → null) — leaves the fixture clean.
    const rowAgain = page.locator('tbody tr', { hasText: 'ZZZ e2e collab' }).filter({ hasText: '2031' }).first();
    await rowAgain.locator('.mny__fee').click();
    const dialog2 = page.locator('dialog[open]');
    await dialog2.getByLabel('Amount').fill('');
    await dialog2.getByRole('button', { name: 'Save' }).click();
    await expect(rowAgain.locator('.mny__fee')).toContainText('—', {
      timeout: 10_000,
    });
  });
});
