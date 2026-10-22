import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — fusionar dos fichas y deshacer (plan 2026-10-22, fase 2).
 *
 * Crea dos fichas de la misma «persona» en `playwright` (nunca `muk-cia`: sus
 * contactos son reales), con emails distintos y una nota en la que va a
 * desaparecer. Desde la ficha que se queda: «Merge with…», elige la otra,
 * lee la vista previa (la nota se cuenta, el email que se pierde se dice),
 * se queda con el email de la otra, fusiona. La URL vieja abre la que queda.
 * «Undo the merge» devuelve las dos. Al final borra lo que hizo.
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

async function createPerson(page: Page, wsId: string, fullName: string, email: string): Promise<Dossier> {
  return page.evaluate(
    async ({ wsId, fullName, email }) => {
      const r = await fetch('/api/persons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: wsId, full_name: fullName, email }),
      });
      if (!r.ok) throw new Error(`create person ${r.status}`);
      return ((await r.json()) as { person: Dossier }).person;
    },
    { wsId, fullName, email },
  );
}

test.describe('person merge', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('two files → merge with a field choice → old URL → undo → cleanup', async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const keepName = `E2E Merge ${stamp}`;
    const dropName = `E2E Merge ${stamp} Ruiz`;
    const keepEmail = `merge-keep-${stamp}@example.test`;
    const dropEmail = `merge-drop-${stamp}@example.test`;
    const noteBody = `merge-note-${stamp}`;

    await page.goto('/h/planner');
    await waitForLoaded(page);
    const wsId = await workspaceId(page);
    // The older one stays by default: create it first.
    const keep = await createPerson(page, wsId, keepName, keepEmail);
    const drop = await createPerson(page, wsId, dropName, dropEmail);
    const noteId = await page.evaluate(
      async ({ slug, wsId, body }) => {
        const r = await fetch(`/api/persons/${slug}/notes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspace_id: wsId, body, on_day: new Date().toLocaleDateString('en-CA') }),
        });
        return ((await r.json()) as { note?: { id: string } }).note?.id ?? null;
      },
      { slug: drop.slug, wsId, body: noteBody },
    );

    try {
      await page.goto(`/h/${WORKSPACE}/person/${keep.slug}`);
      await waitForLoaded(page);
      await expect(page.getByRole('heading', { name: keepName, level: 1 })).toBeVisible();

      // ── Merge with… ──────────────────────────────────────────────────
      await page.getByRole('button', { name: 'Merge with…' }).click();
      const dlg = page.locator('dialog[open]');
      await expect(dlg.getByRole('heading', { name: 'Merge two files' })).toBeVisible();
      await dlg.getByRole('combobox', { name: 'The other file' }).fill(`${stamp} Ruiz`);
      await dlg.getByRole('option', { name: dropName }).click();

      // The preview: what moves (the caller's own note), what is chosen.
      await expect(dlg.getByTestId('merge-moves')).toContainText(`Moves to “${keepName}”: 1 of your notes.`);
      await expect(dlg.getByText(`${dropName} goes`)).toBeVisible();
      await expect(dlg.getByText(`${dropEmail} stops bringing mail into Hour.`)).toBeVisible();
      await dlg.getByRole('radio', { name: dropEmail }).check();
      await expect(dlg.getByText(`${keepEmail} stops bringing mail into Hour.`)).toBeVisible();
      await expect(dlg.getByText('It can be undone for 30 days.')).toBeVisible();

      await dlg.getByRole('button', { name: 'Merge', exact: true }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(page.getByText('Files merged.')).toBeVisible();

      // The file that stays: the chosen email, the note, the line with its undo.
      await expect(page.getByRole('link', { name: dropEmail })).toBeVisible();
      await expect(page.getByText(noteBody, { exact: true })).toBeVisible();
      const line = page.getByTestId('person-merged');
      await expect(line).toContainText(`Merged with ${dropName}`);

      // The old address opens the file that stays.
      await page.goto(`/h/${WORKSPACE}/person/${drop.slug}`);
      await page.waitForURL(new RegExp(`/person/${keep.slug}$`));
      await expect(page.getByRole('heading', { name: keepName, level: 1 })).toBeVisible();

      // ── Undo ─────────────────────────────────────────────────────────
      await page.getByTestId('person-merged').getByRole('button', { name: 'Undo the merge' }).click();
      await expect(page.getByText(`Merge undone: ${dropName} has their own file again.`)).toBeVisible();
      await expect(page.getByTestId('person-merged')).toHaveCount(0);
      await expect(page.getByRole('link', { name: keepEmail })).toBeVisible();

      await page.goto(`/h/${WORKSPACE}/person/${drop.slug}`);
      await waitForLoaded(page);
      await expect(page.getByRole('heading', { name: dropName, level: 1 })).toBeVisible();
      await expect(page.getByText(noteBody, { exact: true })).toBeVisible();
    } finally {
      await page.evaluate(
        async ({ wsId, keepId, dropId, dropSlug, noteId }) => {
          if (noteId) await fetch(`/api/persons/${dropSlug}/notes/${noteId}`, { method: 'DELETE' });
          for (const id of [dropId, keepId]) {
            await fetch(`/api/persons/${id}?workspace_id=${wsId}`, { method: 'DELETE' });
          }
        },
        { wsId, keepId: keep.person_id, dropId: drop.person_id, dropSlug: drop.slug, noteId },
      );
    }
  });
});
