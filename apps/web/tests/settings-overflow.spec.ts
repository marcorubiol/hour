/**
 * SETTINGS NEVER SCROLLS SIDEWAYS, FROM A PHONE TO A WIDE SCREEN.
 *
 * From 768 up the rail and the settings nav used to leave the page a narrow
 * column (about 208px at 768), and every `set-row__ctrl` pushed the page
 * sideways. The rows answer to the page's own width (a container query on
 * `.set-page`), and under 1024 the settings nav is a dropdown at the top of
 * the page (`Sección`), so the page gets its width back there.
 *
 * Read-only: it opens each section of the `playwright` space and measures;
 * the dropdown test only changes the URL.
 */
import { expect, test, type Page } from '@playwright/test';

const SECTIONS = ['profile', 'workspaces', 'privacy', 'languages', 'lenses', 'mail'] as const;
const WIDTHS = [390, 768, 900, 1024, 1440] as const;
/** Under this width the sections are a dropdown, at or above it a nav column. */
const NAV_FROM = 1024;

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

  test(`settings at ${width}px: one way to the sections`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/h/playwright/settings?section=profile');
    await settled(page, 'profile');
    const nav = page.getByRole('navigation', { name: /settings sections|secciones de ajustes|seccions dels ajustos|sections des paramètres/i });
    const picker = page.getByRole('main').getByRole('combobox', { name: /^(section|sección|secció)$/i });

    if (width >= NAV_FROM) {
      await expect(nav).toBeVisible();
      await expect(picker).toBeHidden();
      return;
    }
    await expect(nav).toBeHidden();
    await expect(picker).toHaveValue('profile');
    await picker.selectOption('privacy');
    await expect(page).toHaveURL(/[?&]section=privacy\b/);
    await expect(picker).toHaveValue('privacy');
  });
}
