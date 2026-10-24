/**
 * CALM AS FOCUS (ADR-139 § 5). Calm is another composition of each lens, not
 * a grey: it hides, it never dims. What it hides is said in one line that
 * opens it; no control looks disabled; the switch is a soft stroke, never the
 * darkest mark on the rail. `$lib/calm` is the table of what each lens keeps
 * (unit-tested there); these are the laws you can only see in a browser.
 *
 * Read-only: the spec writes nothing but the browser's own `hour_calm`.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL ?? '';
const PASSWORD = process.env.PW_TEST_PASSWORD ?? '';
const SCOPE = 's:playwright';

async function open(page: Page, path: string, calm: boolean) {
  await page.addInitScript((c) => localStorage.setItem('hour_calm', c ? '1' : '0'), calm);
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}scope=${SCOPE}`);
  await waitForLoaded(page);
}

test.describe('Calm — a composition, not a grey (ADR-139 § 5)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('Today in calm: one column, today only, the rest in one line that leaves calm', async ({ page }) => {
    await open(page, '/h/desk', true);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: /^Next up/ })).toBeVisible();
    await expect(main.getByRole('heading', { name: /^Waiting for you/ })).toBeVisible();
    // The right column is folded, not greyed: it is not on the page at all.
    await expect(main.getByRole('heading', { name: /^The season/ })).toHaveCount(0);
    await expect(page.getByTestId('desk-changed')).toHaveCount(0);
    // «Ver todo por días» is not offered in calm; the line says what waits.
    await expect(main.getByText(/wait outside calm/)).toBeVisible();
    await main.getByRole('button', { name: /^see all/ }).last().click();
    await expect(main.getByRole('heading', { name: /^The season/ })).toBeVisible();
    await expect(page.locator('.side-calm')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the title says the day, never the debt, in both modes', async ({ page }) => {
    for (const calm of [false, true]) {
      await open(page, '/h/desk', calm);
      // The greeting opens the title line (ADR-145, fase 2); the day is its own part.
      const title = (await page.locator('.lenshead__title .desk__day').first().innerText()).trim();
      expect(title, 'the title counts what is overdue').not.toMatch(/overdue|waiting for you|wait for you/i);
      expect(title).toMatch(/^(Today|Nothing on the plan today)/);
    }
  });

  test('the overdue is counted once, in red, and opens in place', async ({ page }) => {
    await open(page, '/h/desk', true);
    const line = page.getByRole('main').locator('.calm-line', { hasText: /overdue/ });
    if ((await line.count()) === 0) test.skip(true, 'nothing overdue in the fixture today');
    const toggle = line.getByRole('button');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#desk-calm-overdue li').first()).toBeVisible();
  });

  test('calm never dims a control, and its switch is a stroke, not a black pill', async ({ page }) => {
    const look = () =>
      page.evaluate(() => {
        const add = document.querySelector('.cal__add')!;
        const sw = document.querySelector('.side-calm')!;
        const ink = getComputedStyle(document.querySelector('.shell__content')!).color;
        return {
          addBg: getComputedStyle(add).backgroundColor,
          addColor: getComputedStyle(add).color,
          ink,
          switchBg: getComputedStyle(sw).backgroundColor,
        };
      });
    await open(page, '/h/planner?view=month', false);
    const off = await look();
    await open(page, '/h/planner?view=month', true);
    const on = await look();
    expect(on.addBg, '«＋ Date» changed its ground in calm').toBe(off.addBg);
    expect(on.addColor).toBe(off.addColor);
    expect(on.ink, 'calm greyed the content').toBe(off.ink);
    expect(on.switchBg, 'the switch is painted in the ink').not.toBe(on.ink);
  });

  test('the Planner says what calm hides in one sentence, with the way back', async ({ page }) => {
    await open(page, '/h/planner?view=month', true);
    const meta = page.locator('.cal__meta--window');
    await expect(meta).not.toContainText('calm · confirmed only');
    await expect(meta).toContainText(/confirmed/);
    // The «·» between stats sits on the button's wrapper: not in its name.
    await meta.getByRole('button', { name: /^see all/ }).click();
    await expect(page.locator('.side-calm')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Conversations in calm: «Te toca» and «Add conversation»; the list waits outside', async ({ page }) => {
    await open(page, '/h/conversations', true);
    const main = page.getByRole('main');
    await expect(page.locator('#lista')).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Add conversation' })).toBeEnabled();
    await expect(main.getByText(/wait outside calm/)).toBeVisible();
  });

  test('Books in calm: one figure, what needs attention; the book waits outside', async ({ page }) => {
    await open(page, '/h/books', true);
    if ((await page.getByTestId('money-no-access').count()) > 0) test.skip(true, 'no read:money for the fixture');
    await expect(page.locator('#mny-ledger')).toHaveCount(0);
    await expect(page.locator('.fig[data-fig="owed"]')).toHaveCount(0);
    await expect(page.getByRole('main').getByText(/wait outside calm/)).toBeVisible();
  });

  test('switching calm is heard, not only seen', async ({ page }) => {
    await open(page, '/h/desk', false);
    // El de calma, no el del alta rápida (⌘K), que también vive en la página.
    const announce = page.locator('[aria-live="polite"].visually-hidden').filter({ hasText: /^Calm (on|off)/ });
    await page.locator('body').press('c');
    await expect(announce).toHaveText(/^Calm on/);
    await page.locator('body').press('c');
    await expect(announce).toHaveText(/^Calm off/);
  });
});
