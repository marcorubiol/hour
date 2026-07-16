import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — person file (ADR-045): reach a person from the Contacts lens,
 * read the file, add a workspace note, verify persistence. The note is
 * soft-deleted at the end via the API (author-scoped update), so runs
 * leave no residue beyond audit rows.
 */

test.describe('person file', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('contacts → person file → add note → persists → cleanup', async ({ page }) => {
    test.setTimeout(60_000);
    const marker = `note-e2e-${Date.now()}`;

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

    // Cleanup IS the delete-button test: the button only renders on the
    // author's own notes and goes through the delete_person_note RPC (a
    // direct PATCH on deleted_at is impossible — see ADR-048).
    const noteItem = page.locator('.person__notes li', { hasText: marker });
    await noteItem.locator('.person__note-delete').click();
    await expect(noteItem).toHaveCount(0, { timeout: 10_000 });

    // Gone after the cleanup — poll the API (render/cache races under
    // parallel runs make the reloaded UI an unreliable witness).
    await expect
      .poll(
        async () =>
          await page.evaluate(async (m) => {
            const res = await fetch(location.pathname.replace(/^.*person/, '/api/persons'));
            const data = (await res.json()) as { notes: Array<{ body: string }> };
            return data.notes.some((n) => n.body === m);
          }, marker),
        { timeout: 10_000 },
      )
      .toBe(false);
  });
});
