import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { forgetConversationsRpc } from './forget';

/**
 * ADR-106, fase 3: el hilo del equipo en la ficha de la conversación.
 *
 * Lo que fija, con dos logins de verdad:
 *   - la fixture limitada, con Coordinació en el proyecto (lee Converses),
 *     escribe al equipo desde el campo único del pie (punto 110) y lo ve;
 *   - el admin lo ve en el hilo, intercalado con lo de fuera, con su
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
  await page.waitForURL(/\/h\/desk\/?$/, { timeout: 60_000 });
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
    if (conversationId) await forgetConversationsRpc(h, adminJwt, [conversationId]);
    if (snapshot) await h.restoreProjectAccess(adminJwt, projectId, limitedId, snapshot);
  });

  test('con Converses: escribe al equipo desde el campo del pie y lo ve en el hilo', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await signIn(page, LIMITED_EMAIL!, LIMITED_PASSWORD!);

    await page.goto(`/h/playwright/conversation/${conversationId}`);
    // Un solo campo al pie (punto 110): «Nota del equipo» es uno de sus destinos.
    const composer = page.getByTestId('thread-composer');
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.getByTestId('composer-to-team').click();
    await expect(composer.getByTestId('composer-to-team')).toHaveAttribute('aria-pressed', 'true');
    // Quién lo lee, antes de escribir (ADR-177 § 6): fuera no lo ve, y el verbo lo dice.
    await expect(composer.getByTestId('composer-reads')).toContainText("won't see it");
    await expect(composer.getByRole('button', { name: 'Save note' })).toBeVisible();
    // La línea de audiencia, sin plegar: quien ve esta conversación.
    await expect(composer.getByTestId('write-why')).toContainText(/\d/);

    // Intro envía en el equipo, como en un grupo.
    const posted = page.waitForResponse((r) => r.url().endsWith('/api/messages') && r.request().method() === 'POST');
    await composer.locator('textarea').fill(BODY);
    await composer.locator('textarea').press('Enter');
    const res = await posted;
    expect(res.status()).toBe(201);
    messageId = ((await res.json()) as { message: { id: string } }).message.id;

    const flow = page.getByTestId('conversation-thread');
    await expect(flow.locator('.msg--note', { hasText: BODY })).toBeVisible({ timeout: 15_000 });
    await context.close();
  });

  test('el admin lo ve en el hilo, intercalado, marcado y nuevo', async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(!messageId, 'needs the message of the previous test');
    await page.goto(`/h/playwright/conversation/${conversationId}`);
    const flow = page.getByTestId('conversation-thread');
    const msg = flow.locator('.msg--note', { hasText: BODY });
    await expect(msg).toBeVisible({ timeout: 30_000 });
    await expect(msg.locator('.msg__mark')).toHaveText(/solo el equipo|només l'equip|team only|équipe seulement/i);
    await expect(flow.locator('[data-entry="new"]')).toBeVisible();
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
      await expect(page.locator('section.conv [data-testid="record-state"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.chat__head')).toHaveCount(0);
      await expect(page.getByTestId('conversation-thread')).toHaveCount(0);
      await expect(page.getByText(BODY)).toHaveCount(0);
      const res = await page.request.get(`/api/conversations/${conversationId}/thread`);
      expect(res.status()).toBe(404);
    } finally {
      await context.close();
      await share(null);
    }
  });
});
