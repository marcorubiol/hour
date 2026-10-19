/**
 * AYUDA CONTEXTUAL, ENFOQUE A: la tarjeta de bienvenida sale una vez, el «?»
 * la vuelve a abrir, «Enséñame» recorre sus pasos y la «i» abre y cierra con
 * teclado.
 *
 * Runs in the `playwright` workspace (`?scope=s:playwright`), never muk-cia.
 * What it writes is the fixture login's own `help_seen` row: it empties it at
 * the start and leaves every card and note seen at the end, as the auth setup
 * left it. Red against an origin without 20261020150000_help_seen.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { HELP_SEEN } from './help-seen';

const EMAIL = process.env.PW_TEST_EMAIL ?? '';
const PASSWORD = process.env.PW_TEST_PASSWORD ?? '';
const DESK = '/h/desk?scope=s:playwright';
const PLANNER = '/h/planner?scope=s:playwright';

async function resetHelp(page: Page) {
  const status = await page.evaluate(async () => (await fetch('/api/me/help', { method: 'DELETE' })).status);
  expect(status, 'help_seen exists on this origin').toBe(200);
}

async function seeAll(page: Page) {
  await page.evaluate(async (keys) => {
    for (const key of keys) {
      await fetch('/api/me/help', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
    }
  }, HELP_SEEN);
}

const card = (page: Page, section: string) =>
  page.locator(`[data-testid="first-visit-card"][data-section="${section}"]`);

test.describe.configure({ mode: 'serial' });

test.describe('Contextual help (approach A)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(DESK);
    await seeAll(page);
    await page.close();
  });

  test('the welcome card shows once', async ({ page }) => {
    await page.goto(DESK);
    await resetHelp(page);
    await page.reload();
    await waitForLoaded(page);

    const desk = card(page, 'desk');
    await expect(desk).toBeVisible();
    await expect(desk.getByRole('heading', { name: 'Today' })).toBeVisible();
    await desk.getByRole('button', { name: 'Got it' }).click();
    await expect(desk).toHaveCount(0);

    await page.reload();
    await waitForLoaded(page);
    // Settled: the dashboard is drawn and the card did not come back.
    await expect(page.getByRole('main').getByRole('heading', { name: /^Waiting for you/ })).toBeVisible();
    await expect(desk).toHaveCount(0);
  });

  test('the «?» brings it back, and «Got it» closes it again', async ({ page }) => {
    await page.goto(DESK);
    await waitForLoaded(page);
    const desk = card(page, 'desk');
    await expect(desk).toHaveCount(0);

    const ask = page.getByRole('button', { name: 'About this section' });
    await ask.click();
    await expect(desk).toBeVisible();
    await expect(ask).toHaveAttribute('aria-expanded', 'true');
    await expect(desk.getByRole('heading', { name: 'Today' })).toBeFocused();

    await desk.getByRole('button', { name: 'Got it' }).click();
    await expect(desk).toHaveCount(0);
    await expect(ask).toBeFocused();
  });

  test('«Show me» walks the Planner’s steps and then the card is seen', async ({ page }) => {
    await page.goto(PLANNER);
    await waitForLoaded(page);
    const planner = card(page, 'planner');
    await expect(planner).toBeVisible();

    await planner.getByRole('button', { name: 'Show me' }).click();
    const tour = page.getByRole('dialog');
    await expect(tour).toContainText(/^1\/\d/);
    await expect(page.locator('[data-help-focus]').first()).toBeVisible();
    for (let i = 0; i < 3; i++) {
      const next = tour.getByRole('button', { name: /^(Next|Done)$/ });
      if ((await next.count()) === 0) break;
      await next.click();
    }
    await expect(tour).toHaveCount(0);
    await expect(page.locator('[data-help-focus]')).toHaveCount(0);

    await page.reload();
    await waitForLoaded(page);
    await expect(planner).toHaveCount(0);
  });

  test('a concept’s «i» opens and closes with the keyboard', async ({ page }) => {
    await page.goto(DESK);
    await waitForLoaded(page);

    const hint = page.getByRole('button', { name: 'What is Waiting for you' });
    const panel = page.locator(`#${await hint.getAttribute('popovertarget')}`);
    await expect(hint).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    await hint.focus();
    await page.keyboard.press('Enter');
    await expect(hint).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('14 days');

    await page.keyboard.press('Escape');
    await expect(hint).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await expect(hint).toBeFocused();

    // Space opens it too, and a second press closes it: a toggle, like a tap.
    await page.keyboard.press('Space');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Space');
    await expect(panel).toBeHidden();
  });
});
