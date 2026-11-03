import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { forgetConversationsRpc } from './forget';

/**
 * ADR-117, con la forma de mensajería de ADR-176: el panel se plegó en los
 * chips de la lista (Te toca, Se enfría) y la temporada pasó a Envíos.
 *
 * Lo que fija:
 *   - una sala que nos acaba de escribir sale en «Te toca», cuya cifra es la
 *     de las filas que filtra, con el turno en tinta;
 *   - una sala contactada a la que escribimos hace 40 días sin respuesta sale
 *     en «Se enfría» y en la segunda ronda (un filtro de «Filtrar ▾»), y se
 *     puede marcar desde «Seleccionar»;
 *   - «Ya está» en la fila (ADR-177): un toque la saca de «Nos toca», con
 *     deshacer y un «cómo» opcional que queda como nota en el hilo;
 *   - el chip del filtro lo quita, y un tramo de la temporada (en Envíos) filtra por relación (ADR-138);
 *   - en el móvil, Envíos: la temporada encima de la lista de envíos.
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

test.describe('Te toca y Se enfría en Conversaciones (ADR-117, ADR-176)', () => {
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
    await forgetConversationsRpc(h, jwt, ids);
  });

  test('te toca: el chip cuenta, filtra la lista y su cifra es la de las filas', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?etiqueta=sales');
    // Te toca es un chip de la lista desde ADR-176 (el bloque «Esperan respuesta» del panel se fue con él).
    const due = page.locator('.conversations__chip[data-chip="tetoca"]');
    await expect(due.locator('.conversations__chip-n')).toBeVisible({ timeout: 30_000 });
    const n = Number(await due.locator('.conversations__chip-n').textContent());
    expect(n).toBeGreaterThan(0);

    await due.click();
    await expect(page).toHaveURL(/turno=nuestro/);
    await expect(due).toHaveAttribute('aria-current', 'page');
    // La etiqueta sigue de filtro: el chip no la quita.
    await expect(page).toHaveURL(/etiqueta=sales/);
    const rows = page.locator('[data-testid="conversation-list"] [data-testid="conversation-row"]');
    // La cifra es la de la lista filtrada (una página de 50 como mucho).
    await expect(rows).toHaveCount(Math.min(n, 50), { timeout: 30_000 });

    await page.locator('.conversations__search').getByRole('searchbox').fill(WARM);
    const row = page.locator('[data-testid="conversation-row"]', { hasText: WARM });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    // El turno en la línea de contexto, en tinta: nos toca.
    await expect(row.locator('.chat__ctx .is-ink')).toHaveText('Our turn to reply');
    await expect(page.locator('[data-testid="conversation-row"]', { hasText: COLD })).toHaveCount(0);
  });

  test('se enfría: el chip la encuentra; la segunda ronda es un filtro con su chip que se quita', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?etiqueta=sales');
    // «Escribir a estas» se fue con el panel (ADR-176): Se enfría es un chip, y la selección se abre desde la cabecera.
    const cold = page.locator('.conversations__chip[data-chip="enfria"]');
    await expect(cold.locator('.conversations__chip-n')).toBeVisible({ timeout: 30_000 });
    await cold.click();
    await expect(page).toHaveURL(/temp=fria/);
    await expect(cold).toHaveAttribute('aria-current', 'page');
    await page.locator('.conversations__search').getByRole('searchbox').fill(COLD);
    const row = page.locator('[data-testid="conversation-row"]', { hasText: COLD });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    // Les toca a ellos: el turno sin tinta.
    await expect(row.locator('.chat__ctx')).toContainText('Waiting for their reply');
    await expect(row.locator('.chat__ctx .is-ink')).toHaveCount(0);

    // La segunda ronda (la de antes de «Escribir a estas»), desde «Filtrar ▾».
    await page.locator('.conversations__filter-open').click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await sheet.getByLabel('Temperature').selectOption('ronda');
    await expect(page).toHaveURL(/temp=ronda/);
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    // Seleccionar, en la cabecera, deja marcar la fila.
    await page.getByRole('button', { name: /^Select$/ }).click();
    await expect(page.locator('.action-bar')).toBeVisible();
    await row.locator('.chat__pick input').check({ force: true });
    await expect(row.locator('.chat__pick input')).toBeChecked();
    await page.getByRole('button', { name: 'Stop selecting' }).first().click();

    const active = page.locator('.conversations__active');
    await expect(active).toContainText('No reply to the mailout');
    await active.getByRole('button', { name: 'Remove «No reply to the mailout»' }).click();
    await expect(page).not.toHaveURL(/temp=/);
  });

  test('ya está: un toque la saca de nos toca, se deshace, y el cómo queda en el hilo', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/h/conversations?etiqueta=sales&turno=nuestro');
    await page.locator('.conversations__search').getByRole('searchbox').fill(WARM);
    const row = page.locator('[data-testid="conversation-row"]', { hasText: WARM });
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    // Un toque: la fila se va; encima de la lista, el cómo y deshacer. Deshacer la devuelve.
    const line = page.locator('.doneline');
    await row.getByRole('button', { name: `${WARM}: done` }).click();
    await expect(line).toContainText(`${WARM}: done · today`, { timeout: 15_000 });
    await expect(row).toHaveCount(0, { timeout: 30_000 });
    await line.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Undone.')).toBeVisible({ timeout: 15_000 });
    await expect(row.getByRole('button', { name: `${WARM}: done` })).toBeVisible({ timeout: 30_000 });

    // Otra vez, con el cómo: Escape lo borra sin guardar; Intro guarda, y la nota queda en su historia.
    await row.getByRole('button', { name: `${WARM}: done` }).click();
    const how = line.getByRole('textbox', { name: 'How? (optional)' });
    await expect(how).toBeFocused({ timeout: 15_000 });
    await how.fill('by fax');
    await how.press('Escape');
    await expect(how).toHaveValue('');
    await how.fill('by phone');
    await how.press('Enter');
    await expect(line).not.toContainText(WARM, { timeout: 15_000 });
    await expect(row).toHaveCount(0, { timeout: 30_000 });
    const events = await h.pgGet<{ kind: string; body: string | null }>(
      'conversation_event',
      jwt,
      new URLSearchParams({ conversation_id: `eq.${ids[0]}`, kind: 'eq.note', select: 'kind,body' }),
    );
    expect(events.rows.map((e) => e.body)).toEqual(['Done: by phone']);
  });

  test('un tramo de la temporada, en Envíos, abre Conversaciones filtrada por esa relación', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?view=envios');
    const season = page.getByTestId('block-season');
    await expect(season).toBeVisible({ timeout: 30_000 });
    await season.locator('.season__item').first().click();
    await expect(page).toHaveURL(/temporada=actual.*relacion=|relacion=.*temporada=actual/);
    await expect(page).not.toHaveURL(/view=envios/);
    await expect(page.locator('[data-testid="conversation-row"]').first()).toBeVisible({ timeout: 30_000 });
  });

  test('en el móvil, Envíos: la temporada encima de la lista, alineadas y sin scroll lateral', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/h/conversations?view=envios');
    const season = page.getByTestId('block-season');
    const list = page.getByTestId('mailout-list');
    await expect(season).toBeVisible({ timeout: 30_000 });
    await expect(list).toBeVisible({ timeout: 30_000 });
    const [s, l] = await Promise.all([season.boundingBox(), list.boundingBox()]);
    expect(s!.y).toBeLessThan(l!.y);
    expect(Math.abs(s!.x - l!.x)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
