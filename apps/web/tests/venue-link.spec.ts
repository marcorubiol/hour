import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/** The record keeps the venue's inside folded under «Details» (ADR-139 p2): open it. */
async function openDetails(page: Page) {
  const lid = page.getByTestId('record-details').locator('button.lid');
  if ((await lid.getAttribute('aria-expanded')) !== 'true') await lid.click();
}

/**
 * A run that died mid-test leaves zzz-e2e-1 linked, and a linked gig offers no
 * «Save fields as venue». Start each test from the unlinked state.
 */
async function startUnlinked(page: Page) {
  await page.goto('/h/playwright/performance/zzz-e2e-1');
  await waitForLoaded(page);
  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.locator('dialog[open]').filter({ hasText: 'Edit performance' });
  const select = dialog.locator('#f-venue-entity');
  // Until the venue list lands the select has no option to show the link with.
  await expect(select.locator('option', { hasText: 'ZZZ E2E Venue' })).toHaveCount(1, { timeout: 10_000 });
  if ((await select.inputValue()) !== '') {
    await select.selectOption('');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await page.reload();
    await waitForLoaded(page);
  } else {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
  }
}

/**
 * E2E — venue entity linking (ADR-049): promote the typed venue fields to
 * a venue row from the edit dialog, link it, verify it persists, unlink.
 *
 * Cleanup note: the venue ROW stays (client soft-delete is impossible by
 * construction, ADR-048) — but create_venue is idempotent on name+city,
 * so reruns reuse the same fixture row instead of accumulating.
 */

test.describe('venue linking', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  // Serial: both tests mutate the same zzz-e2e-1 gig's venue link and the
  // shared fixture venue row; each leaves the gig unlinked for the next.
  test.describe.configure({ mode: 'serial' });

  test('promote fields → link persists → unlink', async ({ page }) => {
    test.setTimeout(90_000);

    await startUnlinked(page);
    await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();

    // Open the dialog, type a venue trio, promote it.
    await page.getByRole('button', { name: 'Edit details' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Venue', { exact: true }).fill('ZZZ E2E Venue');
    await dialog.getByLabel('City').fill('Testville');
    // «Save fields as venue» is an intent: nothing is created until «Save».
    await dialog.getByLabel('Save fields as venue').check({ force: true });
    await expect(dialog.locator('#f-venue-entity')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Persists: reopen and the select points at the (possibly pre-existing,
    // idempotent) venue.
    await page.reload();
    await waitForLoaded(page);
    await page.getByRole('button', { name: 'Edit details' }).click();
    const dialog2 = page.locator('dialog[open]');
    await expect(dialog2.locator('#f-venue-entity')).not.toHaveValue('', {
      timeout: 10_000,
    });

    // Unlink (leave the fixture gig as it was; the venue row remains as a
    // stable fixture).
    await dialog2.locator('#f-venue-entity').selectOption('');
    await dialog2.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog2).not.toBeVisible({ timeout: 10_000 });

    await page.reload();
    await waitForLoaded(page);
    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.locator('dialog[open] #f-venue-entity')).toHaveValue('', {
      timeout: 10_000,
    });
  });

  test('edit venue: timezone + contact persist and render (ADR-053)', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await startUnlinked(page);
    await page.getByRole('button', { name: 'Edit details' }).click();
    let dialog = page.locator('dialog[open]').filter({ hasText: 'Edit performance' });

    // Link the stable fixture venue (idempotent promote from the other test):
    // the intent, then «Save», which creates and links it.
    await dialog.getByLabel('Venue', { exact: true }).fill('ZZZ E2E Venue');
    await dialog.getByLabel('City').fill('Testville');
    await dialog.getByLabel('Save fields as venue').check({ force: true });
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    // The dialog seeds from the cached record, refetched in the background
    // after Save: reload so it opens on what the server holds.
    await page.reload();
    await waitForLoaded(page);
    await page.getByRole('button', { name: 'Edit details' }).click();
    dialog = page.locator('dialog[open]').filter({ hasText: 'Edit performance' });
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
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // The production block shows the venue timezone and the contact. It is
    // reference, so it sits folded under «Details» (ADR-139 p2).
    await openDetails(page);
    await expect(page.locator('.production__venue-meta')).toContainText(
      'Europe/Paris',
      { timeout: 10_000 },
    );
    await expect(page.locator('.production__contacts')).toContainText(
      'ZZZ Tech Manager',
    );

    // Survives a full reload (server round-trip, not cache).
    await page.reload();
    await waitForLoaded(page);
    await openDetails(page);
    await expect(page.locator('.production__venue-meta')).toContainText('Europe/Paris');
    await expect(page.locator('.production__contacts')).toContainText('+34 600 000 001');

    // Leave the fixture gig unlinked, as the other test expects to start.
    await page.getByRole('button', { name: 'Edit details' }).click();
    const dialog2 = page.locator('dialog[open]').filter({ hasText: 'Edit performance' });
    await dialog2.locator('#f-venue-entity').selectOption('');
    await dialog2.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog2).not.toBeVisible({ timeout: 10_000 });
  });
});
