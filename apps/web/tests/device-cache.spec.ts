import { test, expect, type Page } from '@playwright/test';

/**
 * THE QUERY CACHE KEPT ON THE DEVICE (ADR-144).
 *
 * An open paints the last-known data from IndexedDB without waiting for the
 * network, logout leaves nothing behind, and a second user on the same
 * browser never sees the first one's data.
 *
 * The cache is off under an automated browser (every other spec reloads to
 * prove what the server kept); this spec opts in with the same key the app
 * reads (`E2E_OPT_IN_KEY` in `$lib/offline/query-cache`). Its own logins, in
 * a context without the shared session: logging out revokes the session.
 */

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const LIMITED_EMAIL = process.env.PW_LIMITED_EMAIL;
const LIMITED_PASSWORD = process.env.PW_LIMITED_PASSWORD;

test.use({ storageState: { cookies: [], origins: [] } });

type Record = { sub: string; queries: number; workspaces: string[] } | null;

/** The device record, as the app keeps it (`hour-offline` › `query_cache`). */
function readRecord(page: Page): Promise<Record> {
  return page.evaluate(
    () =>
      new Promise<Record>((resolve) => {
        const open = indexedDB.open('hour-offline');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('query_cache')) {
            db.close();
            resolve(null);
            return;
          }
          const get = db.transaction('query_cache').objectStore('query_cache').get('query-client');
          get.onsuccess = () => {
            const r = get.result as
              | { user: { sub: string }; state: { queries: { queryKey: unknown[]; state: { data: unknown } }[] } }
              | undefined;
            db.close();
            if (!r) return resolve(null);
            const ws = r.state.queries.find((q) => q.queryKey[0] === 'workspaces')?.state.data as
              | { items: { slug: string }[] }
              | undefined;
            resolve({
              sub: r.user.sub,
              queries: r.state.queries.length,
              workspaces: (ws?.items ?? []).map((w) => w.slug).sort(),
            });
          };
          get.onerror = () => resolve(null);
        };
      }),
  );
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\/desk\/?$/);
}

async function loaded(page: Page, timeout?: number) {
  const main = page.getByRole('main');
  await expect(main.locator('[aria-busy]').first()).toBeAttached({ timeout });
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0, { timeout });
}

test.describe('device cache', () => {
  test.skip(
    !EMAIL || !PASSWORD || !LIMITED_EMAIL || !LIMITED_PASSWORD,
    'Set PW_TEST_* and PW_LIMITED_*.',
  );

  test('paints before the probe, is wiped on logout, never crosses users', async ({ context, page }) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('hour.e2e.device-cache', 'on');
      } catch {
        /* no storage: the spec fails below, loudly */
      }
    });

    await login(page, EMAIL!, PASSWORD!);
    await loaded(page, 0);
    // Written within a second of the last answer.
    await expect.poll(() => readRecord(page).then((r) => r?.queries ?? 0)).toBeGreaterThan(2);
    const first = (await readRecord(page))!;

    // Reopen with the session probe held back: the Desk paints from the device.
    const reopened = await context.newPage();
    let probeAnswered = false;
    await reopened.route('**/api/auth/session', async (route) => {
      await new Promise((r) => setTimeout(r, 4_000));
      await route.continue();
      probeAnswered = true;
    });
    await reopened.goto('/h/desk');
    await loaded(reopened, 3_000);
    expect(probeAnswered, 'the content painted before the session probe answered').toBe(false);
    await reopened.close();

    // Logout: the record, the memory and the cached user go.
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login\/?$/);
    expect(await readRecord(page)).toBeNull();
    // Without a cache and without a session, /h goes to the login.
    await page.goto('/h/desk');
    await page.waitForURL(/\/login\/?$/);

    // A second user on the same browser: only their own data is kept.
    await login(page, LIMITED_EMAIL!, LIMITED_PASSWORD!);
    await loaded(page, 0);
    await expect.poll(() => readRecord(page).then((r) => r?.sub ?? null)).not.toBeNull();
    const second = (await readRecord(page))!;
    expect(second.sub).not.toBe(first.sub);
    const own = (await (await page.request.get('/api/workspaces')).json()) as { items: { slug: string }[] };
    expect(second.workspaces).toEqual(own.items.map((w) => w.slug).sort());

    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login\/?$/);
    expect(await readRecord(page)).toBeNull();
  });
});
