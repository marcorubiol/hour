import { test } from '@playwright/test';

// TEMP — scratch screenshot of the planner month view for a design session.
// Delete after use. Run against the live dev server via PW_BASE_URL.
test('month view screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto('/h/planner?view=month');
  // Let the feeds settle: wait for the grid, then a beat for chips to paint.
  await page.locator('.cal__grid').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: process.env.SHOT_PATH ?? 'month-view.png',
    fullPage: true,
  });
});
