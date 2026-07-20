import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — person file (ADR-045): reach a person from the Conversations lens,
 * read the file, add a workspace note, verify persistence. The note is
 * soft-deleted at the end via the API (author-scoped update), so runs
 * leave no residue beyond audit rows.
 */

test.describe('person file', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('conversations → person file → add note → persists → cleanup', async ({ page }) => {
    test.setTimeout(60_000);
    const marker = `note-e2e-${Date.now()}`;

    // ADR-067: the Conversations lens is space-less and cross-space.
    await page.goto('/h/conversations');
    await expect(page.locator('tbody tr').first()).toBeVisible();

    // Into the person file via the linked name. The workspace segment on a
    // person URL is browsing context, not ownership — `person` is a global
    // entity resolved by RLS, so any accessible segment renders it (verified:
    // the same person opens under /h/marco-rubiol/ and /h/muk-cia/). Don't
    // pin the test to one space.
    const firstName = page.locator('tbody tr').first().getByRole('link').first();
    const personName = (await firstName.innerText()).trim();
    await firstName.click();
    await page.waitForURL(/\/h\/[^/]+\/person\//);
    await expect(page.getByRole('heading', { name: personName, level: 1 })).toBeVisible();

    // The conversation context renders (this person has at least the
    // MaMeMi conversation — that's why they were in the list).
    const conversations = page.getByRole('region', { name: 'Conversations' });
    await expect(conversations.getByRole('listitem').first()).toBeVisible();

    // Add a workspace note.
    const notes = page.getByRole('region', { name: 'Notes' });
    await notes.getByPlaceholder('What happened with this person?').fill(marker);
    await notes.getByRole('button', { name: 'Add note' }).click();
    await expect(notes.getByText(marker, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Persists across reload.
    await page.reload();
    await expect(notes.getByText(marker, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Cleanup IS the delete-button test: the button only renders on the
    // author's own notes and goes through the delete_person_note RPC (a
    // direct PATCH on deleted_at is impossible — see ADR-048).
    const noteItem = notes.getByRole('listitem').filter({ hasText: marker });
    await noteItem.getByRole('button', { name: 'delete' }).click();
    await expect(noteItem).toHaveCount(0, { timeout: 10_000 });

    // Gone after the cleanup — poll the API (render/cache races under
    // parallel runs make the reloaded UI an unreliable witness).
    await expect
      .poll(
        async () =>
          await page.evaluate(async (m) => {
            const [, , workspaceSlug, , personSlug] = location.pathname.split('/');
            const workspacesRes = await fetch('/api/workspaces');
            const workspaces = (
              (await workspacesRes.json()) as {
                items: Array<{ id: string; slug: string }>;
              }
            ).items;
            const workspaceId = workspaces.find((w) => w.slug === workspaceSlug)?.id;
            if (!workspaceId || !personSlug) return null;
            const res = await fetch(
              `/api/persons/${encodeURIComponent(personSlug)}?workspace_id=${encodeURIComponent(workspaceId)}`,
            );
            const data = (await res.json()) as { notes?: Array<{ body: string }> };
            return data.notes?.some((n) => n.body === m) ?? null;
          }, marker),
        { timeout: 10_000 },
      )
      .toBe(false);
  });
});
