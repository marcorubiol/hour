import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E: the venue's record and the project's are a mirror (ADR-177 § 4).
 *
 * 1. The organization's record: one row per project, with its colour, that
 *    is the chat with it (the row links the conversation), and under it its
 *    bolo with the fee.
 * 2. The project's record: one row per venue in «Bolos», linking the same
 *    conversation, with the same bolo and fee; the head's facts line says
 *    what was sold.
 * 3. The chat row everywhere (task 120, mesa punto 6): the organization's
 *    row says the last thing said and the turn in words; with a step due
 *    today, the project's conversations block and Hoy's «Te espera» say it.
 *
 * Besides the bolo, the conversation holds one outbound message of ours,
 * written once (the history is append-only). The step is set for the test
 * and cleared before and after it.
 *
 * THE SPEC OWNS ITS ROWS, in `playwright`, project `zzz-e2e-collab`: one
 * conversation with the organization «ZZZ E2E Mirror Sala» and one bolo on
 * it, found by name or created once and reused on every run (a bolo has no
 * delete path, so a fresh one per run would pile up; the conversation stays
 * so the bolo keeps its venue). The bolo is left confirmed with its fee, as
 * the run found it. Never touches `muk-cia`.
 */
const PROJECT_SLUG = 'zzz-e2e-collab';
const PROJECT = 'ZZZ e2e collab';
const SALA = 'ZZZ E2E Mirror Sala';
const FEE = 2400;
const NOTE = 'ZZZ E2E mirror step';

type Owned = { conversationId: string; orgSlug: string };

