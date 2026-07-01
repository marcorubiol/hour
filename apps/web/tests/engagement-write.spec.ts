import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — engagement inline write path on /booking (ADR-040).
 *
 * Both tests write to a REAL engagement row (the difusión list) and
 * restore the original values before finishing: set → verify → reload →
 * verify persisted → revert. Net data change is zero; `updated_at` bumps
 * and audit_log rows appear, which is the cost of testing a real write.
 *
 * The working row is located by person name (captured up front), not by
 * position — writes can reorder the list (it sorts by next_action_at,
 * then updated_at).
 */

async function loginAndOpenBooking(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(EMAIL!);
  await page.locator('input[type=password]').fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\//);
  await page.goto('/booking');
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

function rowByName(page: Page, name: string) {
  return page.locator('tbody tr', { hasText: name }).first();
}

test.describe('engagement inline write', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with edit:engagement where the MaMeMi engagements live).',
  );

  test('status change persists and reverts', async ({ page }) => {
    await loginAndOpenBooking(page);

    const firstRow = page.locator('tbody tr').first();
    const name = (await firstRow.locator('td').first().innerText()).trim();
    const row = rowByName(page, name);

    const trigger = row.locator('button[aria-haspopup="menu"]');
    const original = (await trigger.innerText()).replace('▾', '').trim();
    const target = original === 'Hold' ? 'Dormant' : 'Hold';

    // Change status via the badge menu.
    await trigger.click();
    await page.getByRole('menuitem', { name: target, exact: true }).click();
    await expect(trigger).toContainText(target);

    // Reload — the change must have hit the database, not just the cache.
    await page.reload();
    await expect(rowByName(page, name).locator('button[aria-haspopup="menu"]')).toContainText(
      target,
    );

    // Revert to the original status.
    const triggerAfter = rowByName(page, name).locator('button[aria-haspopup="menu"]');
    await triggerAfter.click();
    await page.getByRole('menuitem', { name: original, exact: true }).click();
    await expect(triggerAfter).toContainText(original);

    await page.reload();
    await expect(rowByName(page, name).locator('button[aria-haspopup="menu"]')).toContainText(
      original,
    );
  });

  test('next action date + note save, persist and restore', async ({ page }) => {
    await loginAndOpenBooking(page);

    const firstRow = page.locator('tbody tr').first();
    const name = (await firstRow.locator('td').first().innerText()).trim();

    // Capture the row's raw values via the API (the cell renders a lossy
    // dd MMM date) so the restore at the end is exact.
    const originalRaw = await page.evaluate(async (personName) => {
      const jwt = localStorage.getItem('hour_jwt');
      const res = await fetch(
        '/api/engagements?status=any&project_slug=mamemi&season=2026-27&limit=50',
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      const data = (await res.json()) as {
        items: Array<{
          next_action_at: string | null;
          next_action_note: string | null;
          person: { full_name: string | null } | null;
        }>;
      };
      const item = data.items.find((i) => i.person?.full_name === personName);
      return item
        ? { at: item.next_action_at, note: item.next_action_note }
        : null;
    }, name);
    expect(originalRaw).not.toBeNull();

    // Set a probe date + note through the dialog. The probe date is far in
    // the past on purpose: the list sorts next_action_at ASC, so the row
    // stays on page 1 where the restore step can still find it.
    await rowByName(page, name).locator('button.next-action').click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Date').fill('2020-01-01');
    await dialog.locator('#next-action-note').fill('e2e probe — will be reverted');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(rowByName(page, name).locator('.next-action__note')).toContainText(
      'e2e probe',
    );

    await page.reload();
    await expect(rowByName(page, name).locator('.next-action__note')).toContainText(
      'e2e probe',
    );

    // Restore the original values exactly.
    await rowByName(page, name).locator('button.next-action').click();
    const restoreDialog = page.locator('dialog[open]');
    await restoreDialog
      .getByLabel('Date')
      .fill(originalRaw!.at ? originalRaw!.at.slice(0, 10) : '');
    await restoreDialog.locator('#next-action-note').fill(originalRaw!.note ?? '');
    await restoreDialog.getByRole('button', { name: 'Save' }).click();

    // Verify the restore against the API (raw values) — after a restore the
    // row may fall off page 1 (nulls sort last), so the UI row is not a
    // reliable witness. Dates compare date-only: the editor's contract is
    // date-only, so a time-of-day in legacy data doesn't survive a
    // round-trip and shouldn't fail the test.
    await expect
      .poll(async () => {
        return await page.evaluate(async (personName) => {
          const jwt = localStorage.getItem('hour_jwt');
          const res = await fetch(
            '/api/engagements?status=any&project_slug=mamemi&season=2026-27&limit=100',
            { headers: { Authorization: `Bearer ${jwt}` } },
          );
          const data = (await res.json()) as {
            items: Array<{
              next_action_at: string | null;
              next_action_note: string | null;
              person: { full_name: string | null } | null;
            }>;
          };
          const item = data.items.find((i) => i.person?.full_name === personName);
          return item
            ? { at: item.next_action_at?.slice(0, 10) ?? null, note: item.next_action_note }
            : null;
        }, name);
      })
      .toEqual({
        at: originalRaw!.at?.slice(0, 10) ?? null,
        note: originalRaw!.note,
      });
  });
});
