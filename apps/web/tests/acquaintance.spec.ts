import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E · «lo conozco» (ADR-138 § 5): mark a contact from their file, share it,
 * see the mark on the Conversations row, and take it back. Only in the
 * `playwright` space (the list is scoped to it): `muk-cia` is real data.
 *
 * The mark is the caller's own row and unmarking deletes it, so a finished run
 * leaves nothing. A run cut in the middle leaves one private mark of the
 * fixture login on a fixture contact; the next run starts by clearing it.
 */
test.describe('«lo conozco»', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('person file → I know them → share → the row says so → unmark', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/h/conversations?scope=s:playwright');
    await waitForLoaded(page);
    const row = page.locator('tbody tr').first();
    await expect(row).toBeVisible();

    const contact = row.locator('td').nth(1).getByRole('link');
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
  });
});
