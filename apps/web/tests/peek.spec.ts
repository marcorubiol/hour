import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — the vistazo (ADR-139 p1 A), READ ONLY: every POST, PATCH, PUT and
 * DELETE to `/api/` is refused before it leaves the browser, so this file can
 * run against production and change nothing. It pins the frame, not a record:
 *
 *   - a link from a lens opens the record in the panel, and the lens stays
 *     (same path, its own query intact);
 *   - the address says what is open, so a reload (a shared link) opens it;
 *   - Esc closes it and Back after that opens it again;
 *   - «Open in full» lands on the page;
 *   - a date, which has no page, opens in the panel too.
 *
 * Conversations is the exception since ADR-176: at ≥ 75rem a row opens its
 * conversation in the pane beside the list (`?abierta=`), narrower its page;
 * never the vistazo. The frame is pinned here with a performance from the
 * Planner, and the lens's own two panes beside it.
 *
 * Fixture: the `playwright` space (never `muk-cia`). What exists there varies,
 * so a missing row skips rather than fails.
 */

async function readOnly(page: Page) {
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    return route.abort();
  });
}

test.describe('the vistazo (ADR-139 p1)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('a performance opens over the lens, by address, and closes back to it', async ({ page }) => {
    test.setTimeout(60_000);
    await readOnly(page);
    await page.goto('/h/planner?view=agenda&scope=s:playwright');
    await waitForLoaded(page);
    const link = page.locator('main a[href*="/performance/"]').first();
    if ((await link.count()) === 0) test.skip(true, 'no performance ahead in the fixture space');
    await link.click();

    const peek = page.getByTestId('peek');
    await expect(peek).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog', { name: /performance/i })).toBeVisible();
    await expect(peek.locator('h1')).toBeVisible({ timeout: 15_000 });
    // The lens is still there, under it, with its own query.
    await expect(page).toHaveURL(/\/h\/planner\?.*scope=s(%3A|:)playwright.*peek=performance/);

    // A reload is a shared link: it opens the same thing.
    await page.reload();
    await expect(page.getByTestId('peek')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('peek').locator('h1')).toBeVisible({ timeout: 15_000 });

    // Esc closes, and the address forgets it.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('peek')).toBeHidden();
    await expect(page).not.toHaveURL(/peek=/);
    await expect(page).toHaveURL(/\/h\/planner/);
  });

  test('Back after closing opens it again, and «Open in full» goes to the page', async ({ page }) => {
    test.setTimeout(60_000);
    await readOnly(page);
    await page.goto('/h/planner?view=agenda&scope=s:playwright');
    await waitForLoaded(page);
    const link = page.locator('main a[href*="/performance/"]').first();
    if ((await link.count()) === 0) test.skip(true, 'no performance ahead in the fixture space');
    await link.click();
    await expect(page.getByTestId('peek')).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('peek')).toBeHidden();
    await page.goForward();
    await expect(page.getByTestId('peek')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('peek-full').click();
    await page.waitForURL(/\/h\/[^/]+\/performance\/[^/?#]+$/);
    await expect(page.getByTestId('peek')).toBeHidden();
    await waitForLoaded(page);
    await expect(page.locator('main h1')).toBeVisible();
  });

  test('Conversations at desktop width: the row opens beside the list, by address, never the vistazo', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await readOnly(page);
    await page.goto('/h/conversations?etiqueta=sales&scope=s:playwright');
    await waitForLoaded(page);
    const link = page.locator('main [data-testid="conversation-row"]').first().locator('a.chat__title');
    if ((await link.count()) === 0) test.skip(true, 'no conversation in the fixture space');
    await link.click();

    const pane = page.getByTestId('conversation-pane');
    await expect(pane.locator('h1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('peek')).toBeHidden();
    // The lens keeps its query; the address says which one is open.
    await expect(page).toHaveURL(/\/h\/conversations\?.*scope=s(%3A|:)playwright.*abierta=playwright(%2F|\/)/);
    await expect(link).toHaveAttribute('aria-current', 'true');

    // A reload is a shared link: the same one opens beside the list.
    await page.reload();
    await expect(page.getByTestId('conversation-pane').locator('h1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('peek')).toBeHidden();

    // The keyboard (ADR-176): «Close» empties the pane; Enter on a row opens it
    // with the focus inside; Esc closes it and gives the focus back to the row.
    await page.getByTestId('conversation-pane').getByRole('button', { name: 'Close' }).click();
    await expect(page).not.toHaveURL(/abierta=/);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/abierta=/);
    await expect(page.getByTestId('conversation-pane')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/abierta=/);
    await expect(link).toBeFocused();
  });

  test('Conversations narrower than 75rem: the row opens the conversation page', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1024, height: 800 });
    await readOnly(page);
    await page.goto('/h/conversations?etiqueta=sales&scope=s:playwright');
    await waitForLoaded(page);
    await expect(page.getByTestId('conversation-pane')).toHaveCount(0);
    const link = page.locator('main [data-testid="conversation-row"]').first().locator('a.chat__title');
    if ((await link.count()) === 0) test.skip(true, 'no conversation in the fixture space');
    await expect(link).toHaveAttribute('data-peek', 'off');
    await link.click();
    await page.waitForURL(/\/h\/[^/]+\/conversation\/[^/?#]+$/);
    await expect(page.getByTestId('peek')).toBeHidden();
    await waitForLoaded(page);
    await expect(page.locator('main h1')).toBeVisible();
  });

  test('a date has no page, and opens in the panel from the Planner', async ({ page }) => {
    test.setTimeout(60_000);
    await readOnly(page);
    await page.goto('/h/planner?view=agenda&scope=s:playwright');
    await waitForLoaded(page);
    // A date slip is a button (no page of its own); a performance is a link.
    const slip = page.locator('main button.slip').first();
    if ((await slip.count()) === 0) test.skip(true, 'no date ahead in the fixture space');
    await slip.click();

    const peek = page.getByTestId('peek');
    await expect(peek).toBeVisible({ timeout: 15_000 });
    await expect(peek.getByTestId('date-record')).toBeVisible();
    await expect(peek.getByRole('button', { name: 'Edit', exact: true })).toBeVisible({ timeout: 15_000 });
    // No page, so no «Open in full».
    await expect(peek.getByTestId('peek-full')).toHaveCount(0);
    await expect(page).toHaveURL(/peek=date%2F[0-9a-f-]{36}/);

    // A click on the veil closes it, like Esc.
    await page.mouse.click(5, 300);
    await expect(peek).toBeHidden();
    await expect(page).toHaveURL(/view=agenda/);
  });

  test('on a phone the panel is the whole screen', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await readOnly(page);
    // From the Planner: a conversation row never peeks (ADR-176), a performance does.
    await page.goto('/h/planner?view=agenda&scope=s:playwright');
    await waitForLoaded(page);
    const link = page.locator('main a[href*="/performance/"]').first();
    if ((await link.count()) === 0) test.skip(true, 'no performance ahead in the fixture space');
    await link.click();
    const peek = page.getByTestId('peek');
    await expect(peek).toBeVisible({ timeout: 15_000 });
    const box = await peek.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(389);
  });
});
