import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { forgetConversationsRpc } from './forget';

/**
 * ADR-135: la temporada de Difusión, una barra por línea.
 *
 * Lo que fija:
 *   - con conversaciones en una línea y otras sin línea, el bloque reparte:
 *     una barra por línea y «sin línea» al final, nunca escondida;
 *   - el nombre de una línea filtra la lista por esa línea en la temporada,
 *     y una relación de su leyenda, por esa relación en esa línea (ADR-138);
 *   - en el móvil, las barras apiladas en una columna, sin scroll lateral.
 *
 * En el espacio `playwright`, en `zzz-e2e-collab`, con dos conversaciones del
 * propio spec (nunca `muk-cia`): una en «ZZZ E2E Modules» y otra sin línea.
 * Autolimpiante.
 *
 * Contra un origen desplegado (PW_BASE_URL) o `vite dev` con su Supabase;
 * nunca contra `vite preview`.
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const IN_LINE = `E2E Línea Con ${RUN}`;
const NO_LINE = `E2E Línea Sin ${RUN}`;

type Helpers = typeof import('./rls/_helpers');
const one = <T>(d: T | T[] | null): T => (Array.isArray(d) ? d[0] : d)!;

test.describe('la temporada por línea (ADR-135)', () => {
  test.skip(!EMAIL || !PASSWORD || !process.env.PUBLIC_SUPABASE_URL, 'Set PW_TEST_* and PUBLIC_SUPABASE_*.');
  test.describe.configure({ mode: 'serial' });

  let h: Helpers;
  let jwt = '';
  let lineId = '';
  const ids: string[] = [];

  async function conversation(name: string, line: string | null): Promise<string> {
    const project = await h.pgGet<{ id: string }>('project', jwt, new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id' }));
    const conv = await h.pgRpc<{ id: string }>('create_conversation', jwt, {
      p_project_id: project.rows[0].id,
      p_organization_name: name,
      p_full_name: `${name} contacto`,
      p_email: `e2e-lines-${ids.length}-${RUN}@example.test`,
      p_line_id: line,
    });
    expect(conv.status, conv.error).toBe(200);
    const id = one(conv.data).id;
    ids.push(id);
    await h.pgPatch('conversation', jwt, { private_to: null }, new URLSearchParams({ id: `eq.${id}` }));
    return id;
  }

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    h = await import('./rls/_helpers');
    jwt = await h.login(EMAIL!, PASSWORD!);
    const line = await h.pgGet<{ id: string }>(
      'line',
      jwt,
      new URLSearchParams({ name: 'eq.ZZZ E2E Modules', deleted_at: 'is.null', select: 'id' }),
    );
    lineId = line.rows[0].id;
    await conversation(IN_LINE, lineId);
    await conversation(NO_LINE, null);
  });

  test.afterAll(async () => {
    if (!h) return;
    await forgetConversationsRpc(h, jwt, ids);
  });

  test('una barra por línea, «sin línea» al final', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?etiqueta=sales');
    const season = page.getByTestId('block-season');
    await expect(season).toBeVisible({ timeout: 30_000 });
    const lines = season.getByTestId('season-line');
    expect(await lines.count()).toBeGreaterThanOrEqual(2);
    await expect(lines.last()).toHaveAttribute('data-line', 'sin');
    await expect(season.locator(`[data-line="${lineId}"]`)).toHaveCount(1);
    await expect(season.locator(`[data-line="${lineId}"] .season__bar`)).toBeVisible();
  });

  test('el nombre de una línea filtra la lista por ella; una relación, por esa relación en ella', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?etiqueta=sales');
    const season = page.getByTestId('block-season');
    await expect(season).toBeVisible({ timeout: 30_000 });

    await season.locator(`[data-line="${lineId}"] .season__line-name`).click();
    await expect(page).toHaveURL(new RegExp(`temporada=actual.*linea=${lineId}`));
    await page.getByRole('searchbox').fill('E2E Línea');
    await expect(page.locator('[data-testid="conversation-row"]', { hasText: IN_LINE })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('[data-testid="conversation-row"]', { hasText: NO_LINE })).toHaveCount(0);

    await page.goto('/h/conversations?etiqueta=sales');
    await expect(season).toBeVisible({ timeout: 30_000 });
    // Sin historial: nunca contactadas (la relación se deriva, ADR-138).
    const never = season.locator('[data-line="sin"] .season__item', { has: page.locator('[data-relation="never"]') });
    await never.click();
    await expect(page).toHaveURL(/relacion=never.*linea=sin|linea=sin.*relacion=never/);
    await page.getByRole('searchbox').fill('E2E Línea');
    await expect(page.locator('[data-testid="conversation-row"]', { hasText: NO_LINE })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('[data-testid="conversation-row"]', { hasText: IN_LINE })).toHaveCount(0);
  });

  test('en el móvil, las barras apiladas y sin scroll lateral', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/h/conversations?etiqueta=sales');
    const lines = page.getByTestId('block-season').getByTestId('season-line');
    await expect(lines.first()).toBeVisible({ timeout: 30_000 });
    const [a, b] = await Promise.all([lines.nth(0).boundingBox(), lines.nth(1).boundingBox()]);
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
    expect(a!.y + a!.height).toBeLessThanOrEqual(b!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
