/**
 * 121 B · «LLEGO TARDE» (ADR-183). Pau opens HIS link on the phone, on the
 * day: «Llego tarde», 20 min, a line, «Avisar a producción». Production sees
 * it on Hoy with «Mover carga a HH:MM», «Llamar» and «Visto»; moving it
 * changes that one time on every sheet with «cambiado hoy · antes HH:MM»,
 * and his sheet says who saw it. A role link of the same performance has no
 * «Llego tarde».
 *
 * NOT RUN YET (written with the lane, 2026-11-05): needs the migration
 * 20261106100000 applied and a deployed origin (`PW_BASE_URL`).
 *
 * The spec owns its rows, in `playwright` on the fixture project: today a
 * performance with a load-in two hours ahead and a `zzz-` crew member, his
 * personal link and a role link. Everything it can is revoked and deleted
 * after; the dossier stays (no delete RPC, as in team-person.test.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.PUBLIC_SUPABASE_ANON_KEY;
/** zzz-e2e-collab: the stable fixture project of the playwright workspace. */
const PROJECT = '019f21d2-7482-77e6-9ad9-27d881cff305';
const RUN = Math.random().toString(16).slice(2, 8);
const VENUE = `ZZZ E2E Tarde ${RUN}`;
const PERSON = `Zzz Pau ${RUN}`;
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
const madrid = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso),
  );

type Res = { status: number; json: Record<string, unknown> | null };
function api(page: Page, method: string, path: string, body?: unknown): Promise<Res> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* a 204 */
      }
      return { status: r.status, json };
    },
    { method, path, body },
  );
}
const idOf = (r: Res, key: string) => ((r.json?.[key] as { id?: string } | undefined)?.id ?? (r.json?.id as string | undefined)) ?? null;

async function rest(jwt: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SB_ANON!,
      Authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
}

