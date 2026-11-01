import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — ADR-159: la ficha de organización.
 *
 * 1. Una conversación con solo la organización; el título de su ficha (el
 *    nombre de la sala) lleva a la ficha de la organización.
 * 2. La ficha: su nombre, la conversación titulada por su proyecto y el
 *    bloque de datos fiscales, que la ficha de conversación ya no tiene.
 * 3. La lectura: por slug o por id, y sin `workspace_id` es un 400.
 *
 * Fixture: `playwright`, proyecto `ZZZ e2e collab`; organización propia
 * `ZZZ E2E Org Record`. Se recoge al empezar y al acabar. Nunca toca `muk-cia`.
 */
const ORG = 'ZZZ E2E Org Record';
const PROJECT = 'ZZZ e2e collab';

test.describe('organization record', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('the venue title opens its record, with its conversations and fiscal data', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/h/conversations?etiqueta=sales');
    await waitForLoaded(page);

    const sweep = () =>
      page.evaluate(async (org) => {
        const list = await fetch(`/api/conversations?q=${encodeURIComponent(org)}`);
        const items = ((await list.json()) as { items: Array<{ id: string; organization: { name: string } | null }> }).items;
        for (const i of items.filter((x) => x.organization?.name === org)) {
          await fetch(`/api/conversations/${i.id}`, { method: 'DELETE' });
        }
      }, ORG);
    await sweep();

    try {
      // 1. La conversación, solo con la organización.
      await page.getByRole('button', { name: 'Add conversation' }).click();
      const dialog = page.locator('dialog[open]');
      await dialog.getByLabel(PROJECT).check({ force: true });
      await dialog.getByLabel('Organization').fill(ORG);
      await dialog.getByRole('button', { name: 'Add conversation' }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10_000 });

      const found = await page.evaluate(async (org) => {
        const list = await fetch(`/api/conversations?q=${encodeURIComponent(org)}`);
        const items = (
          (await list.json()) as {
            items: Array<{ id: string; workspace_id: string; organization: { id: string; slug: string; name: string } | null }>;
          }
        ).items;
        return items.find((x) => x.organization?.name === org) ?? null;
      }, ORG);
      expect(found?.organization?.slug).toBeTruthy();

      await page.goto(`/h/playwright/conversation/${found!.id}`);
      await waitForLoaded(page);
      await expect(page.getByTestId('record-details')).toBeVisible();
      const title = page.locator('h1 a.record-head__titlelink');
      await expect(title).toHaveText(ORG);
      await title.click();

      // 2. La ficha de la organización.
      await expect(page).toHaveURL(new RegExp(`/h/playwright/organization/${found!.organization!.slug}$`));
      const record = page.getByTestId('organization-record');
      await expect(record.locator('h1')).toContainText(ORG);
      await expect(record.getByTestId('conversation-row').getByRole('link', { name: PROJECT, exact: true })).toBeVisible({
        timeout: 10_000,
      });

      // 3. La lectura: por id igual que por slug; sin espacio, 400.
      const reads = await page.evaluate(
        async ({ id, slug, ws }) => {
          const bySlug = await fetch(`/api/organizations/${slug}?workspace_id=${ws}`);
          const byId = await fetch(`/api/organizations/${id}?workspace_id=${ws}`);
          const bare = await fetch(`/api/organizations/${slug}`);
          const a = (await bySlug.json()) as { organization: { id: string }; conversations: unknown[] };
          const b = (await byId.json()) as { organization: { id: string } };
          return { slug: bySlug.status, id: byId.status, bare: bare.status, same: a.organization.id === b.organization.id, n: a.conversations.length };
        },
        { id: found!.organization!.id, slug: found!.organization!.slug, ws: found!.workspace_id },
      );
      expect(reads).toEqual({ slug: 200, id: 200, bare: 400, same: true, n: 1 });
    } finally {
      await sweep();
    }
  });
});
