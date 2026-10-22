import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E · facetas del espacio en Ajustes (comms carril 2, fase 4).
 *
 * 1. Las de Hour salen con dónde existen, y «Technical» como nombre nuevo no
 *    se crea: su clave es la de una estándar.
 * 2. `zzz_e2e_facet` («ZZZ E2E facet»): se crea la primera vez con el nivel
 *    bolo y después se reutiliza (no hay DELETE de facetas). Se marca y se
 *    desmarca un nivel con «saved»; se renombra en sitio y vuelve.
 * 3. «What each package gives» enseña Minimal sin facetas y Team con
 *    Technical. Acaba apagada.
 *
 * Fixture: el espacio `playwright`. Nunca toca `muk-cia`.
 */
const KEY = 'zzz_e2e_facet';
const NAME = 'ZZZ E2E facet';
const SETTINGS = '/h/playwright/settings?section=facets';

const section = (page: Page) => page.getByTestId('settings-facets');
const row = (page: Page) => section(page).locator(`.facetset[data-facet="${KEY}"]`);

/** Ajustes no tiene raíz `aria-busy`: se espera a la sección, con una faceta de Hour ya dibujada. */
async function settingsLoaded(page: Page) {
  await expect(section(page).locator('.facetset[data-facet="tecnica"]')).toBeVisible({ timeout: 15_000 });
}

async function setActive(page: Page, on: boolean) {
  const sw = page.getByTestId(`facet-active-${KEY}`);
  if ((await sw.getAttribute('aria-checked')) !== String(on)) {
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', String(on));
  }
}

test.describe('workspace facets in settings', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('Hour’s facets, an own one with its levels, renamed in place, and the packages', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(SETTINGS);
    await settingsLoaded(page);

    try {
      await expect(section(page).locator('.facetset[data-facet="tecnica"] .set-row__hint')).toContainText('deal');

      // 1. A standard key is refused under its field.
      const name = page.locator('#facet-new');
      await name.fill('Technical');
      await section(page).getByRole('button', { name: 'Create' }).click();
      await expect(section(page).getByRole('alert')).toContainText('tecnica');
      await name.fill('');

      // 2. Created once, at the deal, reused after.
      if ((await row(page).count()) === 0) {
        await name.fill(NAME);
        await expect(section(page)).toContainText(`Key: ${KEY}`);
        await section(page).getByRole('button', { name: 'Create' }).click();
        await expect(row(page)).toBeVisible({ timeout: 10_000 });
      }
      await setActive(page, true);
      await expect(row(page).locator('.set-row__hint')).toContainText('deal');

      // A level ticked and unticked, «saved» beside it.
      const line = row(page).getByLabel('line', { exact: true });
      await line.check();
      await expect(row(page).locator('.facetset__levels')).toContainText('saved');
      await expect(row(page).locator('.set-row__hint')).toContainText('line');
      await line.uncheck();
      await expect(row(page).locator('.set-row__hint')).not.toContainText('line');

      // Renamed in place, and back.
      const field = row(page).locator(`input[type="text"]`);
      await field.fill(`${NAME} renamed`);
      await field.press('Enter');
      await expect(row(page)).toContainText('saved');
      await expect(row(page).locator('.set-row__label')).toHaveText(`${NAME} renamed`);
      await field.fill(NAME);
      await field.press('Enter');
      await expect(row(page).locator('.set-row__label')).toHaveText(NAME);

      // 3. The packages, read only.
      const presets = page.getByTestId('settings-facets-presets');
      await expect(presets.locator('[data-preset="minim"]')).toContainText('No facet');
      await expect(presets.locator('[data-preset="equip"]')).toContainText('Technical sees');
      await expect(presets.locator('input')).toHaveCount(0);
    } finally {
      if ((await row(page).count()) > 0) await setActive(page, false);
    }
  });
});
