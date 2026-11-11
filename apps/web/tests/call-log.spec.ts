import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E: «Apuntar llamada» from the Conversations lens head (121 A, ADR-182).
 *
 * THE SUITE OWNS ITS ROW (see conversation-write.spec.ts): a fixture person
 * in the `playwright` workspace, project zzz-e2e-collab, created and
 * soft-deleted here. The person persists globally (find-or-create on the
 * e-mail); the conversation resurrects from its soft-deleted state.
 *
 * 1. With a conversation: search, pick, «They called», a note, «Log call»;
 *    the call waits out «Undo», «See conversation» writes it and opens the
 *    file; the event is a `call`, `inbound`, with the note.
 * 2. Without one: the dialog asks the show, «Open and log» opens the
 *    conversation by the same POST /api/conversations, and «Undo» deletes it
 *    and writes nothing.
 */

const NAME = 'ZZZ E2E Call';
const PERSON_EMAIL = 'zzz-e2e-call@hour.test';
const PROJECT_LABEL = 'ZZZ e2e collab';

type Live = { id: string; project_id: string; person: { email: string | null } | null };

async function fixtureProjectId(page: Page): Promise<string> {
  return await page.evaluate(async (): Promise<string> => {
    type Ws = { id: string; slug: string };
    type Pr = { id: string; slug: string; workspace_id: string };
    const ws = ((await fetch('/api/workspaces').then((r) => r.json())) as { items: Ws[] }).items.find(
      (w) => w.slug === 'playwright',
    );
    if (!ws) throw new Error('no fixture workspace');
    const pr = ((await fetch('/api/projects?status=active').then((r) => r.json())) as { items: Pr[] }).items.find(
      (p) => p.workspace_id === ws.id && p.slug === 'zzz-e2e-collab',
    );
    if (!pr) throw new Error('no fixture project');
    return pr.id;
  });
}

/** The live conversations of the fixture person. */
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

async function openCallDialog(page: Page) {
  await page.goto('/h/conversations');
  await waitForLoaded(page);
  await page.getByRole('button', { name: /^Add:/ }).click();
  await page.getByRole('menuitem', { name: 'Call' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: 'Who with?' })).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Person or organization' }).fill(NAME);
  return dialog;
}

test.describe('log a call from the lens head', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('with a conversation: the call lands there, inbound, with its note', async ({ page }) => {
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

    try {
      const dialog = await openCallDialog(page);
      const row = dialog.getByTestId('call-target').filter({ hasText: NAME }).first();
      // The rows come from GET /api/conversations/call-targets: on a cold
      // production origin that round trip outruns the 5 s default.
      await expect(row).toContainText('1 conversation', { timeout: 20_000 });
      await row.click();
      await expect(dialog.getByRole('heading', { name: `Call with ${NAME}` })).toBeVisible();
      await dialog.getByText('They called').click();
      await dialog.getByLabel('What was said').fill('E2E: asks for the rider');
      await dialog.getByRole('button', { name: 'Log call' }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10_000 });

      const toast = page.locator('.toast', { hasText: `Call with ${NAME} logged.` });
      await expect(toast).toBeVisible();
      await toast.getByRole('button', { name: 'See conversation' }).click();
      await expect(page).toHaveURL(new RegExp(`/conversation/${created}`));

      const events = await page.evaluate(async (id) => {
        const res = await fetch(`/api/conversations/${id}/events`);
        return ((await res.json()) as { items: { kind: string; direction: string | null; body: string | null }[] }).items;
      }, created);
      expect(events.find((e) => e.body === 'E2E: asks for the rider')).toMatchObject({ kind: 'call', direction: 'inbound' });
    } finally {
      await clean(page);
    }
  });

  test('without a conversation: asks the show, opens one, and Undo takes it back', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/h/conversations');
    await waitForLoaded(page);
    // The person's dossier exists (the first test, or an earlier run); a
    // fresh one is born from a create + delete.
    const projectId = await fixtureProjectId(page);
    await page.evaluate(
      async ({ projectId, name, email }) => {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, person: { full_name: name, email } }),
        });
        const id = res.ok ? ((await res.json()) as { conversation: { id: string } }).conversation.id : null;
        if (id) await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      },
      { projectId, name: NAME, email: PERSON_EMAIL },
    );
    await clean(page);

    try {
      const dialog = await openCallDialog(page);
      const row = dialog.getByTestId('call-target').filter({ hasText: NAME }).first();
      await expect(row).toContainText('no conversation yet', { timeout: 20_000 });
      await row.click();
      await expect(dialog.getByText(`There is no conversation with ${NAME} yet.`)).toBeVisible();
      const show = dialog.getByLabel('Which show?');
      if (await show.evaluate((el) => el.tagName === 'SELECT')) await show.selectOption({ label: PROJECT_LABEL });
      else await dialog.getByText(PROJECT_LABEL, { exact: true }).click();
      // The conversation is opened by this POST; checking it with another
      // round trip would spend the 6 s «Undo» window (CREATED_TOAST_MS).
      const opened = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/conversations',
      );
      await dialog.getByRole('button', { name: 'Open and log' }).click();
      expect((await opened).status()).toBeLessThan(300);
      await expect(dialog).not.toBeVisible({ timeout: 10_000 });

      const toast = page.locator('.toast', { hasText: `Call with ${NAME} logged.` });
      await toast.getByRole('button', { name: 'Undo' }).click({ timeout: 5_000 });
      await expect(page.locator('.toast', { hasText: 'Undone' })).toBeVisible();
      await expect.poll(async () => (await liveConversations(page)).length).toBe(0);
    } finally {
      await clean(page);
    }
  });
});
