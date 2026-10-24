import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — Difusión on a phone (density review § 3 and § 4), READ ONLY: every
 * write to `/api/` is refused before it leaves the browser. The filters live
 * in the URL, so changing one writes nothing.
 *
 *   - on a phone the four selects fold into «Filter», a modal sheet with the
 *     same fields: focus inside, Esc closes and gives the focus back, the
 *     button says how many are on, and each one on is a chip that takes it off;
 *   - a conversation is a two-line row, and a tap on it opens it;
 *   - on a wide screen the selects stay in the row and there is no sheet.
 *
 * Fixture: the `playwright` space. What exists there varies, so a missing
 * row skips rather than fails.
 */

const LIST = '/h/conversations?etiqueta=sales&scope=s:playwright';

async function readOnly(page: Page) {
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    return route.abort();
  });
}

test.describe('Difusión on a phone', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('the filters are a sheet behind «Filter», and what is on is a chip', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await readOnly(page);
    await page.goto(LIST);
    await waitForLoaded(page);

    const main = page.getByRole('main');
    const open = main.getByRole('button', { name: /^Filter/ });
    await expect(open).toBeVisible();
    await expect(main.getByLabel('Relation', { exact: true })).toBeHidden();

    await open.click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await expect(sheet).toBeVisible();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    // The first field takes the focus; the page behind is out of reach (a modal dialog).
    await expect(sheet.getByLabel('Relation', { exact: true })).toBeFocused();

    await sheet.getByLabel('Relation', { exact: true }).selectOption('talking');
    await expect(page).toHaveURL(/relacion=talking/);
    await expect(sheet).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(open).toBeFocused();
    await expect(open).toHaveAccessibleName('Filter, 1 on');

    await main.getByRole('button', { name: /^Remove «/ }).click();
    await expect(page).not.toHaveURL(/relacion=/);
    await expect(open).toHaveAccessibleName('Filter');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('a conversation is two lines, and a tap opens it', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await readOnly(page);
    await page.goto(LIST);
    await waitForLoaded(page);

    const rows = page.locator('main [data-testid="conversation-row"]');
    if ((await rows.count()) === 0) test.skip(true, 'no conversation in the fixture space');
    const row = rows.first();
    const box = (await row.boundingBox())!;
    // About 70 px (it was about 170): the title's line and one line under it.
    expect(box.height).toBeLessThan(90);

    // The second line is read, not tapped: a tap there reaches the row's link.
    await row.scrollIntoViewIfNeeded();
    const at = (await row.boundingBox())!;
    await page.mouse.click(at.x + 40, at.y + at.height - 8);
    await expect(page.getByTestId('peek')).toBeVisible({ timeout: 15_000 });
  });

  test('on a wide screen the filters stay in the row', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await readOnly(page);
    await page.goto(LIST);
    await waitForLoaded(page);

    const main = page.getByRole('main');
    await expect(main.getByLabel('Relation', { exact: true })).toBeVisible();
    await expect(main.getByLabel('Order', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: /^Filter/ })).toBeHidden();
  });
});
