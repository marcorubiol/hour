import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { waitForLoaded } from './loaded';

/**
 * ADR-106, fase 2: el tablón del bolo en la ficha de la función.
 *
 * Lo que fija, con dos logins de verdad:
 *   - la fixture limitada, con Equip en el proyecto, ve General y Técnica y NO
 *     ve Diners (ausente, no «bloqueado»); escribe en Técnica marcando de qué
 *     función habla, y lo ve con la etiqueta de esa función;
 *   - el admin, desde la función HERMANA, ve el mismo mensaje en el mismo
 *     hilo (el tablón es del bolo, no de la función), marcado como nuevo, y sí
 *     ve Diners.
 *
 * Todo en el espacio `playwright`, en `zzz-e2e-collab`. Autolimpiante: crea su
 * bolo y sus dos funciones y los borra; borra (blando) sus mensajes con el
 * login de quien los escribió; devuelve a la fixture limitada el acceso que
 * tenía. El bolo y las funciones se crean por las RPC (como la suite RLS),
 * porque la app no ofrece aún dar un paquete de acceso.
 *
 * Contra un origen desplegado (PW_BASE_URL), nunca contra `vite preview`.
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const LIMITED_EMAIL = process.env.PW_LIMITED_EMAIL;
const LIMITED_PASSWORD = process.env.PW_LIMITED_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BODY = `E2E tablón ${RUN}: la mesa llega a las 10h`;

type Helpers = typeof import('./rls/_helpers');

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\/desk\/?$/, { timeout: 60_000 });
}

test.describe('el tablón del bolo (ADR-106)', () => {
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
  const perfs: { id: string; slug: string }[] = [];
  let snapshot: Awaited<ReturnType<Helpers['projectAccess']>> | null = null;
  let messageId = '';

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    h = await import('./rls/_helpers');
    adminJwt = await h.login(EMAIL!, PASSWORD!);
    limitedJwt = await h.login(LIMITED_EMAIL!, LIMITED_PASSWORD!);
    limitedId = String(h.decodeJwt(limitedJwt).sub);

    const project = await h.pgGet<{ id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id' }),
    );
    projectId = project.rows[0].id;

    const bolo = await h.pgRpc<{ id: string } | { id: string }[]>('create_bolo', adminJwt, {
      p_project_id: projectId,
      p_venue_name: `E2E Tablón ${RUN}`,
      p_city: 'Madrid',
      p_status: 'proposed',
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = (Array.isArray(bolo.data) ? bolo.data[0] : bolo.data)!.id;

    for (const day of ['2031-06-13', '2031-06-14']) {
      const res = await h.pgRpc<{ id: string; slug: string } | { id: string; slug: string }[]>(
        'create_performance',
        adminJwt,
        { p_project_id: projectId, p_performed_at: day, p_venue_name: `E2E Tablón ${RUN}`, p_bolo_id: boloId },
      );
      expect(res.status, res.error).toBe(200);
      const row = (Array.isArray(res.data) ? res.data[0] : res.data)!;
      perfs.push({ id: row.id, slug: row.slug });
    }

    // Equip en el proyecto: Técnica sí, Diners no (ADR-100 §6, ADR-106 pregunta 2).
    snapshot = await h.projectAccess(adminJwt, projectId, limitedId);
    await h.grantPreset(adminJwt, 'project', projectId, limitedId, 'equip');
  });

  test.afterAll(async () => {
    if (!h) return;
    if (messageId) await h.pgRpc('delete_message', limitedJwt, { p_message_id: messageId });
    for (const p of perfs) await h.pgRpc('delete_performance', adminJwt, { p_performance_id: p.id });
    if (boloId) await h.pgRpc('delete_bolo', adminJwt, { p_bolo_id: boloId });
    if (snapshot) await h.restoreProjectAccess(adminJwt, projectId, limitedId, snapshot);
  });

  test('con Equip: Técnica sí, Diners no, y lo escrito sale con su función', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await signIn(page, LIMITED_EMAIL!, LIMITED_PASSWORD!);

    await page.goto(`/h/playwright/performance/${perfs[0].slug}`);
    await waitForLoaded(page);
    const board = page.locator('section.board');
    await expect(board).toBeVisible();

    // Un bolo recién creado no tiene mensajes: todos sus hilos van plegados,
    // una línea cada uno. Diners ni plegado: ausente, no bloqueado.
    await expect(board.locator('.board__folded [data-facet="general"]')).toBeVisible();
    const foldedTecnica = board.locator('.board__folded [data-facet="tecnica"]');
    await expect(foldedTecnica).toBeVisible();
    await expect(board.locator('[data-facet="diners"]'), 'Diners: ausente, no bloqueado').toHaveCount(0);

    // Al pulsar su nombre en la línea, el hilo se abre con el compositor ya enfocado.
    await foldedTecnica.click();
    const tecnica = board.locator('article[data-facet="tecnica"]');
    await expect(tecnica.locator('.thread__compose textarea')).toBeFocused();
    // La línea de audiencia va en el hilo abierto, sin plegar.
    await expect(tecnica.locator('.thread__audience')).toContainText(/\d/);

    await tecnica.locator('.thread__compose textarea').fill(BODY);
    await tecnica.locator('.thread__compose select').selectOption(perfs[1].id);
    const posted = page.waitForResponse((r) => r.url().endsWith('/api/messages') && r.request().method() === 'POST');
    await tecnica.getByRole('button', { name: /send|enviar|envoyer/i }).click();
    const res = await posted;
    expect(res.status()).toBe(201);
    messageId = ((await res.json()) as { message: { id: string } }).message.id;

    const msg = tecnica.locator('.msg', { hasText: BODY });
    await expect(msg).toBeVisible({ timeout: 15_000 });
    // Habla de la segunda función (14 jun 2031), no de la que se mira.
    await expect(msg.locator('.tag-chip')).toContainText('14');

    // Lo propio se corrige desde su menú, y queda marcado como editado.
    await msg.locator('.kebab').click();
    await page.getByRole('menuitem', { name: /edit|editar|modifier/i }).click();
    // En edición el cuerpo es un textarea, y `msg` (que se busca por su texto) deja de casar.
    const edit = tecnica.locator('.msg__edit');
    await edit.locator('textarea').fill(`${BODY} (corregido)`);
    await edit.getByRole('button', { name: /save|guardar|desar|enregistrer/i }).click();
    await expect(tecnica.locator('.msg__text', { hasText: `${BODY} (corregido)` })).toBeVisible({ timeout: 15_000 });
    await context.close();
  });

  test('el admin, desde la función hermana, lo ve nuevo en el mismo hilo y ve Diners', async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(!messageId, 'needs the message of the previous test');
    await page.goto(`/h/playwright/performance/${perfs[1].slug}`);
    await waitForLoaded(page);
    const board = page.locator('section.board');
    const tecnica = board.locator('article[data-facet="tecnica"]');
    await expect(tecnica.locator('.msg', { hasText: BODY })).toBeVisible();
    await expect(tecnica.locator('.thread__new')).toBeVisible();
    // Con nuevos, arriba del todo; Diners, vacío, plegado al final.
    await expect(board.locator('article').first()).toHaveAttribute('data-facet', 'tecnica');
    await expect(board.locator('.board__folded [data-facet="diners"]')).toBeVisible();
  });
});
