/**
 * CALM AS FOCUS (ADR-139 § 5). Calm is another composition of each lens, not
 * a grey: it hides, it never dims. What it hides is said in one line that
 * opens it; no control looks disabled. The switch is a mark, the wave in a
 * circle, filled when it is on (ADR-202 § 11). `$lib/calm` is the table of what each lens keeps
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

  test('Today in calm: the day, what comes and the pills, without rows (ADR-203 § 5)', async ({ page }) => {
    await open(page, '/h/desk', true);
    const main = page.getByRole('main');
    await expect(page.getByTestId('desk-next').or(page.getByTestId('desk-hollow')).first()).toBeVisible();
    await expect(main.getByRole('heading', { name: /^Coming up/ })).toBeVisible();
    await expect(main.getByRole('heading', { name: /^Waiting for you/ })).toBeVisible();
    // The rows fold, the pills stay; no «See all» either.
    await expect(page.getByTestId('desk-waiting-rows')).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^See all by day/ })).toHaveCount(0);
    // The right column is folded, not greyed: it is not on the page at all.
    await expect(main.getByRole('heading', { name: /^The season/ })).toHaveCount(0);
    await expect(page.getByTestId('desk-changed')).toHaveCount(0);
  });

  test('the piece says the day; the lens title is heard, not seen (ADR-203 § 1)', async ({ page }) => {
    for (const calm of [false, true]) {
      await open(page, '/h/desk', calm);
      const piece = page.getByTestId('desk-next').or(page.getByTestId('desk-hollow')).first();
      await expect(piece).toBeVisible();
      await expect(piece).not.toContainText(/overdue|waiting for you/i);
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toHaveClass(/visually-hidden/);
    }
  });

  test('calm never dims a control, and its mark fills when it is on (ADR-202 § 11)', async ({ page }) => {
    const look = () =>
      page.evaluate(() => {
        const add = document.querySelector('.cal__add')!;
        const sw = [...document.querySelectorAll<HTMLElement>('.calmmark')].find((e) => e.offsetParent !== null)!;
        const ink = getComputedStyle(document.querySelector('.shell__content')!).color;
        return {
          addBg: getComputedStyle(add).backgroundColor,
          addColor: getComputedStyle(add).color,
          ink,
          switchBg: getComputedStyle(sw).backgroundColor,
        };
      });
    // The month draws after the page settles: wait for the act being measured.
    await open(page, '/h/planner?view=month', false);
    await expect(page.locator('.cal__add')).toBeVisible();
    const off = await look();
    await open(page, '/h/planner?view=month', true);
    await expect(page.locator('.cal__add')).toBeVisible();
    const on = await look();
    expect(on.addBg, '«＋ Date» changed its ground in calm').toBe(off.addBg);
    expect(on.addColor).toBe(off.addColor);
    expect(on.ink, 'calm greyed the content').toBe(off.ink);
    expect(off.switchBg, 'off, the mark is an outline').toBe('rgba(0, 0, 0, 0)');
    expect(on.switchBg, 'on, the circle is filled').not.toBe('rgba(0, 0, 0, 0)');
  });

  test('the Planner says what calm hides in one sentence, with the way back', async ({ page }) => {
    await open(page, '/h/planner?view=month', true);
    const meta = page.locator('.cal__meta--window');
    await expect(meta).not.toContainText('calm · confirmed only');
    await expect(meta).toContainText(/confirmed/);
    // The «·» between stats sits on the button's wrapper: not in its name.
    await meta.getByRole('button', { name: /^see all/ }).click();
    await expect(page.getByRole('button', { name: 'Calm', exact: true }).locator('visible=true')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Conversations in calm: «Te toca» and «Add conversation»; the list waits outside', async ({ page }) => {
    await open(page, '/h/conversations', true);
    const main = page.getByRole('main');
    await expect(page.locator('#lista')).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^Add:/ })).toBeEnabled();
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
