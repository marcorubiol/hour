import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — Difusión on a phone (density review § 3 and § 4), READ ONLY: every
 * write to `/api/` is refused before it leaves the browser. The filters live
 * in the URL, so changing one writes nothing.
 *
 *   - «Filter» is a modal sheet with the fields (since ADR-176 at every
 *     width, the tag among them): focus inside, Esc closes and gives the
 *     focus back, the button says how many are on, and each one on is a chip
 *     that takes it off;
 *   - a conversation is a short chat row (ChatRow, three lines), and a tap on
 *     it opens its page (on a phone there is no pane beside the list);
 *   - on a wide screen the selects are not in the row either: the same sheet.
 *
 * Fixture: the `playwright` space. What exists there varies, so a missing
 * row skips rather than fails.
 */

const LIST = '/h/conversations?etiqueta=sales&scope=s:playwright';
// Without a tag: since ADR-176 the tag is one of the sheet's filters, so `etiqueta=sales` is already «1 on».
const PLAIN = '/h/conversations?scope=s:playwright';

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
    await page.goto(PLAIN);
    await waitForLoaded(page);

    const main = page.getByRole('main');
    const open = main.locator('button.conversations__filter-open');
    await expect(open).toBeVisible();
    await expect(open).toHaveAccessibleName('Filter');
    await expect(main.getByLabel('Relation', { exact: true })).toBeHidden();

    await open.click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await expect(sheet).toBeVisible();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    // The first field (the Tag, with two tags or more; else the Relation) takes the focus;
    // the page behind is out of reach (a modal dialog).
    await expect(sheet.locator('select').first()).toBeFocused();

    await sheet.getByLabel('Relation', { exact: true }).selectOption('talking');
    await expect(page).toHaveURL(/relacion=talking/);
    await expect(sheet).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(open).toBeFocused();
    await expect(open).toHaveAccessibleName('Filter, 1 on');

    await main.locator('.conversations__active').getByRole('button', { name: /^Remove «/ }).click();
    await expect(page).not.toHaveURL(/relacion=/);
    await expect(open).toHaveAccessibleName('Filter');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('a conversation is a short chat row, and a tap opens its page', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await readOnly(page);
    await page.goto(LIST);
    await waitForLoaded(page);

    const rows = page.locator('main [data-testid="conversation-row"]');
    if ((await rows.count()) === 0) test.skip(true, 'no conversation in the fixture space');
    const row = rows.first();
    const box = (await row.boundingBox())!;
    // Three short lines (ChatRow, ADR-176): who and when, the last word, the context.
    // The bound is loose on purpose: it was about 170 px before the density review.
    expect(box.height).toBeLessThan(110);

    // The lower lines are read, not tapped: a tap there reaches the row's link.
    // On a phone it opens the conversation's page (no pane, no vistazo).
    await row.scrollIntoViewIfNeeded();
    const at = (await row.boundingBox())!;
    await page.mouse.click(at.x + 40, at.y + at.height - 8);
    await page.waitForURL(/\/h\/[^/]+\/conversation\/[^/?#]+$/, { timeout: 15_000 });
    await expect(page.getByTestId('peek')).toBeHidden();
  });

  test('on a wide screen the filters are the same sheet (ADR-176)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await readOnly(page);
    await page.goto(LIST);
    await waitForLoaded(page);

    const main = page.getByRole('main');
    await expect(main.getByLabel('Relation', { exact: true })).toBeHidden();
    await expect(main.getByLabel('Order', { exact: true })).toBeHidden();
    const open = main.locator('button.conversations__filter-open');
    // The tag of the address is one filter on.
    await expect(open).toHaveAccessibleName('Filter, 1 on');
    await open.click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await expect(sheet.getByLabel('Tag', { exact: true })).toHaveValue('sales');
    await expect(sheet.getByLabel('Relation', { exact: true })).toBeVisible();
    await expect(sheet.getByLabel('Order', { exact: true })).toBeVisible();
  });
});
