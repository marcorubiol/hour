import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { forgetConversationsRpc } from './forget';
import { waitForLoaded } from './loaded';

/**
 * Acciones en bloque de la lista (plan `build/plans/2026-10-22-conversations-
 * list.md` § 6.1 y 6.2, fase 2).
 *
 * Lo que fija:
 *   - «Select» bajo un chip que no es Difusión, sin «Write to N»;
 *   - el teclado: flechas entre filas, `x` marca, Esc sale;
 *   - «Not this time» a dos, el aviso lo cuenta y «Undo» lo deja como estaba;
 *   - «Tag» pone una etiqueta a las dos sin quitar la que tenían;
 *   - «Select all N that match» con la página entera marcada.
 *
 * En `playwright`, proyecto `zzz-e2e-collab`, con tres conversaciones del spec
 * (nunca `muk-cia`: la lente va acotada a `playwright` y la búsqueda a su
 * RUN). Autolimpiante. Contra un origen desplegado (PW_BASE_URL); nunca contra
 * `vite preview`.
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const NAME = `E2E Bulk ${RUN}`;
const LENS = '/h/conversations?scope=s:playwright&etiqueta=sales';

type Helpers = typeof import('./rls/_helpers');
const one = <T>(d: T | T[] | null): T => (Array.isArray(d) ? d[0] : d)!;

test.describe('bulk actions on the selection', () => {
  test.skip(!EMAIL || !PASSWORD || !process.env.PUBLIC_SUPABASE_URL, 'Set PW_TEST_* and PUBLIC_SUPABASE_*.');
  test.describe.configure({ mode: 'serial' });

  let h: Helpers;
  let jwt = '';
  const ids: string[] = [];

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    h = await import('./rls/_helpers');
    jwt = await h.login(EMAIL!, PASSWORD!);
    const project = await h.pgGet<{ id: string }>(
      'project',
      jwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', 'workspace.slug': 'eq.playwright', select: 'id,workspace!inner(slug)' }),
    );
    expect(project.rows).toHaveLength(1);
    for (const n of [1, 2, 3]) {
      const conv = await h.pgRpc<{ id: string }>('create_conversation', jwt, {
        p_project_id: project.rows[0].id,
        p_organization_name: `${NAME} ${n}`,
      });
      expect(conv.status, conv.error).toBe(200);
      const id = one(conv.data).id;
      ids.push(id);
      await h.pgPatch('conversation', jwt, { private_to: null }, new URLSearchParams({ id: `eq.${id}` }));
    }
  });

  test.afterAll(async () => {
    if (h) await forgetConversationsRpc(h, jwt, ids);
  });

  const rows = (page: Page) => page.locator('main [data-testid="conversation-row"]', { hasText: NAME });
  // By the relation pill's name: each editable row also mounts the closed «Not this time»
  // dialog, whose title `hasText` would read in every row.
  const notNow = (page: Page) => rows(page).filter({ has: page.getByRole('button', { name: /^Not this time/ }) });

  async function open(page: Page, chip = LENS) {
    await page.goto(chip);
    await waitForLoaded(page);
    await page.getByPlaceholder('People or organizations…').fill(NAME);
    await expect(rows(page)).toHaveCount(3, { timeout: 30_000 });
  }

  test('under Press: selection without «Write to»; Esc leaves it', async ({ page }) => {
    await page.goto('/h/conversations?scope=s:playwright&etiqueta=press');
    await waitForLoaded(page);
    await page.getByRole('button', { name: /^Select$/ }).click();
    await expect(page.getByRole('toolbar', { name: 'Actions on the selection' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Write to/ })).toHaveCount(0);
  });

  test('keyboard, «Not this time» to two and its undo', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    await page.getByRole('button', { name: /^Select$/ }).click();
    const bar = page.getByRole('region', { name: 'Selection' });
    await expect(bar).toBeVisible();

    // x marks the focused row, the arrow goes to the next.
    await rows(page).nth(0).getByRole('checkbox').focus();
    await page.keyboard.press('x');
    await page.keyboard.press('ArrowDown');
    await expect(rows(page).nth(1).getByRole('checkbox')).toBeFocused();
    await page.keyboard.press('x');
    await expect(bar).toContainText('2 conversations selected');

    await bar.getByRole('button', { name: 'Not this time' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const toast = page.locator('.toast-region').getByText('2 set to «not this time»');
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(notNow(page)).toHaveCount(2, { timeout: 20_000 });

    await page.locator('.toast-region').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.toast-region').getByText('Undone.')).toBeVisible({ timeout: 20_000 });
    await expect(notNow(page)).toHaveCount(0, { timeout: 20_000 });

    // Esc in the list leaves the selection.
    await rows(page).nth(0).getByRole('checkbox').focus();
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
  });

  test('tag two with Press, keeping Venues', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    await page.getByRole('button', { name: /^Select$/ }).click();
    const bar = page.getByRole('region', { name: 'Selection' });
    await rows(page).nth(0).getByRole('checkbox').check({ force: true });
    await rows(page).nth(1).getByRole('checkbox').check({ force: true });
    await bar.getByRole('button', { name: 'Tag' }).click();
    await page.getByRole('menuitem', { name: 'Add Press' }).click();
    await expect(page.locator('.toast-region').getByText('2 conversations tagged')).toBeVisible({ timeout: 20_000 });
    // Under Venues the rows stay (the tag was added, not swapped) and show Press.
    await expect(rows(page).filter({ hasText: 'Press' })).toHaveCount(2, { timeout: 20_000 });
    await expect(rows(page)).toHaveCount(3);
  });

  test('with the page picked, «Select all N that match» picks the whole filter', async ({ page }) => {
    test.setTimeout(90_000);
    // The whole scope, so the filter has more than a page.
    await page.goto(LENS);
    await waitForLoaded(page);
    await page.getByRole('button', { name: /^Select$/ }).click();
    const bar = page.getByRole('region', { name: 'Selection' });
    await bar.getByRole('button', { name: 'This page' }).click();
    const matching = bar.getByRole('button', { name: /^Select all \d+ that match$/ });
    if ((await matching.count()) === 0) test.skip(true, 'the scope fits in one page');
    const n = Number((await matching.textContent())!.match(/\d+/)![0]);
    await matching.click();
    await expect(bar).toContainText(`${n} conversations selected`, { timeout: 20_000 });
  });
});
