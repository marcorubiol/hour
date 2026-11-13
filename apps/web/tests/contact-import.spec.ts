import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E: «Import contacts» (138), a sheet of contacts brought into Hour.
 *
 * THE SPEC OWNS ITS ROWS: two people and their organization, invented
 * (`example.org`) and marked with this run, in the `playwright` workspace.
 * The import's own «Undo» removes them; if a step fails before that, the
 * `finally` undoes it through the API, so nothing piles up. Needs the
 * migration `20261113100000_contact_import` applied: before it, the dialog
 * says importing is not available yet and this spec fails at the review.
 *
 * 1. Conversations' «+» → «Import contacts»; a CSV dropped in the sheet is
 *    read on the device.
 * 2. Columns: the header proposes name, organization and email; «Zone» goes
 *    to the note.
 * 3. Review: two new contacts and one new organization; «Import 2».
 * 4. The result says it; the import is in the history; the two people exist.
 * 5. «Undo the import» asks first, then removes them.
 */

type Item = { id: string; filename: string | null; persons_created: number; organizations_created: number; status: string };

async function playwrightWorkspaceId(page: Page): Promise<string> {
  return await page.evaluate(async (): Promise<string> => {
    type Ws = { id: string; slug: string };
    const ws = ((await fetch('/api/workspaces').then((r) => r.json())) as { items: Ws[] }).items.find((w) => w.slug === 'playwright');
    if (!ws) throw new Error('no fixture workspace');
    return ws.id;
  });
}

async function imports(page: Page, workspaceId: string): Promise<Item[]> {
  return await page.evaluate(async (ws) => {
    const res = await fetch(`/api/contact-imports?workspace_id=${ws}`);
    return ((await res.json()) as { items: Item[] }).items;
  }, workspaceId);
}

async function found(page: Page, workspaceId: string, term: string): Promise<string[]> {
  return await page.evaluate(
    async ({ ws, term }) => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}&workspace_ids=${ws}`);
      const body = (await res.json()) as { persons?: { full_name: string }[] };
      return (body.persons ?? []).map((p) => p.full_name);
    },
    { ws: workspaceId, term },
  );
}

test.describe('import contacts from a sheet', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('reads a CSV, proposes the columns, imports two contacts and undoes them', async ({ page }) => {
    test.setTimeout(120_000);
    const mark = Date.now().toString(36);
    const file = `zzz-e2e-contacts-${mark}.csv`;
    const ana = `ZZZ Ana ${mark}`;
    const pau = `ZZZ Pau ${mark}`;
    const org = `ZZZ Sala ${mark}`;
    const csv = [
      'Name;Organization;Email;Zone',
      `${ana};${org};zzz-ana-${mark}@example.org;North`,
      `${pau};${org};zzz-pau-${mark}@example.org;`,
    ].join('\n');

    await page.goto('/h/conversations');
    await waitForLoaded(page);
    const workspaceId = await playwrightWorkspaceId(page);
    let importId: string | null = null;

    try {
      await page.getByRole('button', { name: /^Add:/ }).click();
      await page.getByRole('menuitem', { name: 'Import contacts' }).click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog.getByTestId('contact-import-drop')).toBeVisible({ timeout: 20_000 });
      const space = dialog.getByLabel('Space');
      if (await space.count()) await space.selectOption({ value: workspaceId });
      await dialog.getByTestId('contact-import-file').setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
      await expect(dialog.getByText('Rows read: 2')).toBeVisible();
      await dialog.getByRole('button', { name: 'Continue' }).click();

      const columns = dialog.getByTestId('contact-import-columns');
      await expect(columns.getByLabel('«Name» in Hour')).toHaveValue('person_name');
      await expect(columns.getByLabel('«Organization» in Hour')).toHaveValue('org_name');
      await expect(columns.getByLabel('«Email» in Hour')).toHaveValue('email');
      await expect(columns.getByLabel('«Zone» in Hour')).toHaveValue('note');
      await dialog.getByRole('button', { name: 'Continue' }).click();

      const tally = dialog.getByTestId('contact-import-tally');
      await expect(tally).toContainText('New contacts', { timeout: 20_000 });
      await expect(dialog.getByTestId('contact-import-rows').locator('li')).toHaveCount(2);
      await dialog.getByRole('button', { name: 'Import 2' }).click();

      const result = dialog.getByTestId('contact-import-result');
      await expect(result).toBeVisible({ timeout: 30_000 });
      await expect(result).toContainText('New contacts');
      const mine = (await imports(page, workspaceId)).find((i) => i.filename === file);
      expect(mine).toMatchObject({ persons_created: 2, organizations_created: 1, status: 'done' });
      importId = mine!.id;
      expect(await found(page, workspaceId, `ZZZ Ana ${mark}`)).toContain(ana);

      await dialog.getByRole('button', { name: 'Undo the import' }).click();
      const confirm = page.getByRole('dialog').filter({ hasText: `Undo «${file}»` });
      await confirm.getByRole('button', { name: 'Undo' }).click();
      await expect(page.locator('.toast', { hasText: 'Import undone.' })).toBeVisible();
      expect((await imports(page, workspaceId)).find((i) => i.id === importId)?.status).toBe('undone');
      // The fixture space is bloated and its search answers in 5 to 6 s: the default 5 s poll is one request.
      await expect.poll(() => found(page, workspaceId, `ZZZ Ana ${mark}`), { timeout: 30_000 }).not.toContain(ana);
      importId = null;
    } finally {
      if (importId) {
        await page.evaluate(async (id) => {
          await fetch(`/api/contact-imports/${id}`, { method: 'DELETE' });
        }, importId);
      }
    }
  });
});
