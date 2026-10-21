import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { forgetConversationsRpc } from './forget';

/**
 * ADR-106, fase 4 (ADR-116): «de qué se habla», hoy la vista Equipo de Conversaciones (ADR-134).
 *
 * Lo que fija, con dos logins de verdad:
 *   - el hilo con un mensaje nuevo sale arriba, aunque otro hilo tenga un
 *     mensaje más reciente (propio, que no es nuevo);
 *   - la fila del bolo abre la función con su tablón; la de la conversación,
 *     la conversación con su hilo del equipo;
 *   - abrir y leer quita el «nuevos» de la lista;
 *   - con Mínim, la fixture limitada ve el General del bolo y no ve Diners ni
 *     la conversación.
 *
 * Todo en el espacio `playwright`, en `zzz-e2e-collab`, con bolo, función y
 * conversación del propio spec (nunca `muk-cia`). Autolimpiante: borra sus
 * mensajes con quien los escribió, la función, el bolo y la conversación, y
 * devuelve a la fixture limitada el acceso que tenía.
 *
 * Contra un origen desplegado (PW_BASE_URL) o `vite dev` con su Supabase;
 * nunca contra `vite preview`.
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const LIMITED_EMAIL = process.env.PW_LIMITED_EMAIL;
const LIMITED_PASSWORD = process.env.PW_LIMITED_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const VENUE = `E2E Feed ${RUN}`;
const CONV = `E2E Feed Sala ${RUN}`;
const NEW_BODY = `E2E feed ${RUN}: el rider ya está`;
const TEAM_BODY = `E2E feed ${RUN}: les llamo el jueves`;
const DINERS_BODY = `E2E feed ${RUN}: el caché, aparte`;

type Helpers = typeof import('./rls/_helpers');
const one = <T>(d: T | T[] | null): T => (Array.isArray(d) ? d[0] : d)!;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\/desk\/?$/, { timeout: 60_000 });
}

test.describe('Conversaciones › Equipo: los hilos del equipo (ADR-116, ADR-134)', () => {
  test.skip(
    !EMAIL || !PASSWORD || !LIMITED_EMAIL || !LIMITED_PASSWORD || !process.env.PUBLIC_SUPABASE_URL,
    'Set PW_TEST_*, PW_LIMITED_* and PUBLIC_SUPABASE_*.',
  );
  test.describe.configure({ mode: 'serial' });

  let h: Helpers;
  let adminJwt = '';
  let limitedJwt = '';
  let limitedId = '';
  let projectId = '';
  let boloId = '';
  let perf = { id: '', slug: '' };
  let conversationId = '';
  let snapshot: Awaited<ReturnType<Helpers['projectAccess']>> | null = null;
  const messages: { id: string; jwt: () => string }[] = [];

  async function post(jwt: string, kind: string, anchor: string, body: string, facet: string | null = null) {
    const res = await h.pgRpc<{ id: string }>('post_message', jwt, {
      p_anchor_kind: kind,
      p_anchor_id: anchor,
      p_body: body,
      p_facet_id: facet,
    });
    expect(res.status, res.error).toBe(200);
    messages.push({ id: one(res.data).id, jwt: () => jwt });
  }

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    h = await import('./rls/_helpers');
    adminJwt = await h.login(EMAIL!, PASSWORD!);
    limitedJwt = await h.login(LIMITED_EMAIL!, LIMITED_PASSWORD!);
    limitedId = String(h.decodeJwt(limitedJwt).sub);
    const facets = await h.standardFacetIds(adminJwt);

    const project = await h.pgGet<{ id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id' }),
    );
    projectId = project.rows[0].id;

    const bolo = await h.pgRpc<{ id: string }>('create_bolo', adminJwt, {
      p_project_id: projectId,
      p_venue_name: VENUE,
      p_city: 'Girona',
      p_status: 'proposed',
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = one(bolo.data).id;
    const pf = await h.pgRpc<{ id: string; slug: string }>('create_performance', adminJwt, {
      p_project_id: projectId,
      p_performed_at: '2031-09-20',
      p_venue_name: VENUE,
      p_bolo_id: boloId,
    });
    expect(pf.status, pf.error).toBe(200);
    perf = { id: one(pf.data).id, slug: one(pf.data).slug };

    const conv = await h.pgRpc<{ id: string }>('create_conversation', adminJwt, {
      p_project_id: projectId,
      p_full_name: CONV,
      p_email: `e2e-feed-${RUN}@example.test`,
    });
    expect(conv.status, conv.error).toBe(200);
    conversationId = one(conv.data).id;
    await h.pgPatch('conversation', adminJwt, { private_to: null }, new URLSearchParams({ id: `eq.${conversationId}` }));

    // Mínim: la limitada escribe en el General del bolo. Para el admin, nuevo.
    snapshot = await h.projectAccess(adminJwt, projectId, limitedId);
    await h.grantPreset(adminJwt, 'project', projectId, limitedId, 'minim');
    await post(adminJwt, 'bolo', boloId, DINERS_BODY, facets.diners);
    await post(limitedJwt, 'bolo', boloId, NEW_BODY);
    // Después, el admin escribe en la conversación: más reciente, pero suyo.
    await post(adminJwt, 'conversation', conversationId, TEAM_BODY);
  });

  test.afterAll(async () => {
    if (!h) return;
    for (const m of messages) await h.pgRpc('delete_message', m.jwt(), { p_message_id: m.id });
    if (perf.id) await h.pgRpc('delete_performance', adminJwt, { p_performance_id: perf.id });
    if (boloId) await h.pgRpc('delete_bolo', adminJwt, { p_bolo_id: boloId });
    if (conversationId) await forgetConversationsRpc(h, adminJwt, [conversationId]);
    if (snapshot) await h.restoreProjectAccess(adminJwt, projectId, limitedId, snapshot);
  });

  test('lo nuevo arriba, y la fila del bolo abre la función con su tablón', async ({ page }) => {
    test.setTimeout(90_000);
    // La URL vieja de «de qué se habla» lleva a la vista Equipo (ADR-134).
    await page.goto('/h/conversations?view=threads');
    await page.waitForURL(/\/h\/conversations\?etiqueta=team$/);
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Conversations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('.lenshead__sub').getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page');
    // In English the sales view is «Venues», not «Booking» beside «Books» (ADR-137).
    await expect(page.locator('.lenshead__sub').getByRole('link', { name: 'Venues' })).toBeVisible();

    // Desk enseña lo nuevo del equipo y enlaza a la vista Equipo.
    await page.goto('/h/desk?scope=s:playwright');
    const changed = page.getByTestId('desk-changed');
    await expect(changed).toContainText(VENUE, { timeout: 30_000 });
    // Su enlace lleva a la lente en el chip que comparten sus novedades
    // (ADR-138 fase 3): Equipo si solo hay hilos, Todas si hay de todo.
    const toLens = changed.getByTestId('desk-to-conversations');
    await expect(toLens).toHaveAttribute('href', /^\/h\/conversations(\?etiqueta=team)?$/);
    await page.goto('/h/conversations?etiqueta=team');

    const rows = page.getByTestId('feed-row');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });

    // Arriba, el General del bolo con el mensaje nuevo de la limitada.
    const top = rows.first();
    await expect(top).toContainText(VENUE);
    await expect(top).toContainText(NEW_BODY);
    await expect(top.locator('.badge--info')).toBeVisible();

    // La conversación, con un mensaje más reciente pero propio, va debajo.
    const conv = rows.filter({ hasText: CONV });
    await expect(conv).toHaveCount(1);
    await expect(conv.locator('.badge--info')).toHaveCount(0);
    const index = await rows.evaluateAll((els, name) => els.findIndex((el) => el.textContent?.includes(name)), CONV);
    expect(index).toBeGreaterThan(0);

    // A la vista se marca leído (la ficha baja sola hasta el tablón).
    const read = page.waitForResponse((r) => /\/api\/threads\/[^/]+\/read$/.test(r.url()), { timeout: 30_000 });
    await top.locator('a').click();
    await page.waitForURL(new RegExp(`/h/playwright/performance/${perf.slug}#board$`));
    const board = page.locator('section#board');
    await expect(board.locator('.msg', { hasText: NEW_BODY })).toBeVisible({ timeout: 30_000 });
    expect((await read).status()).toBe(200);

    // De vuelta, la fila ya no dice «nuevos».

    await page.goto('/h/conversations?etiqueta=team&scope=s:playwright');
    const again = page.getByTestId('feed-row').filter({ hasText: VENUE }).filter({ hasText: NEW_BODY });
    await expect(again).toBeVisible({ timeout: 30_000 });
    await expect(again.locator('.badge--info')).toHaveCount(0);
  });

  test('la fila de la conversación abre su hilo del equipo', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/conversations?etiqueta=team');
    const row = page.getByTestId('feed-row').filter({ hasText: CONV });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator('a').click();
    await page.waitForURL(new RegExp(`/h/playwright/conversation/${conversationId}#team$`));
    await expect(page.locator('.conv__aside .inside .msg', { hasText: TEAM_BODY })).toBeVisible({ timeout: 30_000 });
  });

  test('con Mínim: el General del bolo, ni Diners ni la conversación', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      await signIn(page, LIMITED_EMAIL!, LIMITED_PASSWORD!);
      await page.goto('/h/conversations?etiqueta=team');
      const rows = page.getByTestId('feed-row');
      await expect(rows.filter({ hasText: NEW_BODY })).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByText(DINERS_BODY)).toHaveCount(0);
      await expect(page.getByText(CONV)).toHaveCount(0);
      await expect(page.getByText(TEAM_BODY)).toHaveCount(0);
      // Sin Converses no hay vista de venta, pero la lente sigue por Equipo: lee el General del bolo.
      await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Conversations' })).toBeVisible();
      await expect(page.locator('.lenshead__sub').getByRole('link', { name: 'Venues' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
