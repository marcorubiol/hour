import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

/**
 * ADR-117: «con quién hablas» abre con su dashboard.
 *
 * Lo que fija:
 *   - una sala que nos acaba de escribir sale en «Esperan respuesta», y su filtro la
 *     encuentra en la lista con la columna Respuesta;
 *   - una sala contactada a la que escribimos hace 40 días sin respuesta se
 *     enfría en la segunda ronda, y «Escribir a estas» abre el modo selección
 *     con ella ya marcada (ADR-126 § 8: las paradas no van en bloque);
 *   - el chip del filtro lo quita, y un tramo de la temporada filtra por relación (ADR-138);
 *   - en el móvil, una sola columna en el orden del documento: lo que pide
 *     acción (esperan respuesta, se mueve) antes que la temporada (ADR-126 § 11).
 *
 * En el espacio `playwright`, en `zzz-e2e-collab`, con dos conversaciones del
 * propio spec (nunca `muk-cia`). Autolimpiante: las borra al acabar (sus
 * eventos se van con ellas).
 *
 * Contra un origen desplegado (PW_BASE_URL) o `vite dev` con su Supabase;
 * nunca contra `vite preview`.
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const WARM = `E2E Dash Escribe ${RUN}`;
const COLD = `E2E Dash Callada ${RUN}`;
const SUBJECT = `Re: fechas ${RUN}`;

type Helpers = typeof import('./rls/_helpers');
const one = <T>(d: T | T[] | null): T => (Array.isArray(d) ? d[0] : d)!;

test.describe('el dashboard de Conversations (ADR-117)', () => {
  test.skip(!EMAIL || !PASSWORD || !process.env.PUBLIC_SUPABASE_URL, 'Set PW_TEST_* and PUBLIC_SUPABASE_*.');
  test.describe.configure({ mode: 'serial' });

  let h: Helpers;
  let jwt = '';
  const ids: string[] = [];

  async function conversation(name: string): Promise<string> {
    const project = await h.pgGet<{ id: string }>('project', jwt, new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id' }));
    const conv = await h.pgRpc<{ id: string }>('create_conversation', jwt, {
      p_project_id: project.rows[0].id,
      p_organization_name: name,
      p_full_name: `${name} contacto`,
      p_email: `e2e-dash-${ids.length}-${RUN}@example.test`,
    });
    expect(conv.status, conv.error).toBe(200);
    const id = one(conv.data).id;
    ids.push(id);
    await h.pgPatch('conversation', jwt, { private_to: null }, new URLSearchParams({ id: `eq.${id}` }));
    return id;
  }

  async function event(id: string, direction: 'inbound' | 'outbound', daysAgo: number, subject: string) {
    const res = await h.pgRpc('record_conversation_event', jwt, {
      p_conversation_id: id,
      p_kind: 'email',
      p_direction: direction,
      p_body: subject,
      p_metadata: { subject },
      p_occurred_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    });
    expect(res.status, res.error).toBe(200);
  }

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    h = await import('./rls/_helpers');
    jwt = await h.login(EMAIL!, PASSWORD!);
    const warm = await conversation(WARM);
    await event(warm, 'outbound', 3, 'Propuesta');
    await event(warm, 'inbound', 0, SUBJECT);
    const cold = await conversation(COLD);
    await event(cold, 'outbound', 40, `Propuesta ${RUN}`);
  });

  test.afterAll(async () => {
    if (!h) return;
    for (const id of ids) await h.pgRpc('delete_conversation', jwt, { p_conversation_id: id });
  });

  test('esperan respuesta: el bloque cuenta y su filtro la encuentra con su columna Respuesta', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?etiqueta=sales');
    const due = page.getByTestId('block-due');
    await expect(due).toBeVisible({ timeout: 30_000 });
    // The count rides in the block's title: «Esperan respuesta · N».
    await expect(due.getByRole('heading')).not.toHaveText(/·\s*0$/);

    await due.getByRole('link', { name: /lista|list|llista|liste/i }).click();
    await expect(page).toHaveURL(/turno=nuestro/);
    await page.getByRole('searchbox').fill(WARM);
    const row = page.locator('.conversation-table tbody tr', { hasText: WARM });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row.locator('.turn--ours')).toBeVisible();
    await expect(page.locator('.conversation-table tbody tr', { hasText: COLD })).toHaveCount(0);
  });

  test('sin noticias: «Escribir a estas» deja la selección hecha; el chip quita el filtro', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?etiqueta=sales');
    const cold = page.getByTestId('block-cold');
    await expect(cold).toBeVisible({ timeout: 30_000 });
    // One «write to these» per project when the cooling spans several: ours is zzz-e2e-collab.
    const write = cold.locator('.block__acts button');
    await ((await write.count()) > 1 ? write.filter({ hasText: /Collab/i }) : write).click();

    await expect(page).toHaveURL(/temp=ronda/);
    await expect(page.locator('.action-bar')).toBeVisible();
    await page.getByRole('searchbox').fill(COLD);
    const row = page.locator('.conversation-table tbody tr', { hasText: COLD });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row.getByRole('checkbox')).toBeChecked();
    await expect(row.locator('.turn--theirs')).toBeVisible();

    await page.locator('.chip--selected button, [class*="chip--"] button').first().click();
    await expect(page).not.toHaveURL(/temp=/);
  });

  test('un tramo de la temporada filtra la lista por esa relación', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?etiqueta=sales');
    const season = page.getByTestId('block-season');
    await expect(season).toBeVisible({ timeout: 30_000 });
    await season.locator('.season__item').first().click();
    await expect(page).toHaveURL(/temporada=actual.*relacion=|relacion=.*temporada=actual/);
    await expect(page.locator('.conversation-table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  });

  test('en el móvil, una columna en el orden del documento, «Esperan respuesta» primero', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/h/conversations?etiqueta=sales');
    const due = page.getByTestId('block-due');
    const season = page.getByTestId('block-season');
    const hot = page.getByTestId('block-hot');
    await expect(due).toBeVisible({ timeout: 30_000 });
    const [d, s, ho] = await Promise.all([due.boundingBox(), season.boundingBox(), hot.boundingBox()]);
    expect(d!.y).toBeLessThan(ho!.y);
    expect(ho!.y).toBeLessThan(s!.y);
    expect(Math.abs(d!.x - s!.x)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
