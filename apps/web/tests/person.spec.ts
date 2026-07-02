import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — person file (ADR-045): reach a person from the Contacts lens,
 * read the file, add a workspace note, verify persistence. The note is
 * soft-deleted at the end via the API (author-scoped update), so runs
 * leave no residue beyond audit rows.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(EMAIL!);
  await page.locator('input[type=password]').fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\//);
}

test.describe('person file', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('contacts → person file → add note → persists → cleanup', async ({ page }) => {
    test.setTimeout(60_000);
    const marker = `note-e2e-${Date.now()}`;

    await login(page);
    await page.goto('/h/muk-cia/contacts');
    await expect(page.locator('tbody tr').first()).toBeVisible();

    // Into the person file via the linked name.
    const firstName = page.locator('tbody tr').first().locator('.cell--name-link');
    const personName = (await firstName.innerText()).trim();
    await firstName.click();
    await page.waitForURL(/\/h\/muk-cia\/person\//);
    await expect(page.locator('.person__title')).toContainText(personName);

    // The engagement context renders (this person has at least the
    // MaMeMi engagement — that's why they were in the list).
    await expect(page.locator('.person__rows li').first()).toBeVisible();

    // Add a workspace note.
    await page.getByPlaceholder('What happened with this person?').fill(marker);
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.locator('.person__note-body').first()).toContainText(marker, {
      timeout: 10_000,
    });

    // Persists across reload.
    await page.reload();
    await expect(page.locator('.person__note-body').first()).toContainText(marker, {
      timeout: 10_000,
    });

    // Cleanup: soft-delete via the author-scoped RPC (a direct PATCH on
    // deleted_at is rejected by RLS — see _flux 2026-07-02).
    const cleaned = await page.evaluate(async (m) => {
      const jwt = localStorage.getItem('hour_jwt');
      const SB = 'https://lqlyorlccnniybezugme.supabase.co';
      const ANON = 'sb_publishable_IavZsGp7i04juuafanQk9w_33pFDhNu';
      const H = {
        apikey: ANON,
        Authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
      };
      const list = await fetch(
        `${SB}/rest/v1/person_note?body=eq.${encodeURIComponent(m)}&select=id`,
        { headers: H },
      );
      const rows = (await list.json()) as Array<{ id: string }>;
      if (rows.length !== 1) return { status: -1 };
      const res = await fetch(`${SB}/rest/v1/rpc/delete_person_note`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ p_note_id: rows[0].id }),
      });
      return { status: res.status };
    }, marker);
    expect(cleaned.status).toBe(204);

    // Gone after the cleanup — poll the API (render/cache races under
    // parallel runs make the reloaded UI an unreliable witness).
    await expect
      .poll(
        async () =>
          await page.evaluate(async (m) => {
            const jwt = localStorage.getItem('hour_jwt');
            const res = await fetch(location.pathname.replace(/^.*person/, '/api/persons'), {
              headers: { Authorization: `Bearer ${jwt}` },
            });
            const data = (await res.json()) as { notes: Array<{ body: string }> };
            return data.notes.some((n) => n.body === m);
          }, marker),
        { timeout: 10_000 },
      )
      .toBe(false);
  });
});
