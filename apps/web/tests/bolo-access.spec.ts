import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { waitForLoaded } from './loaded';

/**
 * Comms carril 2, fase 2: el acceso al bolo bajo el tablón, y la invitación
 * de bolo de punta a punta.
 *
 * Lo que fija, con dos logins de verdad:
 *   - el admin, en la ficha de una función, invita al bolo desde «Añadir a
 *     alguien» con Mínimo y se lleva el enlace (Hour no envía el correo); la
 *     invitación sale pendiente bajo el tablón;
 *   - la fixture limitada abre el enlace: la página dice el bolo, la función
 *     donde entra y hasta cuándo; al aceptar aterriza en la ficha de esa
 *     función, en el tablón;
 *   - el admin la ve con su paquete y su fecha, y la quita del bolo.
 *
 * En `playwright`, en `zzz-e2e-collab`. Autolimpiante: crea su bolo y su
 * función y los borra, y revoca lo que quede (membresía de bolo e
 * invitaciones) por las RPC. La fixture limitada ya es `member` del espacio:
 * aceptar no le cambia el rol.
 *
 * Contra un origen desplegado (PW_BASE_URL), nunca contra `vite preview`.
 * Necesita aplicada 20261022150100 (la vista previa con el día de la función).
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const LIMITED_EMAIL = process.env.PW_LIMITED_EMAIL;
const LIMITED_PASSWORD = process.env.PW_LIMITED_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Helpers = typeof import('./rls/_helpers');

interface Access {
  members: { membership_id: string; user_id: string }[];
  invitations: { id: string; email: string }[];
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\/desk\/?$/, { timeout: 60_000 });
}

test.describe('el acceso al bolo (comms carril 2, fase 2)', () => {
  test.skip(
    !EMAIL || !PASSWORD || !LIMITED_EMAIL || !LIMITED_PASSWORD || !process.env.PUBLIC_SUPABASE_URL,
    'Set PW_TEST_*, PW_LIMITED_* and PUBLIC_SUPABASE_*.',
  );
  test.describe.configure({ mode: 'serial' });

  let h: Helpers;
  let adminJwt = '';
  let limitedId = '';
  let projectId = '';
  let boloId = '';
  let perf: { id: string; slug: string } | null = null;
  let inviteUrl = '';

  async function sweep() {
    if (!boloId) return;
    const access = await h.pgRpc<Access>('bolo_access', adminJwt, { p_bolo_id: boloId });
    for (const m of access.data?.members ?? []) {
      if (m.user_id === limitedId) await h.pgRpc('revoke_membership', adminJwt, { p_membership_id: m.membership_id });
    }
    for (const inv of access.data?.invitations ?? []) {
      await h.pgRpc('revoke_workspace_invitation', adminJwt, { p_invitation_id: inv.id });
    }
  }

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    h = await import('./rls/_helpers');
    adminJwt = await h.login(EMAIL!, PASSWORD!);
    const limitedJwt = await h.login(LIMITED_EMAIL!, LIMITED_PASSWORD!);
    limitedId = String(h.decodeJwt(limitedJwt).sub);

    const project = await h.pgGet<{ id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id' }),
    );
    projectId = project.rows[0].id;

    const bolo = await h.pgRpc<{ id: string } | { id: string }[]>('create_bolo', adminJwt, {
      p_project_id: projectId,
      p_venue_name: `E2E Acceso ${RUN}`,
      p_city: 'Manresa',
      p_status: 'proposed',
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = (Array.isArray(bolo.data) ? bolo.data[0] : bolo.data)!.id;

    const res = await h.pgRpc<{ id: string; slug: string } | { id: string; slug: string }[]>(
      'create_performance',
      adminJwt,
      { p_project_id: projectId, p_performed_at: '2031-07-11', p_venue_name: `E2E Acceso ${RUN}`, p_bolo_id: boloId },
    );
    expect(res.status, res.error).toBe(200);
    perf = (Array.isArray(res.data) ? res.data[0] : res.data)!;
  });

  test.afterAll(async () => {
    if (!h) return;
    await sweep();
    if (perf) await h.pgRpc('delete_performance', adminJwt, { p_performance_id: perf.id });
    if (boloId) await h.pgRpc('delete_bolo', adminJwt, { p_bolo_id: boloId });
  });

  test('el admin invita al bolo y se lleva el enlace', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/h/playwright/performance/${perf!.slug}`);
    await waitForLoaded(page);
    const board = page.locator('section.board');
    await board.getByRole('button', { name: /add someone|añadir a alguien|afegir algú|ajouter quelqu/i }).click();

    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type=email]').fill(LIMITED_EMAIL!);
    await dialog.getByRole('radio', { name: /minimal|mínimo|mínim/i }).check();
    const created = page.waitForResponse(
      (r) => r.url().includes(`/api/bolos/${boloId}/access`) && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: /create the invitation|crear la invitación|crear la invitació|créer l/i }).click();
    expect((await created).status()).toBe(201);

    const link = dialog.locator('input').first();
    await expect(link).toHaveValue(/\/invite#.{32,}/);
    inviteUrl = await link.inputValue();
    await dialog.getByRole('button', { name: /cancel|cancelar|cancel·lar|annuler/i }).click();

    // Pendiente bajo el tablón, con su correo.
    await expect(board.locator('.access')).toContainText(LIMITED_EMAIL!.toLowerCase());
  });

  test('la fixture limitada acepta y aterriza en la función, en el tablón', async ({ browser }) => {
    test.setTimeout(90_000);
    test.skip(!inviteUrl, 'needs the link of the previous test');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await signIn(page, LIMITED_EMAIL!, LIMITED_PASSWORD!);

    await page.goto(new URL(inviteUrl).pathname + new URL(inviteUrl).hash);
    const card = page.locator('.invitation-card');
    await expect(card).toContainText(`E2E Acceso ${RUN}`);
    // El día de la función y el último día de acceso (11 y 12 de julio de 2031).
    await expect(card).toContainText('11');
    await expect(card).toContainText('12');

    await card.locator('.invitation-card__accept').click();
    await page.waitForURL(new RegExp(`/h/playwright/performance/${perf!.slug}`), { timeout: 30_000 });
    await waitForLoaded(page);
    await expect(page.locator('section.board')).toBeVisible();
    await context.close();
  });

  test('el admin la ve con su paquete y la quita del bolo', async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(!inviteUrl, 'needs the previous tests');
    await page.goto(`/h/playwright/performance/${perf!.slug}`);
    await waitForLoaded(page);
    const access = page.locator('section.board .access');
    const row = access.locator('.access__row').first();
    await expect(row).toBeVisible();
    await expect(access.locator('.access__row--pending')).toHaveCount(0);

    await row.getByRole('button').click();
    await page.getByRole('menuitem', { name: /remove from|quitar del|treure del|retirer d/i }).click();
    const removed = page.waitForResponse(
      (r) => r.url().includes(`/api/bolos/${boloId}/access`) && r.request().method() === 'DELETE',
    );
    await page.locator('dialog[open]').getByRole('button', { name: /^(remove|quitar|treure|retirer)$/i }).click();
    expect((await removed).status()).toBe(204);
    await expect(access.locator('.access__row')).toHaveCount(0);
  });
});
