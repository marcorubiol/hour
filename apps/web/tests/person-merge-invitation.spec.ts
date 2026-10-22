import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — la invitación aceptada por una cuenta que ya es otra persona
 * (plan 2026-10-22, fase 3; necesita `20261022180000_person_merge_notices`).
 *
 * En `playwright` (nunca `muk-cia`): crea una ficha, la invita al email del
 * usuario del E2E y la acepta con él, que ya es otra persona. La ficha dice
 * «Falta: aceptó la invitación…» con «join»; el diálogo abre con la otra
 * ficha elegida; fusiona. Ajustes › Espacios la lista en «Recent merges» y la
 * deshace desde allí. Una fusión deshecha no vuelve a avisar. Al final borra
 * la ficha.
 */

const WORKSPACE = 'playwright';

type Dossier = { person_id: string; slug: string; full_name: string };

async function workspaceId(page: Page): Promise<string> {
  return page.evaluate(async (ws) => {
    const r = await fetch('/api/workspaces');
    const items = ((await r.json()) as { items: Array<{ id: string; slug: string }> }).items;
    const id = items.find((w) => w.slug === ws)?.id;
    if (!id) throw new Error(`no workspace ${ws}`);
    return id;
  }, WORKSPACE);
}

test.describe('person merge from an invitation', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('invite → accept as someone else → «Falta» → join → undo in Settings', async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const name = `E2E Unmerged ${stamp}`;

    await page.goto('/h/planner');
    await waitForLoaded(page);
    const wsId = await workspaceId(page);

    const dossier = await page.evaluate(
      async ({ wsId, name, email }) => {
        const r = await fetch('/api/persons', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspace_id: wsId, full_name: name, email: `unmerged-${Date.now()}@example.test` }),
        });
        if (!r.ok) throw new Error(`create person ${r.status}`);
        const person = ((await r.json()) as { person: Dossier }).person;
        // Invitada al email de la cuenta del E2E, que ya es otra persona.
        const inv = await fetch(`/api/workspaces/${wsId}/access`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, role: 'member', person_id: person.person_id }),
        });
        if (!inv.ok) throw new Error(`invite ${inv.status}`);
        const url = ((await inv.json()) as { invitation: { invite_url: string } }).invitation.invite_url;
        const accepted = await fetch('/api/invitations', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: url.split('#')[1] }),
        });
        if (!accepted.ok) throw new Error(`accept ${accepted.status}`);
        return person;
      },
      { wsId, name, email: EMAIL! },
    );

    try {
      // ── «Falta» on the invited file ──────────────────────────────────
      await page.goto(`/h/${WORKSPACE}/person/${dossier.slug}`);
      await waitForLoaded(page);
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      const missing = page.locator('[data-missing="unmerged_invitation"]');
      await expect(missing).toContainText(
        `Accepted the invitation (${EMAIL!.toLowerCase()}) with an account that is already someone else.`,
      );
      await missing.getByRole('button', { name: /^Join with / }).click();

      // The dialog opens on the account's file, already chosen.
      const dlg = page.locator('dialog[open]');
      await expect(dlg.getByRole('heading', { name: 'Merge two files' })).toBeVisible();
      await expect(dlg.getByTestId('merge-moves')).toBeVisible();
      await dlg.getByRole('button', { name: 'Merge', exact: true }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(page.getByText('Files merged.')).toBeVisible();
      await expect(page.getByTestId('person-merged')).toContainText(`Merged with ${name}`);
      await expect(page.locator('[data-missing="unmerged_invitation"]')).toHaveCount(0);

      // ── Settings: the recent merge, and its undo ─────────────────────
      await page.goto(`/h/${WORKSPACE}/settings?section=workspaces`);
      await waitForLoaded(page);
      const recent = page.getByTestId('settings-recent-merge').filter({ hasText: name });
      await expect(recent).toHaveCount(1);
      await expect(page.getByTestId('settings-unmerged').filter({ hasText: name })).toHaveCount(0);
      await recent.getByRole('button', { name: 'Undo the merge' }).click();
      await expect(page.getByText(`Merge undone: ${name} has their own file again.`)).toBeVisible();
      await expect(page.getByTestId('settings-recent-merge').filter({ hasText: name })).toHaveCount(0);
      // Undone means «not the same person»: it does not ask again.
      await expect(page.getByTestId('settings-unmerged').filter({ hasText: name })).toHaveCount(0);

      await page.goto(`/h/${WORKSPACE}/person/${dossier.slug}`);
      await waitForLoaded(page);
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.locator('[data-missing="unmerged_invitation"]')).toHaveCount(0);
    } finally {
      await page.evaluate(
        async ({ wsId, id }) => {
          await fetch(`/api/persons/${id}?workspace_id=${wsId}`, { method: 'DELETE' });
        },
        { wsId, id: dossier.person_id },
      );
    }
  });
});
