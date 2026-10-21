import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E · etiquetas de conversación, fase 4: Ajustes (ADR-138).
 *
 * 1. «Team» como nombre nuevo no se crea: su clave es la de un chip.
 * 2. `zzz_e2e_tag` («ZZZ E2E tag»): se crea la primera vez y después se
 *    reutiliza (no hay DELETE de etiquetas). Encendida, sale en los chips de
 *    Conversaciones sin recargar la página; se renombra en sitio con
 *    «guardado»; se mueve y vuelve a su sitio.
 * 3. Apagada, deja de salir en los chips. Acaba apagada.
 *
 * Fixture: el espacio `playwright`. Nunca toca `muk-cia`.
 */
const KEY = 'zzz_e2e_tag';
const NAME = 'ZZZ E2E tag';
const SETTINGS = '/h/playwright/settings?section=tags';

const row = (page: Page) => page.locator(`[data-testid="settings-tags"] [data-tag="${KEY}"]`);
const toggle = (page: Page) => page.getByTestId(`tag-active-${KEY}`);

async function setActive(page: Page, on: boolean) {
  const sw = toggle(page);
  if ((await sw.getAttribute('aria-checked')) !== String(on)) {
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', String(on));
  }
}

/** To the lens through the frame's selector: a client navigation, no reload. */
async function chipsOfTheLens(page: Page) {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Conversations', exact: true }).click();
  await expect(page).toHaveURL(/\/h\/conversations/);
  await waitForLoaded(page);
  return page.locator('.lenshead__sub [data-chip]');
}

test.describe('conversation tags in settings', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('create (not «Team»), on in the chips without reload, rename, order, off', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(SETTINGS);
    await waitForLoaded(page);
    const section = page.getByTestId('settings-tags');
    await expect(section.locator('[data-tag="sales"]')).toBeVisible();

    try {
      // 1. A reserved key is refused under its field, and nothing is created.
      const name = page.locator('#tag-new');
      await name.fill('Team');
      await page.getByRole('button', { name: 'Create' }).click();
      await expect(section.getByRole('alert')).toContainText('team');
      await expect(section.locator('[data-tag="team"]')).toHaveCount(0);

      // 2. Created once, reused after.
      if ((await row(page).count()) === 0) {
        await name.fill(NAME);
        await expect(section).toContainText(`Key: ${KEY}`);
        await page.getByRole('button', { name: 'Create' }).click();
        await expect(row(page)).toBeVisible({ timeout: 10_000 });
      } else {
        await name.fill('');
        // Its key is taken now: the same name is refused before it is sent.
        await name.fill(NAME);
        await page.getByRole('button', { name: 'Create' }).click();
        await expect(section.getByRole('alert')).toContainText(KEY);
        await name.fill('');
      }
      await setActive(page, true);

      // On: a chip of the lens, without reloading the page.
      const chips = await chipsOfTheLens(page);
      await expect(page.locator(`.lenshead__sub [data-chip="${KEY}"]`)).toBeVisible();
      await expect(chips.last()).toHaveAttribute('data-chip', 'team');
      await page.goBack();
      await waitForLoaded(page);

      // Renamed in place, «saved» in its row; and back.
      const input = row(page).locator('input[type="text"]');
      await input.fill(`${NAME} renamed`);
      await input.press('Enter');
      await expect(row(page)).toContainText('saved');
      await expect(row(page).locator('.set-row__label')).toHaveText(`${NAME} renamed`);
      await input.fill(NAME);
      await input.press('Enter');
      await expect(row(page).locator('.set-row__label')).toHaveText(NAME);

      // Up one place and down again.
      const keys = () => section.locator('[data-tag]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tag')));
      const before = await keys();
      const at = before.indexOf(KEY);
      if (at > 0) {
        await row(page).getByRole('button', { name: `Move ${NAME} up` }).click();
        await expect.poll(keys).toEqual([...before.slice(0, at - 1), KEY, before[at - 1], ...before.slice(at + 1)]);
        await row(page).getByRole('button', { name: `Move ${NAME} down` }).click();
        await expect.poll(keys).toEqual(before);
      }

      // 3. Off: out of the chips.
      await setActive(page, false);
      await chipsOfTheLens(page);
      await expect(page.locator('.lenshead__sub [data-chip="sales"]')).toBeVisible();
      await expect(page.locator(`.lenshead__sub [data-chip="${KEY}"]`)).toHaveCount(0);
    } finally {
      // Whatever happened, it ends off and with its name.
      await page.goto(SETTINGS);
      await waitForLoaded(page);
      if ((await row(page).count()) > 0) {
        const input = row(page).locator('input[type="text"]');
        if ((await input.inputValue()) !== NAME) {
          await input.fill(NAME);
          await input.press('Enter');
        }
        await setActive(page, false);
      }
    }
  });
});
