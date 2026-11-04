import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { fixtureLine, fixtureLineHref } from './fixture-line';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E · «lo conozco» (ADR-138 § 5): mark a contact from their file, share it,
 * see the mark on the conversation row, and take it back. The mark rides on
 * the inline row of the record lists (ConversationTable); since ADR-177 § 4
 * the organization's record draws one row per project instead, so the row
 * is a line's Conversations module (ADR-056, `fixture-line.ts`). The lens's
 * chat rows (ADR-176) do not carry it. Only in the `playwright` space:
 * `muk-cia` is real data.
 *
 * The suite owns its conversation (a venue and a contact with another name,
 * so the row links the contact) and deletes it at the end. The mark is the
 * caller's own row and unmarking deletes it, so a finished run leaves
 * nothing. A run cut in the middle leaves one private mark of the fixture
 * login on the fixture contact; the next run starts by clearing it.
 */
const SALA = 'ZZZ E2E Acq Sala';
const CONTACT = 'ZZZ E2E Acq Contact';

/** Create (or revive) the suite's conversation on the fixture line; its row there. */
async function contactRow(page: Page) {
  await page.goto('/h/desk');
  const line = await fixtureLine(page);
  const id = await page.evaluate(
    async ({ project_id, line_id, sala, contact }) => {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id,
          line_id,
          organization: { name: sala },
          person: { full_name: contact, email: 'zzz-e2e-acq@hour.test' },
        }),
      });
      if (res.ok) return ((await res.json()) as { conversation: { id: string } }).conversation.id;
      // A leftover from a cut run: reuse it, on the line.
      const found = (await fetch(`/api/conversations?limit=20&q=${encodeURIComponent(sala)}`).then((r) => r.json())) as {
        items: Array<{ id: string; organization: { name: string } | null }>;
      };
      const hit = found.items.find((i) => i.organization?.name === sala);
      if (!hit) throw new Error(`could not create or find the fixture (${res.status})`);
      await fetch(`/api/conversations/${hit.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ line_id }),
      });
      return hit.id;
    },
    { project_id: line.projectId, line_id: line.id, sala: SALA, contact: CONTACT },
  );
  await page.goto(fixtureLineHref(line));
  await waitForLoaded(page);
  const row = page.locator('#mod-conversations [data-testid="conversation-row"]').filter({ hasText: SALA }).first();
  return { row, id };
}

test.describe('«lo conozco»', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('person file → I know them → share → the row says so → unmark', async ({ page }) => {
    test.setTimeout(60_000);

    const { row, id } = await contactRow(page);
    try {
      await expect(row).toBeVisible({ timeout: 15_000 });

      const contact = row.locator('a.crow-contact');
      // From a record's page the person opens on its page (ADR-139 p1), where the switch lives.
      await contact.click();
      await page.waitForURL(/\/h\/[^/]+\/person\//);
      await waitForLoaded(page);

      const notes = page.getByRole('region', { name: 'Notes' });
      const known = notes.getByRole('switch', { name: 'I know them' });
      await expect(known).toBeVisible();
      // A run cut short may have left the mark on: start from off.
      if ((await known.getAttribute('aria-checked')) === 'true') {
        await known.click();
        await expect(known).toHaveAttribute('aria-checked', 'false');
      }

      await known.click();
      await expect(known).toHaveAttribute('aria-checked', 'true');
      const share = notes.getByRole('switch', { name: 'Share with the team' });
      // Born private.
      await expect(share).toHaveAttribute('aria-checked', 'false');
      await expect(notes.getByText('Only you know.')).toBeVisible();

      await share.click();
      await expect(share).toHaveAttribute('aria-checked', 'true');
      await expect(notes.getByText('The team sees that you know them.')).toBeVisible();

      // Persists across reload.
      await page.reload();
      await waitForLoaded(page);
      await expect(known).toHaveAttribute('aria-checked', 'true');
      await expect(share).toHaveAttribute('aria-checked', 'true');

      // The row carries the mark.
      await page.goBack();
      await waitForLoaded(page);
      await expect(row.getByRole('img', { name: 'You know them' })).toBeVisible();

      // Unmark from the file: the share switch goes with it.
      await page.goForward();
      await waitForLoaded(page);
      await known.click();
      await expect(known).toHaveAttribute('aria-checked', 'false');
      await expect(share).toHaveCount(0);

      await expect
        .poll(async () =>
          page.evaluate(async () => {
            const r = await fetch('/api/acquaintances');
            const view = (await r.json()) as { me: string; items: { user_id: string }[] };
            return view.items.filter((a) => a.user_id === view.me).length;
          }),
        )
        .toBe(0);
    } finally {
      await page.evaluate((cid) => fetch(`/api/conversations/${cid}`, { method: 'DELETE' }).then(() => undefined), id);
    }
  });
});