async function ownRows(page: Page): Promise<Owned> {
  return page.evaluate(
    async ({ slug, sala, fee }) => {
      const wsBody = (await fetch('/api/workspaces').then((r) => r.json())) as { items: Array<{ id: string; slug: string }> };
      const ws = wsBody.items.find((w) => w.slug === 'playwright');
      if (!ws) throw new Error('no fixture workspace');
      const projects = (await fetch('/api/projects?status=active').then((r) => r.json())) as {
        items: Array<{ id: string; slug: string; workspace_id: string }>;
      };
      const projectId = projects.items.find((p) => p.workspace_id === ws.id && p.slug === slug)?.id;
      if (!projectId) throw new Error(`no project ${slug}`);

      type Conv = { id: string; organization: { slug: string; name: string } | null };
      const find = async () => {
        const list = (await fetch(
          `/api/conversations?project_ids=${projectId}&q=${encodeURIComponent(sala)}&limit=20`,
        ).then((r) => r.json())) as { items: Conv[] };
        return list.items.find((c) => c.organization?.name === sala) ?? null;
      };
      let conv = await find();
      if (!conv) {
        // A soft-deleted one revives (one per organization and project, ADR-102 § 3).
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, organization: { name: sala } }),
        });
        if (!res.ok && res.status !== 409) throw new Error(`create conversation ${res.status}`);
        conv = await find();
      }
      if (!conv?.organization) throw new Error('no fixture conversation');

      type Bolo = { id: string; venue_name: string | null };
      const bolos = (await fetch(`/api/money/bolos?project_ids=${projectId}&limit=500`).then((r) => r.json())) as {
        items: Bolo[];
      };
      let bolo = bolos.items.find((b) => b.venue_name === sala);
      if (!bolo) {
        const res = await fetch('/api/money/bolos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            conversation_id: conv.id,
            venue_name: sala,
            city: 'Girona',
            fee_amount: fee,
            fee_currency: 'EUR',
          }),
        });
        if (!res.ok) throw new Error(`create bolo ${res.status}`);
        bolo = ((await res.json()) as { bolo: Bolo }).bolo;
      }
      const patch = await fetch(`/api/money/bolos/${bolo.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed', fee_amount: fee, fee_currency: 'EUR' }),
      });
      if (!patch.ok) throw new Error(`patch bolo ${patch.status}`);

      // The last thing said (mesa, punto 6): one message of ours, written once
      // (the history is append-only), so the turn is theirs on every run.
      type Ev = { direction: string | null; kind: string };
      const events = (await fetch(`/api/conversations/${conv.id}/events`).then((r) => r.json())) as { items: Ev[] };
      if (!events.items.some((e) => e.direction === 'outbound' && e.kind === 'message')) {
        const res = await fetch(`/api/conversations/${conv.id}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'message', direction: 'outbound', body: 'ZZZ E2E mirror: dossier' }),
        });
        if (!res.ok) throw new Error(`record event ${res.status}`);
      }

      // No step at the start. The test sets one and clears it in `finally`,
      // but a run killed mid-test never gets there: one left «ZZZ E2E mirror
      // step» overdue, and the row (rightly) said the follow-up instead of
      // the last thing said.
      const clear = await fetch(`/api/conversations/${conv.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ next_action_at: null, next_action_note: null }),
      });
      if (!clear.ok) throw new Error(`clear step ${clear.status}`);
      return { conversationId: conv.id, orgSlug: conv.organization.slug };
    },
    { slug: PROJECT_SLUG, sala: SALA, fee: FEE },
  );
}

test.describe('sheet mirror', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('the venue shows the project with its bolo and fee; the project mirrors it', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/h/desk');
    const owned = await ownRows(page);
    const href = `/h/playwright/conversation/${owned.conversationId}`;

    // 1. The organization's record.
    await page.goto(`/h/playwright/organization/${encodeURIComponent(owned.orgSlug)}`);
    await waitForLoaded(page);
    const projectRow = page.getByTestId('organization-projects').getByTestId('mirror-row').filter({ hasText: PROJECT });
    await expect(projectRow).toHaveCount(1, { timeout: 15_000 });
    await expect(projectRow.getByRole('link', { name: PROJECT, exact: true })).toHaveAttribute('href', href);
    await expect(projectRow.getByTestId('mirror-bolo')).toContainText('2,400');
    // No «Abrir el chat»: the row is the chat, with the last thing said and the turn in words.
    await expect(page.getByRole('link', { name: /open (the )?chat/i })).toHaveCount(0);
    await expect(projectRow).toContainText('You');
    await expect(projectRow).toContainText(/waiting for their reply/i);

    // A step due today: Hoy asks for it, and the project's block puts it first.
    const step = async (at: string | null) =>
      page.evaluate(
        async ({ id, at, note }) => {
          const res = await fetch(`/api/conversations/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ next_action_at: at, next_action_note: at ? note : null }),
          });
          if (!res.ok) throw new Error(`patch conversation ${res.status}`);
        },
        { id: owned.conversationId, at, note: NOTE },
      );
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await step(today);
    try {
      // 2. The project's record, its mirror.
      await page.goto(`/h/playwright/project/${PROJECT_SLUG}`);
      await waitForLoaded(page);
      const salaRow = page.getByTestId('project-bolos').getByTestId('mirror-row').filter({ hasText: SALA });
      await expect(salaRow).toHaveCount(1, { timeout: 15_000 });
      await expect(salaRow.getByRole('link', { name: SALA, exact: true })).toHaveAttribute('href', href);
      await expect(salaRow.getByTestId('mirror-bolo')).toContainText('2,400');
      await expect(page.getByTestId('project-fact').filter({ hasText: /^sold / })).toHaveCount(1);
      // The conversations block is the lens's chat row: the step it asks for, in words.
      const chatRow = page.getByTestId('project-conversations').getByTestId('project-conversation').filter({ hasText: SALA });
      await expect(chatRow).toHaveCount(1, { timeout: 15_000 });
      await expect(chatRow).toContainText(NOTE);

      // 3. Hoy: the «Te espera» row is the chat row, the verb on its left.
      await page.goto('/h/desk');
      await waitForLoaded(page);
      const waits = page.locator('section.waits');
      const seeAll = waits.getByRole('button', { name: /^See all by day/ });
      const deskRow = waits.getByTestId('desk-chat').filter({ hasText: SALA });
      await expect(deskRow.or(seeAll).first()).toBeVisible({ timeout: 15_000 });
      if ((await deskRow.count()) === 0) await seeAll.click();
      await expect(deskRow.first()).toContainText(NOTE);
      await expect(deskRow.first().getByRole('link', { name: SALA, exact: true })).toHaveAttribute('href', href);
    } finally {
      await step(null);
    }
  });
});
