import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { fixtureLine } from './fixture-line';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E · «lo conozco» (ADR-138 § 5): mark a contact from their file, share it,
 * and take it back. Since tarea 135 no list draws the mark on a row: a line's
 * Conversations module draws the lens's chat rows (ADR-176), which never
 * carried it, so the suite opens the contact's file straight from the API.
 * Only in the `playwright` space: `muk-cia` is real data.
 *
 * The suite owns its conversation (a venue and a contact with another name,
 * so the row links the contact) and deletes it at the end. The mark is the
 * caller's own row and unmarking deletes it, so a finished run leaves
 * nothing. A run cut in the middle leaves one private mark of the fixture
 * login on the fixture contact; the next run starts by clearing it.
 */
const SALA = 'ZZZ E2E Acq Sala';
const CONTACT = 'ZZZ E2E Acq Contact';

/** Create (or revive) the suite's conversation on the fixture line; its contact's file. */
async function contactFile(page: Page) {
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
  const slug = await page.evaluate(async ({ line_id, cid }) => {
    const list = (await fetch(`/api/conversations?line_id=${line_id}&limit=100`).then((r) => r.json())) as {
      items: Array<{ id: string; person: { slug: string | null } | null }>;
    };
    return list.items.find((i) => i.id === cid)?.person?.slug ?? null;
  }, { line_id: line.id, cid: id });
  if (!slug) throw new Error('the fixture contact has no file');
  return { href: `/h/playwright/person/${slug}`, id };
}

test.describe('«lo conozco»', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('person file → I know them → share → unmark', async ({ page }) => {
    test.setTimeout(60_000);

    const { href, id } = await contactFile(page);
    try {
      await page.goto(href);
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

      // Unmark from the file: the share switch goes with it.
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
