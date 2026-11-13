/**
 * THE GIG DAY ON HOY (ADR-146; Ahora is no longer a screen, ADR-202 § 5):
 * its piece opens with what that mode showed.
 *
 * The spec owns its day: in the `playwright` workspace, on the fixture
 * project, it plants today a show (a venue with an address and a technical
 * contact, logistics with the fixed keys, a running order with doors and
 * curfew) and a trip with two stages and a booking reference, says «voy» to
 * both, and removes them after. The browser's clock is fixed at 8h30 Madrid,
 * so the headline is a countdown to the train.
 *
 * The running order is written by its collab doc in the app; here it goes
 * through `replace_schedule_slots`, the RPC the doc materialises with, as the
 * signed-in user (the session cookie's token, never a stored secret).
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.PUBLIC_SUPABASE_ANON_KEY;
/** zzz-e2e-collab — the stable fixture project of the playwright workspace. */
const PROJECT = '019f21d2-7482-77e6-9ad9-27d881cff305';
const VENUE = 'ZZZ E2E Ahora Teatre';

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

test.describe('The gig day on Hoy (ADR-146, ADR-202 § 5)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  test.skip(!SB_URL || !SB_ANON, 'Set PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY (the running order is planted by RPC).');
  test.describe.configure({ mode: 'serial' });

  const made: { perf: string | null; date: string | null } = { perf: null, date: null };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage();
    await page.goto('/h/desk');
    const me = await api(page, 'GET', '/api/me');
    const personId = (me.json?.person_id as string | null) ?? null;
    const wss = await api(page, 'GET', '/api/workspaces');
    const ws = (wss.json?.items as { id: string; slug: string }[]).find((w) => w.slug === 'playwright');
    expect(ws, 'playwright workspace reachable').toBeTruthy();

    // create_venue is idempotent on name + city: one fixture row, reused.
    const venue = await api(page, 'POST', '/api/venues', {
      workspace_id: ws!.id,
      name: VENUE,
      city: 'Girona',
      country: 'ES',
      address: 'Plaça del Vi 1',
      timezone: 'Europe/Madrid',
    });
    const venueId = idOf(venue, 'venue');
    expect(venueId).toBeTruthy();
    await api(page, 'PATCH', `/api/venues/${venueId}`, {
      contacts: [
        { name: 'Marta Soler', role: 'Programación', phone: '600 111 222' },
        { name: 'Jordi Puig', role: 'Cap tècnic', phone: '612 000 000' },
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
      logistics: { Hotel: 'Hotel Ultònia', 'Acceso de carga': 'c/ Ballesteries' },
    });
    const jwt = (await page.context().cookies()).find((c) => c.name === 'hour_at')?.value;
    expect(jwt, 'the session cookie').toBeTruthy();
    const slots = [
      ['load_in', '11:00'],
      ['soundcheck', '17:00'],
      ['doors', '20:00'],
      ['start', '20:30'],
      ['curfew', '23:30'],
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
      mode: 'train',
      from_city: 'Barcelona',
      from_place: 'Sants',
      to_city: 'Girona',
      to_place: null,
      depart_at: local('09:12'),
      arrive_at: local('10:31'),
      reference: 'K7Q2PX',
      notes: null,
    });
    expect(stage.status).toBe(201);

    if (personId) {
      await api(page, 'PUT', `/api/commitments/performance/${made.perf}`, { person_id: personId, state: 'going' });
      await api(page, 'PUT', `/api/commitments/date/${made.date}`, { person_id: personId, state: 'going' });
    }
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/h/desk');
    if (made.perf) await api(page, 'DELETE', `/api/performances/${made.perf}`);
    if (made.date) await api(page, 'DELETE', `/api/dates/${made.date}`);
    await page.close();
  });

  test('THE GIG DAY IS HOY\'S PIECE: THE DAY, FOUR FACTS AND THREE ACTIONS', async ({ page }) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(new Date(local('08:30')));
    await page.goto('/h/desk');
    await waitForLoaded(page);

    // Ahora is no longer a screen nor a button (ADR-202 § 5).
    await expect(page.getByTestId('ahora')).toHaveCount(0);
    await expect(page.getByTestId('ahora-enter')).toHaveCount(0);
    // At 8h30 the piece is the train, in 42 minutes: what and its hour at
    // one size, the countdown on the second line (§ 4).
    const piece = page.getByTestId('desk-next');
    await expect(page.getByTestId('desk-next-now')).toContainText('09h12', { timeout: 20_000 });
    await expect(piece).toContainText(/42\s*min/);
    // The day inside the piece: the show is still there, its row the day's main one.
    await expect(page.getByTestId('desk-agenda-main')).toContainText(VENUE);
    await expect(page.getByTestId('desk-agenda-main')).toContainText('20h30');
    // What Ahora showed, in the piece (ADR-203 § 4): the venue's technical
    // contact deduced from a free role, the load, the hotel.
    const facts = page.getByTestId('desk-facts');
    await expect(facts).toContainText('Jordi Puig', { timeout: 20_000 });
    await expect(facts).toContainText('c/ Ballesteries');
    await expect(facts).toContainText('Hotel Ultònia');
    // The thumb's three: a tel: link, a map, the road sheet.
    const acts = page.getByTestId('desk-acts');
    await expect(acts.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:612000000');
    await expect(acts.locator('a[href^="https://maps.apple.com/"]')).toHaveCount(1);
    await expect(acts.locator('a[href$="/roadsheet"]')).toHaveCount(1);
    // A gig day, «Te espera» is its pills only (ADR-203 § 9).
    await expect(page.getByTestId('desk-waiting-rows')).toHaveCount(0);
  });

  test('DOING SOMETHING, THE BIG HOUR IS UNTIL WHEN', async ({ page }) => {
    test.setTimeout(90_000);
    // 12h: inside the load-in (11h), which runs until the soundcheck at 17h.
    await page.clock.setFixedTime(new Date(local('12:00')));
    await page.goto('/h/desk');
    await waitForLoaded(page);
    await expect(page.getByTestId('desk-next-now')).toContainText('→ 17h', { timeout: 20_000 });
  });

  test('?mode=ahora LANDS ON HOY (ADR-203 § 7)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.setFixedTime(new Date(local('14:10')));
    await page.goto('/h/desk?mode=ahora');
    await expect(page).not.toHaveURL(/mode=ahora/, { timeout: 20_000 });
    await expect(page.getByTestId('desk-next')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ahora')).toHaveCount(0);
  });

  test('ON THE PHONE THE ACTIONS RUN THE WHOLE WIDTH OF THE PIECE', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      storageState: '.playwright/auth.json',
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      timezoneId: 'Europe/Madrid',
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(local('14:10')));
    await page.goto('/h/desk');
    const piece = page.getByTestId('desk-next');
    const acts = page.getByTestId('desk-acts');
    await expect(acts).toBeVisible({ timeout: 30_000 });
    const p = await piece.boundingBox();
    const a = await acts.boundingBox();
    // One row at the foot of the piece, edge to edge of its padding.
    expect(a && p && a.width).toBeGreaterThan((p?.width ?? 0) * 0.8);
    expect(a && p && a.y + a.height).toBeGreaterThan((p?.y ?? 0) + (p?.height ?? 0) - 60);
    // The bar of sections stays: Ahora no longer covers the frame.
    await expect(page.locator('.lensswitch-wrap')).toBeVisible();
    await context.close();
  });
});
