/**
 * AHORA (ADR-146) — the gig day, one screen, a mode of Hoy.
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

test.describe('Ahora, the gig day (ADR-146)', () => {
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

  test('IN FROM HOY, OUT WITH «SALIR», AND A RELOAD KEEPS IT', async ({ page }) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(new Date(local('08:30')));
    await page.goto('/h/desk');
    await waitForLoaded(page);

    // Never by itself: Hoy is Hoy until you press the door, which is in the
    // foot of the card the headline titles (ADR-148), not a line of its own.
    await expect(page.getByTestId('ahora')).toHaveCount(0);
    // The day is an agenda (ADR-150): at 8h30 the card is the train, in 42
    // minutes; the show is still there, its row marked as the day's main one.
    const card = page.getByTestId('desk-next');
    await expect(page.getByTestId('desk-next-now')).toContainText(/42\s*min/, { timeout: 20_000 });
    await expect(card).toContainText('K7Q2PX');
    await expect(page.getByTestId('desk-agenda-main')).toContainText(VENUE);
    await expect(page.getByTestId('desk-agenda-main')).toContainText('20h30');
    const enter = card.getByTestId('ahora-enter');
    await expect(enter).toBeVisible({ timeout: 20_000 });
    await enter.click();
    await expect(page).toHaveURL(/[?&]mode=ahora\b/);

    const ahora = page.getByTestId('ahora');
    await expect(ahora).toBeVisible();
    // The countdown to the train, in minutes, and its reference.
    await expect(page.getByTestId('ahora-head')).toContainText(/42\s*min/, { timeout: 20_000 });
    await expect(page.getByTestId('ahora-trip')).toContainText('K7Q2PX');
    // The venue: its address and the technical contact, deduced from a free role.
    await expect(page.getByTestId('ahora-venue')).toContainText('Plaça del Vi 1');
    await expect(page.getByTestId('ahora-contact')).toContainText('Jordi Puig');
    await expect(page.getByTestId('ahora-venue')).toContainText('Hotel Ultònia');
    // Doors and curfew are moments with a name, in the app's words.
    const order = page.getByTestId('ahora-order');
    await expect(order).toContainText(/doors|puertas|portes/i);
    await expect(order).toContainText(/curfew|toque de queda|toc de queda|couvre-feu/i);
    // The thumb's three: a tel: link, a map, the road sheet.
    await expect(ahora.locator('.ahora__actions a[href^="tel:"]')).toHaveAttribute('href', 'tel:612000000');
    await expect(ahora.locator('.ahora__actions a[href^="https://maps.apple.com/"]')).toHaveCount(1);
    await expect(ahora.locator('.ahora__actions a[href$="/roadsheet"]')).toHaveCount(1);
    // The selector keeps Hoy marked: Ahora is a mode of it, not a fifth lens.
    await expect(page.locator('a[aria-current="page"][href="/h/desk"]').first()).toBeAttached();

    await page.reload();
    await expect(page.getByTestId('ahora')).toBeVisible({ timeout: 20_000 });

    await ahora.locator('.ahora__exit').click();
    await expect(page).not.toHaveURL(/mode=ahora/);
    await expect(page.getByTestId('ahora')).toHaveCount(0);
    await expect(page.getByTestId('ahora-enter')).toBeVisible();
  });

  test('ON THE PHONE IT COVERS THE FRAME, THE BAR OF SECTIONS INCLUDED', async ({ browser }) => {
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
    await page.goto('/h/desk?mode=ahora');
    const ahora = page.getByTestId('ahora');
    await expect(page.getByTestId('ahora-head')).toBeVisible({ timeout: 30_000 });
    const box = await ahora.boundingBox();
    expect(box?.width).toBe(390);
    expect(box?.height).toBe(844);
    // The actions sit at the foot, where the bar of sections was.
    const actions = await ahora.locator('.ahora__actions').boundingBox();
    expect(actions && actions.y + actions.height).toBeGreaterThan(800);
    // What it is on top of cannot be pressed through it.
    const topmost = await page.evaluate(() => {
      const el = document.elementFromPoint(195, 830);
      return el?.closest('[data-testid="ahora"]') !== null;
    });
    expect(topmost, 'the bar of sections is under Ahora').toBe(true);
    await context.close();
  });
});