test.describe('«llego tarde» from his own road sheet (121 B)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  test.skip(!SB_URL || !SB_ANON, 'Set PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY (the team is planted by RPC).');
  test.describe.configure({ mode: 'serial' });

  const made = {
    perf: null as string | null,
    personal: null as { id: string; token: string } | null,
    role: null as { id: string; token: string } | null,
    loadIn: '' as string,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage();
    await page.goto('/h/desk');
    await waitForLoaded(page);
    const wss = await api(page, 'GET', '/api/workspaces');
    const ws = (wss.json?.items as { id: string; slug: string }[]).find((w) => w.slug === 'playwright');
    expect(ws, 'playwright workspace reachable').toBeTruthy();

    const perf = await api(page, 'POST', '/api/performances', {
      project_id: PROJECT,
      performed_at: TODAY,
      venue_name: VENUE,
      city: 'Girona',
      country: 'ES',
      status: 'confirmed',
    });
    made.perf = idOf(perf, 'performance');
    expect(made.perf).toBeTruthy();

    const jwt = decodeURIComponent((await page.context().cookies()).find((c) => c.name === 'hour_at')!.value);
    // A load-in two hours ahead, on a whole minute: the moment he is late to.
    made.loadIn = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 60_000) * 60_000).toISOString();
    const slots = await rest(jwt, 'rpc/replace_schedule_slots', {
      p_target_table: 'performance',
      p_target_id: made.perf,
      p_slots: [{ kind: 'load_in', label: null, at: made.loadIn, ends_at: null, notes: null }],
    });
    expect(slots.status).toBe(200);

    const dossier = await rest(jwt, 'rpc/create_workspace_person', { p_workspace_id: ws!.id, p_full_name: PERSON });
    expect(dossier.status).toBe(200);
    const personId = ((await dossier.json()) as { person_id: string }).person_id;
    const crew = await rest(jwt, 'crew_assignment', {
      workspace_id: ws!.id,
      performance_id: made.perf,
      person_id: personId,
      role: 'luces',
    });
    expect(crew.status).toBeLessThan(300);

    const personal = await api(page, 'POST', `/api/performances/${made.perf}/roadsheet/shares?ws=playwright`, {
      person_id: personId,
    });
    expect(personal.status).toBe(201);
    made.personal = personal.json?.share as { id: string; token: string };
    const role = await api(page, 'POST', `/api/performances/${made.perf}/roadsheet/shares?ws=playwright`, {
      role: 'tech_manager',
    });
    expect(role.status).toBe(201);
    made.role = role.json?.share as { id: string; token: string };
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/h/desk');
    for (const s of [made.personal, made.role]) {
      if (made.perf && s) await api(page, 'DELETE', `/api/performances/${made.perf}/roadsheet/shares/${s.id}?ws=playwright`);
    }
    if (made.perf) await api(page, 'DELETE', `/api/performances/${made.perf}`);
    await page.close();
  });

  test('a role link has no «Llego tarde»', async ({ browser }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
    const page = await anon.newPage();
    await page.goto(`/public/roadsheet/${made.role!.token}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(VENUE, { timeout: 15_000 });
    await expect(page.getByTestId('roadsheet-late-button')).toHaveCount(0);
    await expect(page.getByTestId('roadsheet-holder')).toHaveCount(0);
    await anon.close();
  });

  test('his link: «Llego tarde», 20 min and a line; the sheet keeps the notice', async ({ browser }) => {
    test.setTimeout(60_000);
    const anon = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
      timezoneId: 'Europe/Madrid',
      locale: 'es-ES',
    });
    const page = await anon.newPage();
    await page.goto(`/public/roadsheet/${made.personal!.token}`);
    await expect(page.getByTestId('roadsheet-holder')).toContainText(PERSON, { timeout: 15_000 });
    await expect(page.getByTestId('roadsheet-holder')).toContainText('luces');

    await page.getByTestId('roadsheet-late-button').click();
    await page.getByRole('button', { name: '20', exact: true }).click();
    const eta = new Date(Date.parse(made.loadIn) + 20 * 60_000).toISOString();
    await expect(page.getByTestId('roadsheet-late-eta')).toContainText(madrid(eta));
    await page.getByLabel(/Algo más/).fill('Tráfico en la Ronda de Dalt');
    await expect(page.getByTestId('roadsheet-late')).toContainText('No cambia ninguna hora');
    await page.getByRole('button', { name: 'Avisar a producción' }).click();

    const state = page.getByTestId('roadsheet-late-state');
    await expect(state).toContainText('Avisado a las');
    await expect(state).toContainText(madrid(eta));
    await expect(state).toContainText('Aún nadie lo ha visto');
    // It never changed a time.
    await expect(page.getByTestId('roadsheet-moved')).toHaveCount(0);
    await anon.close();
  });

  test('production: the band on Hoy, «Mover» that one time, and the sheet says it moved and who saw it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/h/desk');
    await waitForLoaded(page);
    const band = page.getByTestId('late-band');
    const item = band.locator('li').filter({ hasText: PERSON });
    await expect(item).toBeVisible({ timeout: 20_000 });
    await expect(item).toContainText('Tráfico en la Ronda de Dalt');

    const to = madrid(new Date(Date.parse(made.loadIn) + 20 * 60_000).toISOString());
    await item.getByRole('button', { name: new RegExp(`${to}$`) }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(to);
    await dialog.getByRole('button', { name: /^(Mover|Move)$/ }).click();
    // Moving marks it seen: the band lets it go.
    await expect(item).toHaveCount(0, { timeout: 20_000 });

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, timezoneId: 'Europe/Madrid', locale: 'es-ES' });
    const sheet = await anon.newPage();
    await sheet.goto(`/public/roadsheet/${made.personal!.token}`);
    const moved = sheet.getByTestId('roadsheet-moved');
    await expect(moved).toContainText(`antes ${madrid(made.loadIn)}`, { timeout: 15_000 });
    await expect(sheet.getByTestId('roadsheet-day')).toContainText(to);
    await expect(sheet.getByTestId('roadsheet-late-state')).toContainText('lo ha visto');

    // The role link shows the moved time too: every sheet.
    await sheet.goto(`/public/roadsheet/${made.role!.token}`);
    await expect(sheet.getByTestId('roadsheet-moved')).toContainText(`antes ${madrid(made.loadIn)}`, { timeout: 15_000 });
    await anon.close();
  });
});
