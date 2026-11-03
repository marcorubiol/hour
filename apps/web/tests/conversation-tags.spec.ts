import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E · etiquetas de conversación, fase 2 (ADR-138 § 1 y 2).
 *
 * 1. Desde ADR-176 la etiqueta es un filtro, no un chip: la fila de chips es
 *    All · Our turn · No news · Team (those at 0 hidden), y Press (por la URL) es el valor del
 *    select Tag de «Filter ▾» y un chip que se quita. Con «Select» (las
 *    acciones en bloque son de todas, plan de la lista § 6.2) y sin «Write to
 *    N» (el envío es de Difusión) ni temporada.
 * 2. «Añadir» con Press nace con Press: sale con Press, no con Venues, y en
 *    All (una sola lista desde la fase 3) con su etiqueta en la línea de contexto.
 * 3. La ficha enseña sus etiquetas y quien edita las cambia (en el panel de al
 *    lado, a la anchura de escritorio): con Venues también, sale con Venues,
 *    que sí ofrece «Select».
 * 4. (Fuera: `?view=team` → `?etiqueta=team`, ADR-165 § 4 quitó la redirección.)
 *
 * Fixture: `playwright`, proyecto `ZZZ e2e collab`, organización propia
 * `ZZZ E2E Press`. Se recoge al empezar (por si una pasada murió a medias) y
 * se borra al final. Nunca toca `muk-cia`: la lista va acotada a `playwright`.
 * Solo contra un origen desplegado con 20261020160000.
 */
const ORG = 'ZZZ E2E Press';
const LENS = '/h/conversations?scope=s:playwright';

async function sweep(page: Page) {
  await page.evaluate(async (org) => {
    const list = await fetch(`/api/conversations?q=${encodeURIComponent(org)}`);
    const items = ((await list.json()) as { items: Array<{ id: string; organization: { name: string } | null }> }).items;
    for (const i of items.filter((x) => x.organization?.name === org)) {
      await fetch(`/api/conversations/${i.id}`, { method: 'DELETE' });
    }
  }, ORG);
}

async function search(page: Page) {
  await page.getByPlaceholder('Search conversations and team…').fill(ORG);
}

/** The Tag of «Filter ▾»: the tag is a filter of the list (ADR-176). */
async function filterTag(page: Page, key: string) {
  await page.locator('.conversations__filter-open').click();
  const sheet = page.getByRole('dialog', { name: 'Filter' });
  await sheet.getByLabel('Tag').selectOption(key);
  await expect(page).toHaveURL(new RegExp(`etiqueta=${key}`));
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).not.toBeVisible();
}

