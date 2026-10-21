/**
 * SETTINGS NEVER SCROLLS SIDEWAYS, FROM A PHONE TO A WIDE SCREEN.
 *
 * From 768 up the rail and the settings nav leave the page a narrow column
 * (about 208px at 768), and the rows' two columns (180 + 280) used to switch
 * to one only below a 768 viewport: at 768 and 900 every `set-row__ctrl`
 * pushed the page sideways. The rows now answer to the page's own width
 * (a container query on `.set-page`).
 *
 * Read-only: it opens each section of the `playwright` space and measures.
 */
import { expect, test, type Page } from '@playwright/test';

const SECTIONS = ['profile', 'workspaces', 'privacy', 'languages', 'lenses', 'mail'] as const;
const WIDTHS = [390, 768, 900, 1024, 1440] as const;

/** Settings declares no `aria-busy`: it has settled when its heading and first block are drawn. */
async function settled(page: Page, section: string) {
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(main.locator('.set-group').first()).toBeVisible();
  // The access ledger is the widest row and arrives with its own request.
  if (section === 'workspaces') await expect(main.locator('.set-access__row').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const width of WIDTHS) {
  test(`settings at ${width}px: no section scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const section of SECTIONS) {
      await page.goto(`/h/playwright/settings?section=${section}`);
      await settled(page, section);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${section} at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}
