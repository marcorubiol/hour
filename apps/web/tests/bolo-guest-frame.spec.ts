import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { waitForLoaded } from './loaded';

/**
 * Comms carril 2, fase 3: el marco de /h para un guest de un solo bolo
 * (plan build/plans/2026-10-22-comms-threads-facets.md § 3.3 y § 3.4).
 *
 * El guest es `external@hour.test`: sin acceso a `playwright` y dueño de su
 * propio espacio personal (el que deja el alta), como lo será cualquier
 * técnico de verdad. El spec lo invita a un bolo suyo de `zzz-e2e-collab`
 * con Equip, acepta por la RPC con su JWT y mira el marco con el espacio de la
 * compañía fijado en el ámbito (`?scope=s:playwright`), que es donde es guest:
 *   - Hoy: su función en «Lo siguiente» con «Tablón · 1 nuevo», que abre el
 *     tablón; ni «+ Tarea» ni Cuentas;
 *   - el Planificador: su función, y ninguna puerta de crear;
 *   - la ficha: el tablón, sin «Editar datos», sin notas que no podría abrir;
 *   - ⌘K: ninguna fila de crear; Ajustes del espacio: solo su perfil.
 *
 * Autolimpiante: borra su bolo y su función, quita la membresía de bolo y la
 * de espacio (`revoke_workspace_member`) y revoca lo que quede pendiente.
 * Contra un origen desplegado (PW_BASE_URL), nunca contra `vite preview`.
 * Necesita desplegado el Worker de esta fase (`my_role` en /api/workspaces).
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const GUEST_EMAIL = process.env.PW_EXTERNAL_EMAIL ?? 'external@hour.test';
const GUEST_PASSWORD = process.env.PW_EXTERNAL_PASSWORD ?? process.env.PW_LIMITED_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SCOPE = 'scope=s:playwright';

type Helpers = typeof import('./rls/_helpers');
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\/desk\/?/, { timeout: 60_000 });
}

/** In three days: «Lo siguiente» draws a card (not the far line) within 14. */
function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

