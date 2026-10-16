import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * THE SEASON IS THE PORTADA (ADR-117). The Planner opens on twelve weeks from
 * today: the census in one line, the strip, what to decide, what is not
 * closed, the holes and who is out. Read-only: it never writes, so it can run
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
    await page.locator('.cal__view').nth(3).click();
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

  test('EVERY BLOCK IS THERE, EMPTY OR NOT — a block that vanishes reads as «did not load»', async ({
    page,
  }) => {
    await open(page);
    // Strip + decide + clashes + unclosed + gaps + away.
    await expect(page.locator('.ov .blk__t')).toHaveCount(6);
    // Nothing is still waiting once the lens says it has loaded.
    expect(await page.locator('.ov__facts').innerText()).not.toContain('–');
  });

  test('A DAY OF THE STRIP OPENS THAT DAY', async ({ page }) => {
    await open(page);
    const cell = page.locator('.ov .d').nth(20);
    const iso = await cell.getAttribute('data-day');
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`view=day.*d=${iso}|d=${iso}.*view=day`));
  });

  test('THE SEASON HAS NO WINDOW TO STEP — no arrows, no «now»', async ({ page }) => {
    await open(page);
    await expect(page.locator('.cal__arw')).toHaveCount(0);
    await expect(page.locator('.cal__now')).toHaveCount(0);
  });

  test('ON A PHONE, WHAT TO DECIDE COMES BEFORE THE STRIP', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    const decide = await page.locator('.ov__decide').boundingBox();
    const strip = await page.locator('.ov__strip').boundingBox();
    test.skip(!decide, 'the decisions feed is absent here');
    expect(decide!.y).toBeLessThan(strip!.y);
    // No horizontal scroll at phone width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
