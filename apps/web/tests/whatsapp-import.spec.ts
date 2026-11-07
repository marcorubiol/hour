import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E: «Import chat» (128, ADR-189), the WhatsApp «Export chat» brought into
 * Hour.
 *
 * THE SUITE OWNS ITS ROW (see conversation-write.spec.ts): a fixture person
 * in the `playwright` workspace, project zzz-e2e-collab, created and
 * soft-deleted here. Each run writes messages with its own mark in the text,
 * so their fingerprints are new every time; the messages themselves stay
 * (phase 1 has no delete path), out of view once the conversation is gone.
 *
 * 1. `?importar` (the iPhone shortcut) opens the sheet; a .txt in the
 *    iPhone format is read on the device; the other author is matched to
 *    the person by name; «You in this chat» picks the importer; the only
 *    candidate conversation takes the burst; «Import» waits out «Undo» and
 *    writes WhatsApp events with the text, inbound and outbound.
 * 2. The same file again: nothing new, nothing to import.
 * 3. «Undo» writes nothing.
 */

const NAME = 'ZZZ E2E WhatsApp';
const PERSON_EMAIL = 'zzz-e2e-whatsapp@hour.test';
const ME = 'ZZZ Me';

type Live = { id: string; person: { email: string | null } | null };
type Ev = { source: string; direction: string | null; body: string | null; via: string | null; sender?: string | null };

async function fixtureProjectId(page: Page): Promise<string> {
  return await page.evaluate(async (): Promise<string> => {
    type Ws = { id: string; slug: string };
    type Pr = { id: string; slug: string; workspace_id: string };
    const ws = ((await fetch('/api/workspaces').then((r) => r.json())) as { items: Ws[] }).items.find((w) => w.slug === 'playwright');
    if (!ws) throw new Error('no fixture workspace');
    const pr = ((await fetch('/api/projects?status=active').then((r) => r.json())) as { items: Pr[] }).items.find(
      (p) => p.workspace_id === ws.id && p.slug === 'zzz-e2e-collab',
    );
    if (!pr) throw new Error('no fixture project');
    return pr.id;
  });
}

async function liveConversations(page: Page): Promise<Live[]> {
  return await page.evaluate(
    async ({ name, email }) => {
      const res = await fetch(`/api/conversations?q=${encodeURIComponent(name)}`);
      return ((await res.json()) as { items: Live[] }).items.filter((i) => i.person?.email === email);
    },
    { name: NAME, email: PERSON_EMAIL },
  );
}

async function clean(page: Page) {
  const live = await liveConversations(page);
  await page.evaluate(async (ids) => {
    for (const id of ids) await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  }, live.map((c) => c.id));
}

async function events(page: Page, id: string): Promise<Ev[]> {
  return await page.evaluate(async (id) => {
    const res = await fetch(`/api/conversations/${id}/events`);
    return ((await res.json()) as { items: Ev[] }).items;
  }, id);
}

/** An iPhone export of today, a few minutes ago, with this run's mark in every text. */
function exportText(mark: string): string {
  const now = new Date();
  const at = (minAgo: number) => {
    const d = new Date(now.getTime() - minAgo * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `[${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}, ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`;
  };
  return [
    `${at(30)} ${NAME}: E2E ${mark}: do you have dates in May?`,
    `${at(25)} ${ME}: E2E ${mark}: yes, 12 to 16 May.`,
    `${at(24)} ${NAME}: ‎image omitted`,
  ].join('\n');
}

async function openSheet(page: Page, mark: string) {
  await page.goto('/h/conversations?importar');
  await waitForLoaded(page);
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByTestId('wa-import-drop')).toBeVisible({ timeout: 20_000 });
  await dialog.getByTestId('wa-import-file').setInputFiles({
    name: `WhatsApp Chat with ${NAME}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(exportText(mark), 'utf8'),
  });
  await expect(dialog.getByTestId('wa-import-summary')).toBeVisible();
  // The context round trip (who is who, what is known) on a cold origin.
  await expect(dialog.getByText('Who is who')).toBeVisible({ timeout: 20_000 });
  await dialog.getByLabel('You in this chat').selectOption({ label: ME });
  return dialog;
}

test.describe('import a WhatsApp chat', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('imports into the only candidate, says it is imported, and a second import adds nothing', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/h/conversations');
    await waitForLoaded(page);
    await clean(page);
    const projectId = await fixtureProjectId(page);
    const created = await page.evaluate(
      async ({ projectId, name, email }) => {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, person: { full_name: name, email } }),
        });
        return ((await res.json()) as { conversation: { id: string } }).conversation.id;
      },
      { projectId, name: NAME, email: PERSON_EMAIL },
    );
    const mark = Date.now().toString(36);

    try {
      const dialog = await openSheet(page, mark);
      await expect(dialog.getByLabel(`«${NAME}» is`)).toHaveValue(/.+/);
      const sites = dialog.getByTestId('wa-import-sites');
      await expect(sites).toContainText('messages: 3');
      await dialog.getByRole('button', { name: 'Import (3)' }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('.toast', { hasText: 'Messages imported: 3.' })).toBeVisible();

      // It writes once «Undo» runs out.
      await expect
        .poll(async () => (await events(page, created)).filter((e) => e.source === 'whatsapp').length, { timeout: 20_000 })
        .toBe(3);
      const evs = (await events(page, created)).filter((e) => e.source === 'whatsapp');
      expect(evs.find((e) => e.body?.includes('dates in May'))).toMatchObject({ direction: 'inbound', via: 'whatsapp', sender: NAME });
      expect(evs.find((e) => e.body?.includes('12 to 16 May'))).toMatchObject({ direction: 'outbound' });

      await page.goto(`/h/playwright/conversation/${created}`);
      await expect(page.getByTestId('thread-logged').filter({ hasText: 'dates in May' })).toContainText('imported');
      await expect(page.getByTestId('thread-attachments').first()).toContainText('Photo');

      // The same file again: everything is already there.
      const again = await openSheet(page, mark);
      await expect(again.getByTestId('wa-import-known')).toContainText('Already in Hour: 3');
      await expect(again.getByText('Nothing new')).toBeVisible();
      await expect(again.getByRole('button', { name: 'Import (0)' })).toBeDisabled();
    } finally {
      await clean(page);
    }
  });

  test('Undo writes nothing', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/h/conversations');
    await waitForLoaded(page);
    await clean(page);
    const projectId = await fixtureProjectId(page);
    const created = await page.evaluate(
      async ({ projectId, name, email }) => {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, person: { full_name: name, email } }),
        });
        return ((await res.json()) as { conversation: { id: string } }).conversation.id;
      },
      { projectId, name: NAME, email: PERSON_EMAIL },
    );
    const mark = `undo-${Date.now().toString(36)}`;

    try {
      const dialog = await openSheet(page, mark);
      await dialog.getByRole('button', { name: 'Import (3)' }).click();
      const toast = page.locator('.toast', { hasText: 'Messages imported: 3.' });
      await toast.getByRole('button', { name: 'Undo' }).click();
      await page.waitForTimeout(8_000);
      const evs = (await events(page, created)).filter((e) => e.body?.includes(mark));
      expect(evs).toHaveLength(0);
    } finally {
      await clean(page);
    }
  });
});