test.describe('el marco de un guest de un solo bolo (comms carril 2, fase 3)', () => {
  test.skip(
    !EMAIL || !PASSWORD || !GUEST_PASSWORD || !process.env.PUBLIC_SUPABASE_URL,
    'Set PW_TEST_*, PW_EXTERNAL_* (or PW_LIMITED_PASSWORD) and PUBLIC_SUPABASE_*.',
  );
  test.describe.configure({ mode: 'serial' });

  let h: Helpers;
  let adminJwt = '';
  let guestId = '';
  let workspaceId = '';
  let boloId = '';
  let perf: { id: string; slug: string } | null = null;
  const venue = `E2E Guest ${RUN}`;

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    h = await import('./rls/_helpers');
    adminJwt = await h.login(EMAIL!, PASSWORD!);
    const guestJwt = await h.login(GUEST_EMAIL, GUEST_PASSWORD!);
    guestId = String(h.decodeJwt(guestJwt).sub);

    const project = await h.pgGet<{ id: string; workspace_id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id,workspace_id' }),
    );
    const projectId = project.rows[0].id;
    workspaceId = project.rows[0].workspace_id;

    const bolo = await h.pgRpc<{ id: string } | { id: string }[]>('create_bolo', adminJwt, {
      p_project_id: projectId,
      p_venue_name: venue,
      p_city: 'Manresa',
      p_status: 'proposed',
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = one(bolo.data)!.id;

    const res = await h.pgRpc<{ id: string; slug: string } | { id: string; slug: string }[]>(
      'create_performance',
      adminJwt,
      { p_project_id: projectId, p_performed_at: inDays(3), p_venue_name: venue, p_bolo_id: boloId },
    );
    expect(res.status, res.error).toBe(200);
    perf = one(res.data)!;

    const inv = await h.pgRpc<{ token: string } | { token: string }[]>('create_bolo_invitation', adminJwt, {
      p_bolo_id: boloId,
      p_email: GUEST_EMAIL,
      p_preset: 'equip',
    });
    expect(inv.status, inv.error).toBe(200);
    const accepted = await h.pgRpc('accept_workspace_invitation', guestJwt, { p_token: one(inv.data)!.token });
    expect(accepted.status, accepted.error).toBe(200);

    // One message on the General, written by the admin: news for the guest.
    const msg = await h.pgRpc('post_message', adminJwt, {
      p_anchor_kind: 'bolo',
      p_anchor_id: boloId,
      p_body: `Montaje a las 10 (${RUN}).`,
      p_facet_id: null,
      p_performance_id: perf.id,
    });
    expect(msg.status, msg.error).toBe(200);
  });

  test.afterAll(async () => {
    if (!h) return;
    if (boloId) {
      const access = await h.pgRpc<{ members: { membership_id: string }[]; invitations: { id: string }[] }>(
        'bolo_access',
        adminJwt,
        { p_bolo_id: boloId },
      );
      for (const m of access.data?.members ?? []) {
        await h.pgRpc('revoke_membership', adminJwt, { p_membership_id: m.membership_id });
      }
      for (const inv of access.data?.invitations ?? []) {
        await h.pgRpc('revoke_workspace_invitation', adminJwt, { p_invitation_id: inv.id });
      }
    }
    if (guestId && workspaceId) {
      const left = await h.pgGet<{ id: string }>(
        'membership',
        adminJwt,
        new URLSearchParams({ user_id: `eq.${guestId}`, workspace_id: `eq.${workspaceId}`, level: 'eq.workspace', select: 'id' }),
      );
      for (const m of left.rows) await h.pgRpc('revoke_workspace_member', adminJwt, { p_membership_id: m.id });
    }
    if (perf) await h.pgRpc('delete_performance', adminJwt, { p_performance_id: perf.id });
    if (boloId) await h.pgRpc('delete_bolo', adminJwt, { p_bolo_id: boloId });
  });

  test('Hoy, el Planificador, la ficha, ⌘K y Ajustes no le ofrecen nada que no pueda hacer', async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const refused: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && (r.status() === 403 || r.status() >= 500)) refused.push(`${r.status()} ${r.url()}`);
    });
    await signIn(page, GUEST_EMAIL, GUEST_PASSWORD!);

    // ── Hoy, con el espacio de la compañía en el ámbito ──
    await page.goto(`/h/desk?${SCOPE}`);
    await waitForLoaded(page);
    const nav = page.getByTestId('lens-nav');
    await expect(nav).not.toContainText(/cuentas|comptes|books|money/i);
    await expect(page.locator('.desk__add')).toHaveCount(0);
    const card = page.getByTestId('desk-next');
    await expect(card).toContainText(venue);
    const board = page.getByTestId('desk-next-board');
    await expect(board).toContainText(/1/);

    // ── «Tablón · 1 nuevo» abre la ficha en el tablón ──
    await board.click();
    await page.waitForURL(new RegExp(`/h/playwright/performance/${perf!.slug}`));
    await waitForLoaded(page);
    await expect(page.locator('section.board')).toBeVisible();
    await expect(page.locator('section.board')).toContainText(`Montaje a las 10 (${RUN}).`);
    await expect(page.getByRole('button', { name: /edit details|editar datos|editar dades|modifier/i })).toHaveCount(0);
    await expect(page.locator('.ynotes')).toHaveCount(0);

    // ── el Planificador: su función, ninguna puerta de crear ──
    await page.goto(`/h/planner?${SCOPE}`);
    await waitForLoaded(page);
    await expect(page.getByRole('main')).toContainText(venue.slice(0, 12));
    await expect(page.locator('.cal__add, .ov__add')).toHaveCount(0);

    // ── ⌘K: ninguna fila de crear con la compañía en el ámbito ──
    await page.goto(`/h/desk?${SCOPE}`);
    await waitForLoaded(page);
    await page.locator('.shell__search').click();
    await page.keyboard.type('tarea comprar');
    const palette = page.locator('.cmdk');
    await expect(palette).toBeVisible();
    // The words that name a create row: «Nueva tarea», «Nova tasca», «New task», «Nouvelle tâche».
    await expect(palette.getByRole('option', { name: /nueva|nova|new|nouvel/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // ── Ajustes de la compañía: solo su perfil ──
    await page.goto('/h/playwright/settings?section=lenses');
    const sections = page.locator('.set-nav__item');
    await expect(sections).toHaveCount(1);
    await expect(page).toHaveURL(/section=lenses/);
    await expect(page.locator('.set-nav__item.is-active')).toBeVisible();

    expect(refused, 'nothing on the way answered 403 or 5xx').toEqual([]);
    await context.close();
  });
});
