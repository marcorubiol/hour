import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E: THE SECTIONS LIVE IN THE FRAME (ADR-140), READ ONLY. Every POST,
 * PATCH, PUT and DELETE to `/api/` is refused before it leaves the browser.
 *
 *   - the switcher is ONE box in the top bar, against its right edge (the
 *     20-10 amendment): the same right edge, y and height on the four
 *     lenses, on every view of the Planner, on a record and on Settings. It
 *     cannot move under the cursor because no page draws it;
 *   - you (the account menu) live at the foot of the rail beside it, and in
 *     the top bar only on a phone, where the rail is a drawer;
 *   - off a lens it marks the lens you came from, and says so to a reader,
 *     without claiming to be the page;
 *   - on a phone (390) it is a bar at the foot of the screen, and the end of
 *     the page scrolls clear of it.
 *
 * Fixture: the `playwright` space (never `muk-cia`). A record that is not
 * there skips its own check, not the file.
 */

async function readOnly(page: Page) {
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    return route.abort();
  });
}

const SCOPE = '?scope=s:playwright';

function sections(page: Page) {
  return page.getByRole('navigation', { name: 'Sections', exact: true });
}

/** The switcher's box once the page has settled and the type has loaded. */
async function boxOf(page: Page, path: string) {
  await page.goto(path);
  // Settings is not a lens or a record and declares no `aria-busy`, so
  // `waitForLoaded` would wait for a signal it never gives (red on its first
  // run against production, 2026-10-20). There the page has settled when its
  // section heading is drawn.
  if (path.includes('/settings')) {
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  } else {
    await waitForLoaded(page);
  }
  await page.evaluate(() => document.fonts.ready);
  const box = await sections(page).boundingBox();
  expect(box, `the sections are drawn on ${path}`).not.toBeNull();
  return box!;
}

/** A performance of the fixture space, by its page; null when there is none. */
async function aRecord(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const r = await fetch('/api/performances?status=any&from=2000-01-01&to=2100-12-31&limit=50');
    const j = (await r.json()) as { items?: { slug: string | null; project?: { workspace_id?: string } | null }[] };
    const ws = (await (await fetch('/api/workspaces')).json()) as { items: { id: string; slug: string }[] };
    const space = ws.items.find((w) => w.slug === 'playwright');
    const row = (j.items ?? []).find((p) => p.slug && p.project?.workspace_id === space?.id);
    return row ? `/h/playwright/performance/${row.slug}` : null;
  });
}

test.describe('the sections in the frame (ADR-140)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('one box, in the same place on every lens, view and record', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await readOnly(page);

    const first = await boxOf(page, `/h/desk${SCOPE}`);
    await expect(sections(page).getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

    const paths = [
      `/h/planner${SCOPE}`,
      `/h/planner${SCOPE}&view=day`,
      `/h/planner${SCOPE}&view=agenda`,
      `/h/planner${SCOPE}&view=month`,
      `/h/planner${SCOPE}&view=board`,
      `/h/conversations${SCOPE}`,
      `/h/books${SCOPE}`,
      '/h/playwright/settings',
    ];
    const record = await aRecord(page);
    if (record) paths.push(record);

    // Anchored right: the right edge lands on the page's gutter.
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(first.x + first.width).toBeLessThan(vw);
    expect(first.x).toBeGreaterThan(vw / 2);

    for (const path of paths) {
      const box = await boxOf(page, path);
      expect.soft(box.x + box.width, `right edge on ${path}`).toBeCloseTo(first.x + first.width, 1);
      expect.soft(box.y, `y on ${path}`).toBeCloseTo(first.y, 1);
      expect.soft(box.height, `height on ${path}`).toBeCloseTo(first.height, 1);
    }
    if (!record) test.info().annotations.push({ type: 'skip', description: 'no performance in the fixture space' });
  });

  test('you live at the foot of the rail; on a phone, in the top bar', async ({ page }) => {
    await readOnly(page);
    const account = () => page.getByRole('button', { name: 'Open account menu' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/h/desk${SCOPE}`);
    await waitForLoaded(page);
    // One account on screen, inside the rail, near its foot; none in the bar.
    await expect(account()).toHaveCount(1);
    await expect(page.locator('#shell-rail').getByRole('button', { name: 'Open account menu' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Open account menu' })).toHaveCount(0);
    const rail = (await page.locator('#shell-rail').boundingBox())!;
    const me = (await account().boundingBox())!;
    expect(me.x + me.width).toBeLessThanOrEqual(rail.x + rail.width);
    expect(me.y + me.height, 'at the foot of the screen').toBeGreaterThan(900 - 100);
    await account().click();
    await expect(page.getByRole('menuitem', { name: 'All settings' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await waitForLoaded(page);
    await expect(account()).toHaveCount(1);
    await expect(page.locator('header').getByRole('button', { name: 'Open account menu' })).toBeVisible();
    expect((await account().boundingBox())!.y).toBeLessThan(60);
  });

  test('off a lens, it marks the lens you came from, and says so', async ({ page }) => {
    await readOnly(page);
    await page.goto(`/h/planner${SCOPE}`);
    await waitForLoaded(page);
    const planner = sections(page).getByRole('link', { name: 'Planner', exact: true });
    await expect(planner).toHaveAttribute('aria-current', 'page');

    await page.goto('/h/playwright/settings');
    // Not the page you are on: no aria-current anywhere in the sections…
    await expect(sections(page).locator('[aria-current]')).toHaveCount(0);
    // …but the lens you came from, described as such.
    await expect(planner).toHaveAccessibleDescription('You came from this section');
    await expect(sections(page).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-describedby', /.+/);

    await planner.click();
    await expect(page).toHaveURL(/\/h\/planner/);
    await expect(planner).toHaveAttribute('aria-current', 'page');
  });

  test('on a phone, a bar at the foot that hides nothing', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await readOnly(page);
    await page.goto(`/h/conversations${SCOPE}`);
    await waitForLoaded(page);

    const bar = sections(page);
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(box.y + box.height, 'the bar sits on the foot of the screen').toBeCloseTo(vh, 0);
    expect(box.width).toBeCloseTo(390, 0);
    await expect(bar.getByRole('link', { name: 'Today' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Conversations' })).toHaveAttribute('aria-current', 'page');

    // At the end of the page, the last thing on it is above the bar.
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
    }
    const lastBottom = await page.evaluate(() => {
      const content = document.querySelector('#main .shell__content')!;
      const drawn = [...content.querySelectorAll('*')].filter(
        (e) => !e.closest('dialog') && (e as HTMLElement).offsetHeight > 0 && getComputedStyle(e).position !== 'fixed',
      );
      return Math.max(...drawn.map((e) => e.getBoundingClientRect().bottom));
    });
    const top = (await bar.boundingBox())!.y;
    expect(lastBottom, 'the last line of the page clears the bar').toBeLessThanOrEqual(top);
  });
});
