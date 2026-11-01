import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * OPENING HOY ON A PHONE, AS A CAP (ADR-158).
 *
 * A phone-sized Chromium (390 wide, CPU ×4, slow 4G: 150 ms, 1.6 Mbps down)
 * opens /h/desk three ways, three times each, and the median of each must
 * stay under its cap:
 *   - cold: a fresh profile, signed in, with nothing cached;
 *   - warm: a reopen with the device cache (ADR-144) good;
 *   - schema bump: a reopen after a deploy that raised CACHE_SCHEMA, so the
 *     device record is wiped and the open waits for the network. A deploy
 *     that keeps the schema opens as warm does (ADR-158).
 * "Content" is the page law of tests/loaded.ts: `main` mounted and nothing in
 * it `aria-busy="true"`, timed from the navigation's own start.
 *
 * Where the caps come from: production 95288d0b on 2026-11-01, same throttle,
 * median of 5 from Madrid with the E2E user (build/coordination/load-speed):
 * cold 3799 ms, a reopen with the cache wiped 2674 ms, a warm reopen 660 ms.
 * The caps leave room for a day's network and server latency, not for a
 * slower app: if one trips, find what got slower, do not raise it.
 *
 * Read only: it opens one page and writes nothing (the device cache lives in
 * this browser). The service worker stays off under an automated browser, so
 * this measures the app and the network, not the SW.
 */

const CAP_MS = { cold: 5_000, warm: 1_000, schemaBump: 3_500 } as const;
const RUNS = 3;
const DEVICE_CACHE_OPT_IN = 'hour.e2e.device-cache';

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
test.describe.configure({ mode: 'serial' });

async function phone(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

/** Milliseconds from the navigation's start to the first real content of Hoy. */
async function openHoy(context: BrowserContext): Promise<number> {
  const page = await context.newPage();
  await phone(page);
  await page.goto('/h/desk', { waitUntil: 'commit' });
  const handle = await page.waitForFunction(
    () => {
      const main = document.querySelector('main');
      const done = !!main?.querySelector('[aria-busy]') && !main.querySelector('[aria-busy="true"]');
      return done ? Math.round(performance.now()) : 0;
    },
    null,
    { polling: 16, timeout: 30_000 },
  );
  const ms = (await handle.jsonValue()) as number;
  await page.close();
  return ms;
}

/** The device record, once the app has written it (at most once a second). */
async function recordSettled(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto('/health/live');
  await expect
    .poll(() => page.evaluate(hasRecord), { intervals: [1_200], timeout: 10_000 })
    .toBe(true);
  await page.close();
}

function hasRecord(): Promise<boolean> {
  return new Promise((resolve) => {
    const open = indexedDB.open('hour-offline');
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('query_cache')) return resolve(false);
      const get = db.transaction('query_cache').objectStore('query_cache').get('query-client');
      get.onsuccess = () => resolve(Boolean(get.result));
      get.onerror = () => resolve(false);
    };
  });
}

/** What a deploy that raised CACHE_SCHEMA leaves on the phone: a record of the old schema. */
async function outdateRecord(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto('/health/live');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('hour-offline');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction('query_cache', 'readwrite').objectStore('query_cache');
          const get = store.get('query-client');
          get.onsuccess = () => {
            // `build` too: a production still on the SHA buster (before ADR-158) wipes on that.
            store.put({ ...get.result, schema: -1, build: 'outdated' }, 'query-client').onsuccess = () => resolve();
          };
        };
      }),
  );
  await page.close();
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test.describe('opening Hoy on a phone', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CPU and network throttling are Chromium (CDP) only.');

  test('cold, warm and after a schema bump stay under their caps', async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const { baseURL, storageState, timezoneId } = testInfo.project.use;
    const times = { cold: [] as number[], warm: [] as number[], schemaBump: [] as number[] };

    for (let i = 0; i < RUNS; i++) {
      // A fresh profile is a cold phone: no HTTP cache, no device record.
      const context = await browser.newContext({ ...PHONE, baseURL, storageState, timezoneId });
      await context.addInitScript((key) => {
        try {
          localStorage.setItem(key, 'on');
        } catch {
          /* no storage: the warm case fails below, loudly */
        }
      }, DEVICE_CACHE_OPT_IN);
      times.cold.push(await openHoy(context));
      await recordSettled(context);
      times.warm.push(await openHoy(context));
      await outdateRecord(context);
      times.schemaBump.push(await openHoy(context));
      await context.close();
    }

    const result = {
      cold: median(times.cold),
      warm: median(times.warm),
      schemaBump: median(times.schemaBump),
    };
    testInfo.annotations.push({ type: 'open-speed', description: JSON.stringify({ result, times }) });
    expect.soft(result.cold, `cold ${times.cold.join(', ')} ms`).toBeLessThanOrEqual(CAP_MS.cold);
    expect.soft(result.warm, `warm ${times.warm.join(', ')} ms`).toBeLessThanOrEqual(CAP_MS.warm);
    expect
      .soft(result.schemaBump, `after a schema bump ${times.schemaBump.join(', ')} ms`)
      .toBeLessThanOrEqual(CAP_MS.schemaBump);
  });
});
