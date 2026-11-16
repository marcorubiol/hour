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

  // Every test meets the default (null, the Month) and leaves it there.
  test.beforeEach(async ({ page }) => forgetPlannerView(page.request));
  test.afterEach(async ({ page }) => forgetPlannerView(page.request));

  test('THE DOOR OPENS THE LAST DRAWING CHOSEN, AND THE ADDRESS STILL RULES (ADR-192)', async ({ page }) => {
    test.setTimeout(90_000);
    const views = page.locator('.cal__view');
    // Nothing chosen yet: the Month, the default.
    await open(page);
    await expect(views).toHaveCount(3);
    await expect(views.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.cal__grid')).toBeVisible();

    const choose = async (index: number, stored: string | null) => {
      const put = page.waitForResponse(
        (r) => r.url().includes('/api/me/planner-view') && r.request().method() === 'PUT',
      );
      await views.nth(index).click();
      const res = await put;
      expect(res.ok(), `PUT /api/me/planner-view answered ${res.status()}`).toBe(true);
      expect((res.request().postDataJSON() as { planner_view: string | null }).planner_view).toBe(stored);
    };
    await choose(0, 'agenda');
    await expect(page).toHaveURL(/view=agenda/);

    // The door, with no `view`, opens it, and writes it in the address.
    await open(page);
    await expect(views.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/view=agenda/);

    // An address that names a drawing rules, and is not a choice.
    await open(page, '&view=board');
    await expect(views.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await open(page);
    await expect(views.nth(0)).toHaveAttribute('aria-pressed', 'true');

    // Picking the Month stores null, the default.
    await choose(1, null);
    await open(page);
    await expect(views.nth(1)).toHaveAttribute('aria-pressed', 'true');
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
  });

  test('THE STATUS LINE COUNTS THE MONTH ON SCREEN', async ({ page }) => {
    await open(page, '&view=month');
    const line = page.locator('.pstat__line');
    await expect(line).toBeVisible();
    await expect(line).toContainText(/confirmed/i);
    await expect(line).toContainText(/nights? free/i);
    expect(await line.innerText()).not.toMatch(/–/);
  });

  for (const width of [1440, 390]) {
    test(`THE STATUS LINE AND THE VIEW BAR STAY PUT IN THE THREE VIEWS (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const heights: number[] = [];
      const bars: number[] = [];
      for (const v of ['&view=agenda', '&view=month', '&view=board']) {
        const where = `${v} at ${width}`;
        await open(page, v);
        const meta = page.locator('.cal__meta--window, .pstat__line');
        await expect(meta, `window line in ${where}`).toBeVisible();
        expect((await meta.innerText()).trim(), `window line in ${where}`).not.toBe('');
        heights.push(Math.round((await meta.boundingBox())?.height ?? -1));
        bars.push(Math.round((await page.locator('.cal__views').boundingBox())?.y ?? -1));
      }
      expect(new Set(bars).size, `view bar y ${bars.join(', ')}`).toBe(1);
      expect(new Set(heights).size, `heights ${heights.join(', ')}`).toBe(1);
    });
  }

  test('ON A PHONE: no sideways scroll, two monograms, and the picked day read under its week', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '&view=month');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
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
});
