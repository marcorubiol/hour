import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * THE TAB SAYS WHERE YOU ARE (ADR-130 § 5). The Hall set no title, so after a
 * login the tab kept «Hour — Sign in» with the session open (Drop, validated
 * by Marco 2026-10-18). Every screen sets «<screen> · Hour»; the Hall, «Hour».
 * The words follow the viewer's language, so the spec reads the shape.
 */
test.describe('document title', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL and PW_TEST_PASSWORD.');

  test('the Hall is «Hour» and each dashboard names itself, also by client navigation', async ({ page }) => {
    await page.goto('/h');
    await expect(page).toHaveTitle('Hour');

    for (const path of ['/h/desk', '/h/planner', '/h/conversations', '/h/books']) {
      await page.goto(path);
      await expect(page).toHaveTitle(/^[^·—]+ · Hour$/);
    }

    // Client-side: the lens switcher is a nav of links; each hop retitles.
    await page.goto('/h/desk');
    await expect(page).toHaveTitle(/^Desk · Hour$/);
    const lenses = page.getByRole('navigation', { name: /sections|secciones|seccions/i }).getByRole('link');
    const hrefs = await lenses.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
    let previous = await page.title();
    for (const href of hrefs.filter((h) => !h.endsWith('/desk'))) {
      await lenses.and(page.locator(`[href="${href}"]`)).click();
      await page.waitForURL((u) => u.pathname === href);
      await expect(page).not.toHaveTitle(previous);
      await expect(page).toHaveTitle(/^[^·—]+ · Hour$/);
      previous = await page.title();
    }
  });
});
