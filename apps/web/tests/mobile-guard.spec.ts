/**
 * THE PHONE GUARD (ADR-248). Marco uses Hour every day on an iPhone, and the
 * small things that went wrong there (Safari zooming into the login, a
 * «Close» that read as «closed», a strip cut by the screen's edge, pills,
 * a day that opened something else) came back after each fix because no
 * test looked at a phone. This one does, at 390 px with a touch screen, and
 * only reads: it writes nothing.
 *
 * Runs against a deployed origin, like the rest of the suite.
 */
import { devices, expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL ?? '';
const PASSWORD = process.env.PW_TEST_PASSWORD ?? '';
const SCOPE = 'scope=s:playwright';
const LENSES = ['/h/today', '/h/planner', '/h/conversations', '/h/books'];

/** What is wrong with the page on a phone, in words (empty = nothing). */
async function phoneFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    if (document.documentElement.scrollWidth > vw + 1) {
      out.push(`the page is ${document.documentElement.scrollWidth}px wide on a ${vw}px screen`);
    }
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), textarea, select')) {
      if (!visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) out.push(`a field at ${fs}px (Safari zooms under 16): ${el.outerHTML.slice(0, 80)}`);
    }
    for (const el of document.querySelectorAll('[class*="chip--"]')) {
      if (!visible(el)) continue;
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      if (r > 8) out.push(`a pill (radius ${r}px): ${(el.textContent ?? '').trim().slice(0, 40)}`);
    }
    for (const el of document.querySelectorAll('main button, main a')) {
      if (!visible(el)) continue;
      const text = (el.textContent ?? '').trim();
      if (/^(Close|Cerrar|Tanca|Fermer)$/.test(text)) out.push(`a «${text}» on the page`);
    }
    return out;
  });
}

test.describe('The phone (ADR-248)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const lens of LENSES) {
    test(`${lens} fits a phone: no field under 16 px, no pill, no «Close», nothing past the edge`, async ({ page }) => {
      await page.goto(`${lens}?${SCOPE}`);
      await waitForLoaded(page);
      expect(await phoneFaults(page)).toEqual([]);
    });
  }

  test('a day of «Coming up» opens the Day, with one thing or several', async ({ page }) => {
    await page.goto(`/h/today?${SCOPE}`);
    await waitForLoaded(page);
    const tiles = page.locator('[data-testid="desk-tile"][href]');
    if ((await tiles.count()) === 0) return;
    await expect(tiles.first()).toHaveAttribute('href', /^\/h\/planner\?view=day&d=\d{4}-\d{2}-\d{2}$/);
  });

  test('the Day says «‹ Back», not ×', async ({ page }) => {
    await page.goto(`/h/planner?view=day&${SCOPE}`);
    await waitForLoaded(page);
    await expect(page.getByTestId('day-back')).toBeVisible();
    expect(await phoneFaults(page)).toEqual([]);
  });
});

// An iPhone's screen and user agent, in this project's browser (a describe
// cannot switch the browser type).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType: _browser, ...IPHONE } = devices['iPhone 13'];

test.describe('The login on an iPhone (ADR-248)', () => {
  test.use({ ...IPHONE, storageState: { cookies: [], origins: [] } });

  test('fields at 16 px and no zoom on focus', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    expect(await phoneFaults(page)).toEqual([]);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /maximum-scale=1/);
  });
});
