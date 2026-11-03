import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * THE SEASON IS THE PORTADA (ADR-117). The Planner opens on twelve weeks from
 * today: the strip, what to decide, what is not closed, the holes and who is
 * out, each block drawn when it has something (ADR-145). Read-only: it never writes, so it can run
 * against the fixture space without owning a row.
 *
 * Runs against a deployed origin or `vite dev` (`PW_BASE_URL`), never `vite
 * preview`.
 */

const SPACE = 's:playwright';

async function open(page: Page, query = '') {
  await page.goto(`/h/planner?scope=${SPACE}${query}`);
  await waitForLoaded(page);
}

test.describe('the season (ADR-117)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('THE NAV OPENS THE SEASON — and nothing remembers the last drawing', async ({ page }) => {
    await open(page);
    await expect(page.locator('.cal__view--on')).toHaveText(/season|temporada|saison/i);
    // Pick the month: the choice lives in that visit's URL…
    await page.locator('.cal__view').nth(2).click();
    await expect(page).toHaveURL(/view=month/);
    await page.reload();
    await waitForLoaded(page);
    expect(page.url()).toContain('view=month');
    // …and the nav's door, with no `view`, is the season again.
    await open(page);
    await expect(page.locator('.cal__view').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ov')).toBeVisible();
  });

  test('THE STRIP IS TWELVE WEEKS OF SEVEN DAYS, starting on this week’s Monday', async ({
    page,
  }) => {
    await open(page);
    const days = page.locator('.ov .d');
    await expect(days).toHaveCount(84);
    const first = await days.first().getAttribute('data-day');
    const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
    expect(dow, 'the strip does not start on a Monday').toBe(1);
    // Today is on it, exactly once.
    await expect(page.locator('.ov .d--today')).toHaveCount(1);
  });

  test('THE STRIP IS ALWAYS THERE, AND THE SEASON COUNTS ITSELF ONCE', async ({ page }) => {
    await open(page);
    // A block with nothing in it is not drawn (ADR-145 § 1); the strip is the
    // one that stays, empty or not.
    await expect(page.locator('.ov__strip .block-head h2')).toHaveCount(1);
    // The window line is drawn in every view (nota a ADR-167, 2026-11-02):
    // here it counts the season, with the figures no block below prints.
    const meta = page.locator('.cal__meta--window');
    await expect(meta).toBeVisible();
    await expect(meta).toContainText(/confirmed/i);
    await expect(meta).toContainText(/nights? free/i);
    await expect(meta).not.toContainText(/to decide|clash/i);
    // Nothing is still waiting once the lens says it has loaded.
    expect(await page.locator('.ov').innerText()).not.toMatch(/·\s*–/);
    expect(await meta.innerText()).not.toMatch(/–/);
  });

  for (const width of [1440, 390]) {
    test(`THE WINDOW LINE AND THE VIEW BAR STAY PUT IN THE FOUR VIEWS (${width} px)`, async ({ page }) => {
      // Marco, 2026-11-02: «al cambiar de vista todo salta». The line is drawn
      // in Season, Agenda, Month and Board, one line high, saying what each
      // window is; the Agenda names its horizon and counts nothing (ADR-095).
      // At 390 the arrows drop to a line of their own under the title, and the
      // Season keeps that room without them (§ 109): the view bar must not move.
      await page.setViewportSize({ width, height: 900 });
      const heights: number[] = [];
      const bars: number[] = [];
      for (const v of ['', '&view=agenda', '&view=month', '&view=board']) {
        const where = `${v || 'season'} at ${width}`;
        await open(page, v);
        const meta = page.locator('.cal__meta--window');
        await expect(meta, `window line in ${where}`).toBeVisible();
        expect((await meta.innerText()).trim(), `window line in ${where}`).not.toBe('');
        if (v === '&view=agenda') {
          await expect(meta).toContainText(/from today|open at/i);
          await expect(meta).not.toContainText(/confirmed|nights? free/i);
        }
        heights.push(Math.round((await meta.boundingBox())?.height ?? -1));
        bars.push(Math.round((await page.locator('.cal__views').boundingBox())?.y ?? -1));
      }
      // One line each: no view wraps or drops it…
      expect(new Set(heights).size, `heights ${heights.join(', ')}`).toBe(1);
      // …and the view bar is at the same height in all four.
      expect(new Set(bars).size, `view bar y ${bars.join(', ')}`).toBe(1);
    });
  }

  test('A DAY OF THE STRIP OPENS THAT DAY', async ({ page }) => {
    await open(page);
    const cell = page.locator('.ov .d').nth(20);
    const iso = await cell.getAttribute('data-day');
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`view=day.*d=${iso}|d=${iso}.*view=day`));
  });

  test('THE SEASON HAS NO WINDOW TO STEP — no arrows, no «now»', async ({ page }) => {
    await open(page);
    // Only their room is kept (§ 109): nothing to see, nothing to reach.
    await expect(page.locator('.cal__arw:visible')).toHaveCount(0);
    await expect(page.locator('.cal__now:visible')).toHaveCount(0);
    await expect(page.locator('.cal__navkeep')).toHaveAttribute('inert', '');
    await expect(page.locator('.cal__navkeep')).toHaveAttribute('aria-hidden', 'true');
  });

  test('ON A PHONE, WHAT TO DECIDE COMES BEFORE THE STRIP', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    // boundingBox() waits for the element: a block that is not drawn must answer at once.
    const box = async (sel: string) => {
      const el = page.locator(sel).first();
      return (await el.count()) ? el.boundingBox() : null;
    };
    const decide = await box('.ov__decide');
    const strip = await box('.ov__strip');
    // At zero the block is not drawn (ADR-145 § 1), and an absent feed draws nothing either.
    test.skip(!decide, 'nothing to decide here');
    expect(decide!.y).toBeLessThan(strip!.y);
    // No horizontal scroll at phone width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
