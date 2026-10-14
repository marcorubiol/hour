import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

/**
 * ADR-106, fase 3: el hilo del equipo en la ficha de la conversación.
 *
 * Lo que fija, con dos logins de verdad:
 *   - la fixture limitada, con Coordinació en el proyecto (lee Converses),
 *     escribe en el hilo del equipo desde la vista «registro» y lo ve;
 *   - el admin lo ve en la vista «hilo», mezclado con el registro, con su
 *     marca «Solo el equipo» y como nuevo;
 *   - privada del admin, la limitada no ve ni la conversación ni su hilo, y la
 *     lectura del hilo le responde 404.
 *
 * Todo en el espacio `playwright`, en `zzz-e2e-collab`, con una conversación
 * del propio spec (nunca una de las reales de `muk-cia`). Autolimpiante:
 * borra (blando) su mensaje con el login que lo escribió, borra la
 * conversación y devuelve a la fixture limitada el acceso que tenía. La
 * conversación y el acceso se dan por las RPC, como en el tablón.
 *
 * Contra un origen desplegado (PW_BASE_URL), nunca contra `vite preview`.
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const LIMITED_EMAIL = process.env.PW_LIMITED_EMAIL;
const LIMITED_PASSWORD = process.env.PW_LIMITED_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BODY = `E2E equipo ${RUN}: les llamo el jueves`;

type Helpers = typeof import('./rls/_helpers');

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\/?$/, { timeout: 60_000 });
}

test.describe('el hilo del equipo de una conversación (ADR-106)', () => {
  test.skip(
    !EMAIL || !PASSWORD || !LIMITED_EMAIL || !LIMITED_PASSWORD || !process.env.PUBLIC_SUPABASE_URL,
    'Set PW_TEST_*, PW_LIMITED_* and PUBLIC_SUPABASE_*.',
  );
  test.describe.configure({ mode: 'serial' });

  let h: Helpers;
  let adminJwt = '';
  let adminId = '';
  let limitedJwt = '';
  let limitedId = '';
  let projectId = '';
  let conversationId = '';
  let snapshot: Awaited<ReturnType<Helpers['projectAccess']>> | null = null;
  let messageId = '';

  const share = (privateTo: string | null) =>
    h.pgPatch('conversation', adminJwt, { private_to: privateTo }, new URLSearchParams({ id: `eq.${conversationId}` }));

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    h = await import('./rls/_helpers');
    adminJwt = await h.login(EMAIL!, PASSWORD!);
    adminId = String(h.decodeJwt(adminJwt).sub);
    limitedJwt = await h.login(LIMITED_EMAIL!, LIMITED_PASSWORD!);
    limitedId = String(h.decodeJwt(limitedJwt).sub);

    const project = await h.pgGet<{ id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id' }),
    );
    projectId = project.rows[0].id;

    const conv = await h.pgRpc<{ id: string } | { id: string }[]>('create_conversation', adminJwt, {
      p_project_id: projectId,
      p_full_name: `E2E Equipo ${RUN}`,
      p_email: `e2e-equipo-${RUN}@example.test`,
    });
    expect(conv.status, conv.error).toBe(200);
    conversationId = (Array.isArray(conv.data) ? conv.data[0] : conv.data)!.id;
    // Compartida para empezar: la privacidad la prueba el último test.
    expect((await share(null)).status).toBeLessThan(300);

    // Coordinació en el proyecto: lee y edita Converses.
    snapshot = await h.projectAccess(adminJwt, projectId, limitedId);
    await h.grantPreset(adminJwt, 'project', projectId, limitedId, 'coordinacio');
  });

  test.afterAll(async () => {
    if (!h) return;
    if (messageId) await h.pgRpc('delete_message', limitedJwt, { p_message_id: messageId });
    if (conversationId) await h.pgRpc('delete_conversation', adminJwt, { p_conversation_id: conversationId });
    if (snapshot) await h.restoreProjectAccess(adminJwt, projectId, limitedId, snapshot);
  });

  test('con Converses: escribe en el hilo del equipo y lo ve', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await signIn(page, LIMITED_EMAIL!, LIMITED_PASSWORD!);

    await page.goto(`/h/playwright/conversation/${conversationId}`);
    // En «registro», el hilo del equipo va al lado de lo hablado con fuera.
    const team = page.locator('aside .inside article.thread');
    await expect(team).toBeVisible({ timeout: 30_000 });
    await expect(team.locator('.thread__empty')).toBeVisible();
    // La línea de audiencia, sin plegar: quien ve esta conversación.
    await expect(team.locator('.thread__audience')).toContainText(/\d/);

    await team.locator('.thread__compose textarea').fill(BODY);
    const posted = page.waitForResponse((r) => r.url().endsWith('/api/messages') && r.request().method() === 'POST');
    await team.getByRole('button', { name: /send|enviar|envoyer/i }).click();
    const res = await posted;
    expect(res.status()).toBe(201);
    messageId = ((await res.json()) as { message: { id: string } }).message.id;

    await expect(team.locator('.msg', { hasText: BODY })).toBeVisible({ timeout: 15_000 });
    await expect(team.locator('.thread__count')).toHaveText('1');
    await context.close();
  });

  test('el admin lo ve en la vista «hilo», mezclado, marcado y nuevo', async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(!messageId, 'needs the message of the previous test');
    await page.goto(`/h/playwright/conversation/${conversationId}?vista=hilo`);
    const flow = page.locator('ol.flow');
    const msg = flow.locator('.msg', { hasText: BODY });
    await expect(msg).toBeVisible({ timeout: 30_000 });
    await expect(msg.locator('.tag-chip')).toHaveText(/solo el equipo|només l'equip|team only|équipe seulement/i);
    await expect(flow.locator('.thread__new')).toBeVisible();
    // Debajo de la línea, la cabecera, la audiencia y el compositor del hilo,
    // sin repetir sus mensajes.
    const block = page.locator('.conv__main article.thread');
    await expect(block.locator('.thread__compose textarea')).toBeVisible();
    await expect(block.locator('.msg')).toHaveCount(0);
  });

  test('privada del admin: la limitada no ve ni la conversación ni su hilo', async ({ browser }) => {
    test.setTimeout(90_000);
    test.skip(!messageId, 'needs the message of the first test');
    expect((await share(adminId)).status).toBeLessThan(300);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      await signIn(page, LIMITED_EMAIL!, LIMITED_PASSWORD!);
      await page.goto(`/h/playwright/conversation/${conversationId}`);
      // La ficha dice que no la encuentra: ni título ni hilo.
      await expect(page.locator('section.conv .conv__msg')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.conv__title')).toHaveCount(0);
      await expect(page.locator('article.thread')).toHaveCount(0);
      await expect(page.getByText(BODY)).toHaveCount(0);
      const res = await page.request.get(`/api/conversations/${conversationId}/thread`);
      expect(res.status()).toBe(404);
    } finally {
      await context.close();
      await share(null);
    }
  });
});
