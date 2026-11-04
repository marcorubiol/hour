import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — person file (ADR-045): reach a person from a conversation row (on
 * the organization's record since ADR-176: the lens's chat rows do not link
 * the contact), read the file, add a note, verify persistence. The note is soft-deleted at
 * the end via the API (author-scoped), so runs leave no residue beyond audit
 * rows.
 *
 * Re-pointed at `note` by ADR-093 (`person_note` was absorbed). The flow is
 * unchanged on purpose — the only thing that went is the visibility toggle,
 * because a note is now always private. This spec never touched it, which is
 * itself the evidence that the toggle was never load-bearing.
 */

/**
 * A fixture conversation with a contact, on its organization's record
 * (ADR-159): since ADR-176 the lens's chat rows do not link the contact; the
 * record's contacts block does (ADR-177 § 4: name, role and phone). Only in
 * the `playwright` space: `muk-cia` is real data.
 */
async function contactRow(page: Page) {
  await page.goto('/h/conversations?etiqueta=sales&scope=s:playwright');
  await waitForLoaded(page);
  const org = await page.evaluate(async () => {
    const wsBody = (await fetch('/api/workspaces').then((r) => r.json())) as { items: Array<{ id: string; slug: string }> };
    const ws = wsBody.items.find((w) => w.slug === 'playwright');
    if (!ws) throw new Error('no fixture workspace');
    const list = (await fetch(`/api/conversations?etiqueta=sales&workspace_ids=${ws.id}&limit=100`).then((r) => r.json())) as {
      items: Array<{ person: { slug: string | null } | null; organization: { slug: string } | null }>;
    };
    return list.items.find((i) => i.person?.slug && i.organization?.slug)?.organization?.slug ?? null;
  });
  expect(org, 'a fixture conversation with a contact').toBeTruthy();
  await page.goto(`/h/playwright/organization/${encodeURIComponent(org!)}`);
  await waitForLoaded(page);
  return page.getByTestId('organization-contacts').locator('li').filter({ has: page.locator('a.organization__row-name') }).first();
}

test.describe('person file', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('conversations → person file → add note → persists → cleanup', async ({ page }) => {
    test.setTimeout(60_000);
    const marker = `note-e2e-${Date.now()}`;

    // Scoped to the fixture space: this spec WRITES a note on whoever is
    // first, and until § 31 (2026-10) that was a real MüK Cia contact.
    // Into the person file via the contact's linked name. The workspace
    // segment on a person URL is browsing context, not ownership — `person`
    // is a global entity resolved by RLS, so any accessible segment renders
    // it. Don't pin the URL to one space.
    const firstName = (await contactRow(page)).locator('a.organization__row-name');
    const personName = (await firstName.innerText()).trim();
    // From a record's page a link opens the page, not the vistazo (ADR-139 p1).
    await firstName.click();
    await page.waitForURL(/\/h\/[^/]+\/person\//);
    await expect(page.getByRole('heading', { name: personName, level: 1 })).toBeVisible();
    // The heading is the person page's own, so the list's settled root is
    // gone: from here «loaded» speaks about this page.
    await waitForLoaded(page);

    // The conversation context renders (this person has at least the
    // fixture difusión conversation — that's why they were in the list).
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
    await waitForLoaded(page);
    await expect(notes.getByText(marker, { exact: true })).toBeVisible();

    // Cleanup IS the delete-button test: the button only renders on the
    // author's own notes and goes through the delete_note RPC (a direct PATCH
    // on deleted_at is impossible — the SELECT policy is enforced against the
    // new row, see ADR-048 and the ADR-093 migration header).
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
