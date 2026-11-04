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
    // No «Abrir el chat»: the row is the chat.
    await expect(page.getByRole('link', { name: /open (the )?chat/i })).toHaveCount(0);

    // 2. The project's record, its mirror.
    await page.goto(`/h/playwright/project/${PROJECT_SLUG}`);
    await waitForLoaded(page);
    const salaRow = page.getByTestId('project-bolos').getByTestId('mirror-row').filter({ hasText: SALA });
    await expect(salaRow).toHaveCount(1, { timeout: 15_000 });
    await expect(salaRow.getByRole('link', { name: SALA, exact: true })).toHaveAttribute('href', href);
    await expect(salaRow.getByTestId('mirror-bolo')).toContainText('2,400');
    await expect(page.getByTestId('project-fact').filter({ hasText: /^sold / })).toHaveCount(1);
  });
});
