import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { forgetPlannerView } from './planner-view';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * THE MONTH TOOK OVER THE COMING WEEKS (ADR-209). The bar says three words,
 * the Planner opens on a continuous month with no week column, and one status
 * line under the title says what to decide, what clashes and the count. It
 * owns no row: the one thing it writes is the E2E user's own entry drawing
 * (ADR-192), and it leaves that as it found it, null.
 *
 * Runs against a deployed origin (`PW_BASE_URL`), never `vite preview`.
 */

const SPACE = 's:playwright';

async function open(page: Page, query = '') {
  await page.goto(`/h/planner?scope=${SPACE}${query}`);
  await waitForLoaded(page);
}

test.describe('the month (ADR-209)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  // Every test meets the default (null, the Agenda since ADR-211) and leaves it there.
  test.beforeEach(async ({ page }) => forgetPlannerView(page.request));
  test.afterEach(async ({ page }) => forgetPlannerView(page.request));

  test('THE DOOR OPENS THE LAST DRAWING CHOSEN, AND THE ADDRESS STILL RULES (ADR-192)', async ({ page }) => {
    test.setTimeout(90_000);
    const views = page.locator('.cal__view');
    // Nothing chosen yet: the Agenda, the default (ADR-211 § 4).
    await open(page);
    await expect(views).toHaveCount(3);
    await expect(views.nth(0)).toHaveAttribute('aria-pressed', 'true');

    const choose = async (index: number, stored: string | null) => {
      const put = page.waitForResponse(
        (r) => r.url().includes('/api/me/planner-view') && r.request().method() === 'PUT',
      );
      await views.nth(index).click();
      const res = await put;
      expect(res.ok(), `PUT /api/me/planner-view answered ${res.status()}`).toBe(true);
      expect((res.request().postDataJSON() as { planner_view: string | null }).planner_view).toBe(stored);
    };
    await choose(1, 'month');
    await expect(page).toHaveURL(/view=month/);
    await expect(page.locator('.cal__grid')).toBeVisible();

    // The door, with no `view`, opens it, and writes it in the address.
    await open(page);
    await expect(views.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/view=month/);

    // An address that names a drawing rules, and is not a choice.
    await open(page, '&view=board');
    await expect(views.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await open(page);
    await expect(views.nth(1)).toHaveAttribute('aria-pressed', 'true');

    // Picking the Agenda stores null, the default.
    await choose(0, null);
    await open(page);
    await expect(views.nth(0)).toHaveAttribute('aria-pressed', 'true');
  });

  test('A LINK TO THE COMING WEEKS OPENS THE MONTH, WITHOUT ERROR', async ({ page }) => {
    await open(page, '&view=overview');
    await expect(page).toHaveURL(/view=month/);
    await expect(page.locator('.cal__grid')).toBeVisible();
    await expect(page.locator('.cal__view')).toHaveCount(3);
  });

  test('THE PAPER RUNS ON: no week column, the 1st named by its month, months by tone', async ({ page }) => {
    await open(page, '&view=month');
    await expect(page.locator('.cal__wkg, .cal__wkn')).toHaveCount(0);
    const firsts = page.locator('.cal__grid [data-month-start]');
    expect(await firsts.count(), 'more than one month on the paper').toBeGreaterThan(1);
    // The 1st says its month, never «1».
    expect((await firsts.nth(1).innerText()).trim()).not.toBe('1');
    // Weeks are Monday first.
    const first = await page.locator('.cal__grid .cal__num').first().getAttribute('data-day');
    expect(new Date(`${first}T00:00:00Z`).getUTCDay()).toBe(1);
    // «week» is not a label of the Month.
    expect(await page.locator('.cal__grid').innerText()).not.toMatch(/\bweek\b/i);
    // The sheet is closed on the left: the axis and every week carry the edge.
    const openLeft = await page.evaluate(
      () =>
        [...document.querySelectorAll('.cal__wkh, .cal__wkbody')].filter(
          (el) => parseFloat(getComputedStyle(el).borderLeftWidth) < 1,
        ).length,
    );
    expect(openLeft, 'a week of the Month is open on the left').toBe(0);
  });

  test('THE STATUS LINE COUNTS THE MONTH ON SCREEN', async ({ page }) => {
    await open(page, '&view=month');
    const line = page.locator('.pstat__line');
    await expect(line).toBeVisible();
    await expect(line).toContainText(/confirmed/i);
    // Four figures and no more (tarea 165): the nights free are said on the
    // sheet, the people away are «Who's out», the trips are on their days.
    await expect(line).not.toContainText(/nights? free|unavailable|trips?\b/i);
    expect(await line.innerText()).not.toMatch(/–/);
  });

  test('«WHO’S OUT» IS OFF UNTIL ASKED, AND REMEMBERED ON THE DEVICE (tarea 165)', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('hour:planner:who-out'));
    await open(page, '&view=month');
    const who = page.getByTestId('month-who-out');
    await expect(who).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('month-bar-absence')).toHaveCount(0);
    await who.click();
    await expect(who).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('hour:planner:who-out'))).toBe('on');
    await who.click();
    await expect(who).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('month-bar-absence')).toHaveCount(0);
  });

  for (const width of [1440, 390]) {
    test(`THE STATUS LINE AND THE VIEW BAR STAY PUT IN THE THREE VIEWS (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const heights: number[] = [];
      const bars: number[] = [];
      for (const v of ['&view=agenda', '&view=month', '&view=board']) {
        const where = `${v} at ${width}`;
        await open(page, v);
        // The Agenda may have nothing to say (no count, nothing to decide):
        // its line is still there, one line tall, so the bar never moves.
        const meta = page.locator('.pstat__line');
        await expect(meta, `status line in ${where}`).toHaveCount(1);
        heights.push(Math.round((await meta.boundingBox())?.height ?? -1));
        bars.push(Math.round((await page.locator('.cal__views').boundingBox())?.y ?? -1));
      }
      expect(new Set(bars).size, `view bar y ${bars.join(', ')}`).toBe(1);
      expect(new Set(heights).size, `heights ${heights.join(', ')}`).toBe(1);
    });
  }

  for (const width of [1440, 390]) {
    test(`MID-MONTH THE MONTH IS STILL SAID: title and weekday axis stuck as one strip (${width} px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '&view=month');
      const next = await page.locator('.cal__grid [data-month-start]').nth(1).getAttribute('data-month-start');
      expect(next).toBeTruthy();
      // The week of the 15th of the next month, just under the strip: well
      // past the head at rest. Twice: the strip only sticks once scrolled.
      // Instant: the page scrolls smoothly by default, and the second pass
      // must measure where the first one landed.
      for (let i = 0; i < 2; i++) {
        await page.evaluate((iso) => {
          const el = document.querySelector(`.cal__grid .cal__num[data-day="${iso}"]`)!;
          const foot = document.querySelector('.cal__wkh')!.getBoundingClientRect().bottom;
          window.scrollBy({ top: el.getBoundingClientRect().top - foot - 2, behavior: 'instant' });
        }, `${next}-15`);
      }
      await expect(page).toHaveURL(new RegExp(`ym=${next}`));
      const strip = await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        return { head: r('.cal .lenshead'), axis: r('.cal__wkh'), views: r('.cal__views') };
      });
      // The title row is on screen, the axis right under it, no seam between.
      expect(strip.head.top).toBeGreaterThanOrEqual(0);
      expect(Math.abs(strip.axis.top - strip.head.bottom), 'a seam between title and axis').toBeLessThanOrEqual(2);
      // Nothing passes between the frame and the strip: the head meets the
      // bar, and over a pinned head the bar's paper is solid, not frosted.
      const frame = await page.evaluate(() => {
        const bar = document.querySelector('.shell__top')!;
        return { paper: getComputedStyle(bar, '::before').backgroundColor, bottom: bar.getBoundingClientRect().bottom };
      });
      expect(strip.head.top, 'a gap between the bar and the title').toBeLessThanOrEqual(frame.bottom);
      expect(frame.paper, 'the bar is see-through over the stuck strip').not.toMatch(/\/\s*0?\.\d|rgba\(.*,\s*0?\.\d+\)/);
      // The rest of the head went with the scroll.
      expect(strip.views.bottom).toBeLessThanOrEqual(strip.head.bottom);
      await expect(page.locator('.lenshead__title')).toContainText(
        new Date(`${next}-01T12:00:00Z`).toLocaleString('en', { month: 'long', timeZone: 'UTC' }),
      );
      // «Now» lands today's row under the strip, not behind it.
      await page.locator('.cal__now:not(.cal__whoout)').click();
      const today = await page.evaluate(() => ({
        row: document.querySelector('.cal__day--today')!.getBoundingClientRect().top,
        axis: document.querySelector('.cal__wkh')!.getBoundingClientRect().bottom,
      }));
      expect(today.row).toBeGreaterThanOrEqual(today.axis - 1);
      // …and the title says today's month, whatever the rows' height.
      await expect(page.locator('.lenshead__title')).toContainText(
        new Date().toLocaleString('en', { month: 'long' }),
      );
    });
  }

  test('ON A PHONE: no sideways scroll, two monograms, and the picked day read under its week', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '&view=month');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // NO BAND WRITES PAST ITS OWN DAYS (2026-11-18): a one- or two-day
    // absence at 390 printed «UNAVAILABLE» and its rule 35px past Sunday.
    // The page check above only catches it when the band sits on a Sunday;
    // this one holds every band, wherever it falls in the week.
    const spill = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.cal__bar')].flatMap((band) => {
        const edge = band.getBoundingClientRect().right;
        return [...band.querySelectorAll<HTMLElement>(':scope > *')]
          .filter((c) => getComputedStyle(c).display !== 'none')
          .map((c) => c.getBoundingClientRect().right - edge)
          .filter((d) => d > 1)
          .map((d) => `${band.title}: ${Math.round(d)}px`);
      }),
    );
    expect(spill, 'a band whose words or rule leave its days').toEqual([]);
    // No cell draws more than two slips.
    const most = await page.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll('.cal__day')].map(
          (c) => [...c.querySelectorAll(':scope > .slip')].filter((s) => getComputedStyle(s).display !== 'none').length,
        ),
      ),
    );
    expect(most).toBeLessThanOrEqual(2);
    // A tap on a day picks it; the day is drawn under its week.
    const cell = page.locator('.cal__day').nth(10);
    await cell.click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId('month-pick')).toBeVisible();
  });

  test('a figure at zero is not said, and «Go to today» is not a second «Today» (ADR-229)', async ({ page }) => {
    await open(page, '&view=month');
    // The playwright space has confirmed gigs: its figure is said…
    await expect(page.getByTestId('planner-stat-confirmed')).toBeVisible();
    // …and no census figure is ever a zero.
    for (const t of await page.locator('[data-testid^="planner-stat-"]').allTextContents()) {
      expect(t.trim()).not.toMatch(/^0\b/);
    }
    await expect(page.locator('.cal__now:not(.cal__whoout)')).toHaveText('Go to today');
  });
});