test.describe('conversation tags', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('chips, add under Press, the tag on the row and the file, change it', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`${LENS}&etiqueta=press`);
    await waitForLoaded(page);
    await sweep(page);

    // A red here must not leave its org-only row on top of the list: other
    // specs read the first row of Conversations and expect a contact.
    try {
      // 1. The chips, Todo active; Press is the Tag filter. Selection, but no bulk send and no season outside Difusión.
      const chips = page.locator('.conversations__chips [data-chip]');
      await expect(chips.first()).toHaveAttribute('data-chip', 'todo');
      // A chip at 0 is not shown (ADR-177): only All, the one on, may read 0.
      for (const n of await page.locator('.conversations__chips [data-chip]:not([data-chip="todo"]) .conversations__chip-n').allTextContents()) {
        expect(n).not.toBe('0');
      }
      await expect(page.locator('.conversations__chips [data-chip="todo"]')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.conversations__chips [data-chip="press"]')).toHaveCount(0);
      await expect(page.locator('.conversations__active')).toContainText('Press');
      await expect(page.locator('.conversations__filter-open')).toHaveAttribute('aria-label', 'Filter, 1 on');
      await page.locator('.conversations__filter-open').click();
      const sheet = page.getByRole('dialog', { name: 'Filter' });
      await expect(sheet.getByLabel('Tag')).toHaveValue('press');
      // In English the sales tag is «Venues» (ADR-137).
      await expect(sheet.getByLabel('Tag').locator('option[value="sales"]')).toHaveText('Venues');
      await sheet.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByRole('button', { name: /^Select$/ })).toBeVisible();
      await page.getByRole('button', { name: /^Select$/ }).click();
      await expect(page.getByRole('toolbar', { name: 'Actions on the selection' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Write to/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Stop selecting' }).first().click();
      await expect(page.getByTestId('block-season')).toHaveCount(0);

      // 2. Added under Press, it is born with Press.
      await page.getByRole('button', { name: 'Add conversation' }).click();
      const dialog = page.locator('dialog[open]');
      await dialog.getByLabel('ZZZ e2e collab').check({ force: true });
      await dialog.getByLabel('Organization').fill(ORG);
      // The tag lives folded under «More», whose lid already names it.
      const more = dialog.getByRole('button', { name: /^More/ });
      await expect(more).toContainText('Press');
      await more.click();
      await expect(dialog.getByLabel('Tag')).toHaveValue('press');
      await dialog.getByRole('button', { name: 'Add conversation' }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10_000 });

      // Searching with a chip on goes through rpc/conversation_search, which
      // only orders by what it selects (42703 before the fix).
      await search(page);
      const row = page.locator('main [data-testid="feed-row"]', { hasText: ORG });
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByText('The conversations could not be read.')).toHaveCount(0);
      // Filtered by its own tag the row does not repeat it in its context line.
      await expect(row.locator('.chat__ctx')).not.toContainText('Press');

      await filterTag(page, 'sales');
      await search(page);
      await expect(page.locator('main [data-testid="feed-row"]', { hasText: ORG })).toHaveCount(0, { timeout: 15_000 });

      // Taking the tag off (its chip under the search) is the plain list.
      await page.locator('.conversations__active').getByRole('button', { name: 'Remove «Venues»' }).click();
      await expect(page).not.toHaveURL(/etiqueta=/);
      await search(page);
      // Todas is one list since phase 3 (conversations and threads, one order),
      // and its search reads both sources.
      const all = page.getByTestId('conversation-feed').getByTestId('feed-row').filter({ hasText: ORG });
      await expect(all).toHaveCount(1, { timeout: 15_000 });
      await expect(all).toHaveAttribute('data-kind', 'conversation');
      // Its tag rides in the context line (ChatRow), as in the filtered list's rows.
      await expect(all.locator('.chat__ctx')).toContainText('Press');

      // 3. The file shows its tags; whoever edits changes them. At desktop width
      //    the row opens it in the pane beside the list (ADR-176), not the vistazo.
      await all.locator('a.chat__title').click();
      await expect(page).toHaveURL(/abierta=playwright%2F|abierta=playwright\//);
      // The peek's dialog is always in the page (PeekHost): closed, not absent.
      await expect(page.getByTestId('peek')).toBeHidden();
      // Since 110 the tags live in the record's details (ConversationRecord): «·details ›» opens them.
      const pane = page.getByTestId('conversation-pane');
      await pane.getByTestId('conversation-who').click();
      const tags = page.getByTestId('record-details').getByTestId('conversation-tags');
      await expect(tags.locator('.tag-chip')).toHaveText(['Press'], { timeout: 15_000 });
      await tags.getByRole('button', { name: 'Change' }).click();
      await tags.getByLabel('Venues').check({ force: true });
      await tags.getByRole('button', { name: 'Done' }).click();
      await expect(tags.locator('.tag-chip')).toHaveText(['Venues', 'Press'], { timeout: 15_000 });

      await page.goto(`${LENS}&etiqueta=sales`);
      await waitForLoaded(page);
      await search(page);
      await expect(page.locator('main [data-testid="feed-row"]', { hasText: ORG })).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByRole('button', { name: /^Select$/ })).toBeVisible();
    } finally {
      await sweep(page);
    }
  });

  // `?view=team` → `?etiqueta=team` no se prueba: ADR-165 § 4 quitó la redirección.
});
