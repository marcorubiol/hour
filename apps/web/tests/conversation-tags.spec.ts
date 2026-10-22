import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { openInFull } from './peek';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E · etiquetas de conversación, fase 2 (ADR-138 § 1 y 2).
 *
 * 1. La fila de chips: Todas · Venues · Press · … · Team; Press activo por la
 *    URL, sin «Select» (el envío en bloque es de Difusión) ni temporada.
 * 2. «Añadir» bajo Press nace con Press: sale en Press, no en Venues, y en
 *    Todas (una sola lista desde la fase 3) con su etiqueta en la fila.
 * 3. La ficha enseña sus etiquetas y quien edita las cambia: con Venues
 *    también, sale en Venues, que sí ofrece «Select».
 * 4. `?view=team` lleva a `?etiqueta=team`.
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
    const list = await fetch(`/api/conversations?status=any&q=${encodeURIComponent(org)}`);
    const items = ((await list.json()) as { items: Array<{ id: string; organization: { name: string } | null }> }).items;
    for (const i of items.filter((x) => x.organization?.name === org)) {
      await fetch(`/api/conversations/${i.id}`, { method: 'DELETE' });
    }
  }, ORG);
}

async function search(page: Page) {
  await page.getByPlaceholder('People or organizations…').fill(ORG);
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
      // 1. The chips, Press active; no bulk send and no season outside Difusión.
      const chips = page.locator('.lenshead__sub [data-chip]');
      await expect(chips.first()).toHaveAttribute('data-chip', 'all');
      await expect(chips.last()).toHaveAttribute('data-chip', 'team');
      await expect(page.locator('.lenshead__sub [data-chip="sales"]')).toHaveText('Venues');
      await expect(page.locator('.lenshead__sub [data-chip="press"]')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('button', { name: /^Select$/ })).toHaveCount(0);
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
      const row = page.locator('main [data-testid="conversation-row"]', { hasText: ORG });
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByText('The conversations could not be read.')).toHaveCount(0);
      // Under its own chip the row does not repeat the tag.
      await expect(row.locator('.tag-chip')).toHaveCount(0);

      await page.locator('.lenshead__sub [data-chip="sales"]').click();
      await waitForLoaded(page);
      await search(page);
      await expect(page.locator('main [data-testid="conversation-row"]', { hasText: ORG })).toHaveCount(0, { timeout: 15_000 });

      await page.locator('.lenshead__sub [data-chip="all"]').click();
      await waitForLoaded(page);
      await search(page);
      // Todas is one list since phase 3 (conversations and threads, one order),
      // and its search reads both sources.
      const all = page.getByTestId('conversation-feed').getByTestId('feed-row').filter({ hasText: ORG });
      await expect(all).toHaveCount(1, { timeout: 15_000 });
      await expect(all).toHaveAttribute('data-kind', 'conversation');
      // Its tags ride after the title, in the same row as the list's (ConversationRow).
      await expect(all.locator('.conv-tags')).toHaveText('Press');
      await expect(page.getByTestId('all-threads')).toHaveCount(0);

      // 3. The file shows its tags; whoever edits changes them.
      await all.getByRole('link').click();
      // The vistazo first (ADR-139 p1), then the page.
      await openInFull(page);
      await expect(page).toHaveURL(/\/conversation\//);
      const tags = page.getByTestId('conversation-tags');
      await expect(tags.locator('.tag-chip')).toHaveText(['Press'], { timeout: 15_000 });
      await tags.getByRole('button', { name: 'Change' }).click();
      await tags.getByLabel('Venues').check({ force: true });
      await tags.getByRole('button', { name: 'Done' }).click();
      await expect(tags.locator('.tag-chip')).toHaveText(['Venues', 'Press'], { timeout: 15_000 });

      await page.goto(`${LENS}&etiqueta=sales`);
      await waitForLoaded(page);
      await search(page);
      await expect(page.locator('main [data-testid="conversation-row"]', { hasText: ORG })).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByRole('button', { name: /^Select$/ })).toBeVisible();
    } finally {
      await sweep(page);
    }
  });

  test('?view=team goes to ?etiqueta=team', async ({ page }) => {
    await page.goto('/h/conversations?view=team');
    await page.waitForURL(/\/h\/conversations\?etiqueta=team$/);
    await expect(page.locator('.lenshead__sub [data-chip="team"]')).toHaveAttribute('aria-current', 'page');
  });
});
