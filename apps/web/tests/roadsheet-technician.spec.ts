/**
 * 120 · LA HOJA DE RUTA DEL TÉCNICO (ADR-177). Pau, sólo con el móvil:
 * «¿a qué hora cargo y a quién llamo?». Su enlace (rol técnico) abre su hoja
 * sin pestañas de otros roles, sin caché ni «confirmar», con la dirección,
 * «Llamar a Jordi» (tel:), «Cómo llegar» (mapa) y el día en orden, un
 * itinerario con la raya de ahora.
 *
 * The spec owns its rows, in `playwright` on the fixture project: today a
 * show at a venue with an address and two contacts, a running order, the
 * company's hospitality (that the technician must not get), and a trip with
 * a timed stage. A tech_manager link opens in an anonymous 390 px context
 * with the clock at 13h10 Madrid. Everything is revoked and deleted after.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.PUBLIC_SUPABASE_ANON_KEY;
/** zzz-e2e-collab — the stable fixture project of the playwright workspace. */
const PROJECT = '019f21d2-7482-77e6-9ad9-27d881cff305';
const VENUE = 'ZZZ E2E Hoja Teatre';

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
/** A Madrid wall clock today, as an instant. */
function local(hm: string): string {
  const guess = new Date(`${TODAY}T${hm}:00Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (shown.getTime() - utc.getTime())).toISOString();
}

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

test.describe('the technician’s road sheet (120)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  test.skip(!SB_URL || !SB_ANON, 'Set PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY (the running order is planted by RPC).');
  test.describe.configure({ mode: 'serial' });

  const made: { perf: string | null; date: string | null; share: string | null; token: string | null } = {
    perf: null,
    date: null,
    share: null,
    token: null,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage();
    await page.goto('/h/desk');
    await waitForLoaded(page);
    const wss = await api(page, 'GET', '/api/workspaces');
    const ws = (wss.json?.items as { id: string; slug: string }[]).find((w) => w.slug === 'playwright');
    expect(ws, 'playwright workspace reachable').toBeTruthy();

    const venue = await api(page, 'POST', '/api/venues', {
      workspace_id: ws!.id,
      name: VENUE,
      city: 'Girona',
      country: 'ES',
      address: 'Pl. del Vi 1',
      timezone: 'Europe/Madrid',
    });
    const venueId = idOf(venue, 'venue');
    expect(venueId).toBeTruthy();
    await api(page, 'PATCH', `/api/venues/${venueId}`, {
      contacts: [
        { name: 'Marta Soler', role: 'Programación', phone: '600 111 222' },
        { name: 'Jordi Sastre', role: 'técnica', phone: '612 000 000' },
      ],
    });

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
    await api(page, 'PATCH', `/api/performances/${made.perf}`, {
      venue_id: venueId,
      logistics: { 'Acceso de carga': 'calle de atrás' },
      hospitality: { Dietas: 'zzz-hospitality-secret' },
      technical: { Varas: '6 varas, 2 de suelo' },
    });

    const jwt = (await page.context().cookies()).find((c) => c.name === 'hour_at')?.value;
    expect(jwt, 'the session cookie').toBeTruthy();
    const slots = [
      ['load_in', '11:00'],
      ['start', '20:00'],
      ['loadout', '22:30'],
    ].map(([kind, hm]) => ({ kind, label: null, at: local(hm), ends_at: null, notes: null }));
    const rpc = await fetch(`${SB_URL}/rest/v1/rpc/replace_schedule_slots`, {
      method: 'POST',
      headers: { apikey: SB_ANON!, Authorization: `Bearer ${decodeURIComponent(jwt!)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_target_table: 'performance', p_target_id: made.perf, p_slots: slots }),
    });
    expect(rpc.status).toBe(200);

    const trip = await api(page, 'POST', '/api/dates', {
      project_id: PROJECT,
      kind: 'travel_day',
      starts_at: local('00:00'),
      all_day: true,
      origin_city: 'Barcelona',
      destination_city: 'Girona',
      city: 'Girona',
      status: 'confirmed',
    });
    made.date = idOf(trip, 'date');
    expect(made.date).toBeTruthy();
    const stage = await api(page, 'POST', `/api/dates/${made.date}/stages`, {
      mode: 'car',
      from_city: 'Barcelona',
      from_place: null,
      to_city: 'Girona',
      to_place: null,
      depart_at: local('09:00'),
      arrive_at: local('10:45'),
      reference: null,
      notes: null,
    });
    expect(stage.status).toBe(201);

    const share = await api(page, 'POST', `/api/performances/${made.perf}/roadsheet/shares?ws=playwright`, {
      role: 'tech_manager',
    });
    expect(share.status).toBe(201);
    made.share = idOf(share, 'share');
    made.token = (share.json?.share as { token?: string } | undefined)?.token ?? null;
    expect(made.token).toMatch(/^[0-9a-f]{64}$/);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/h/desk');
    if (made.perf && made.share) {
      await api(page, 'DELETE', `/api/performances/${made.perf}/roadsheet/shares/${made.share}?ws=playwright`);
    }
    if (made.perf) await api(page, 'DELETE', `/api/performances/${made.perf}`);
    if (made.date) await api(page, 'DELETE', `/api/dates/${made.date}`);
    await page.close();
  });

  test('his link on the phone: where, whom to call, the day in order with the now line', async ({ browser }) => {
    test.setTimeout(60_000);
    const anon = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
      timezoneId: 'Europe/Madrid',
    });
    const page = await anon.newPage();
    await page.clock.setFixedTime(new Date(local('13:10')));
    await page.goto(`/public/roadsheet/${made.token}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(VENUE, { timeout: 15_000 });

    // His sheet only: no tabs of the other roles, no money, no «confirmar».
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/€|fee|caché|cachet/i);
    await expect(page.getByRole('button', { name: /confirm/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /confirm/i })).toHaveCount(0);
    // The company's hospitality is the performer's, not his.
    await expect(page.locator('main')).not.toContainText('zzz-hospitality-secret');

    // Where: the address, the venue's technician, a call and a map.
    const where = page.getByTestId('roadsheet-where');
    await expect(where).toContainText('Pl. del Vi 1');
    await expect(where).toContainText('Jordi Sastre');
    await expect(page.getByTestId('roadsheet-call')).toHaveAttribute('href', 'tel:612000000');
    await expect(page.getByTestId('roadsheet-call')).toContainText('Jordi');
    await expect(page.getByTestId('roadsheet-call')).not.toContainText('Sastre');
    await expect(page.getByTestId('roadsheet-directions')).toHaveAttribute('href', /^https:\/\/maps\.apple\.com\/\?q=Pl\.%20del%20Vi%201/);

    // The day in order: the drive, the load-in, now, the show, the load-out.
    const day = page.getByTestId('roadsheet-day');
    const rows = day.locator('li');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toHaveAttribute('data-testid', 'roadsheet-travel');
    await expect(rows.nth(0)).toContainText('09:00');
    await expect(rows.nth(1)).toContainText('11:00');
    await expect(rows.nth(2)).toHaveAttribute('data-testid', 'roadsheet-now');
    await expect(rows.nth(2)).toContainText('13:10');
    await expect(rows.nth(3)).toContainText('20:00');
    await expect(rows.nth(4)).toContainText('22:30');

    // Nothing spills sideways on a 390 px phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await anon.close();
  });
});
