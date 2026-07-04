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
  // Serial: both tests mutate the same zzz-e2e-1 gig's venue link and the
  // shared fixture venue row; each leaves the gig unlinked for the next.
  test.describe.configure({ mode: 'serial' });

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

  test('edit venue: timezone + contact persist and render (ADR-053)', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await login(page);
    await page.goto('/h/playwright/performance/zzz-e2e-1');
    await page.getByRole('button', { name: 'Edit details' }).click();
    const dialog = page.locator('dialog[open]').filter({ hasText: 'Edit performance' });

    // Link the stable fixture venue (idempotent promote from the other test).
    await dialog.getByLabel('Venue', { exact: true }).fill('ZZZ E2E Venue');
    await dialog.getByLabel('City').fill('Testville');
    await dialog.getByRole('button', { name: 'Save fields as venue' }).click();
    const select = dialog.locator('#f-venue-entity');
    await expect(select).not.toHaveValue('', { timeout: 10_000 });

    // Open the venue editor (stacks on top of the edit dialog). Filter by
    // the hint text unique to the venue dialog — 'Edit venue' alone also
    // matches the perf dialog (its button carries the same words).
    await dialog.getByRole('button', { name: 'Edit venue…' }).click();
    const venueDialog = page
      .locator('dialog[open]')
      .filter({ hasText: 'The timezone drives dual-time' });
    await expect(venueDialog).toBeVisible();

    // Timezone drives the road sheet dual-time; one contact for the
    // production block. Idempotent values — reruns overwrite in place.
    await venueDialog.locator('#v-timezone').fill('Europe/Paris');
    if ((await venueDialog.locator('.perf__contact-row').count()) === 0) {
      await venueDialog.getByRole('button', { name: 'Add contact' }).click();
    }
    const firstRow = venueDialog.locator('.perf__contact-row').first();
    await firstRow.locator('input').nth(0).fill('ZZZ Tech Manager');
    await firstRow.locator('input').nth(1).fill('Regidoria');
    await firstRow.locator('input').nth(3).fill('+34 600 000 001');

    await venueDialog.getByRole('button', { name: 'Save venue' }).click();
    await expect(venueDialog).not.toBeVisible({ timeout: 10_000 });

    // Persist the link itself, then close the edit dialog.
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // The production block shows the venue timezone and the contact.
    await expect(page.locator('.production__venue-meta')).toContainText(
      'Europe/Paris',
      { timeout: 10_000 },
    );
    await expect(page.locator('.production__contacts')).toContainText(
      'ZZZ Tech Manager',
    );

    // Survives a full reload (server round-trip, not cache).
    await page.reload();
    await expect(page.locator('.production__venue-meta')).toContainText('Europe/Paris');
    await expect(page.locator('.production__contacts')).toContainText('+34 600 000 001');

    // Leave the fixture gig unlinked, as the other test expects to start.
    await page.getByRole('button', { name: 'Edit details' }).click();
    const dialog2 = page.locator('dialog[open]').filter({ hasText: 'Edit performance' });
    await dialog2.locator('#f-venue-entity').selectOption('');
    await dialog2.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog2).not.toBeVisible({ timeout: 10_000 });
  });
});
