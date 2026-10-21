import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * La línea del alta rápida entiende texto (ADR-139 § 3, `lib/quick-line.ts`):
 * «rehearsal thu 10-14 Mercat» llena las fichas mientras se escribe, marca
 * lo reconocido en el título sin mover el foco, y lo que se fija a mano en
 * una ficha manda sobre lo que el texto dice después. Y el título que llega
 * desde ⌘K se lee igual.
 *
 * Solo lectura: abre «Añadir al plan» en el espacio `playwright` y lo cierra
 * descartando el borrador; nunca pulsa «Add».
 */
test.describe('the quick add reads text (ADR-139 § 3)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('typing fills the chips; a chip fixed by hand wins', async ({ page }) => {
    await page.goto('/h/planner?view=month&scope=s:playwright');
    await waitForLoaded(page);
    await page.getByRole('button', { name: /date/i }).first().click();

    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();
    const title = dlg.locator('.qa__title');
    await expect(title).toBeFocused();
    await title.pressSequentially('rehearsal thu 10-14 Mercat');

    await expect(dlg.locator('[data-chip="type"]')).toContainText('Rehearsal');
    await expect(dlg.locator('[data-chip="when"]')).toContainText('Thu');
    await expect(dlg.locator('[data-chip="when"]')).toContainText(/10.*14/);
    await expect(dlg.locator('[data-chip="where"]')).toContainText('Mercat');
    // Recognised, marked under the letters; the caret never left the line.
    await expect(dlg.locator('.qa__said [data-mark]')).toHaveCount(4);
    await expect(title).toBeFocused();
    // Said to a screen reader once the typing settles.
    await expect(dlg.locator('[aria-live="polite"]')).toContainText('Rehearsal');

    // The day fixed by hand: the text does not move it any more.
    await dlg.locator('[data-chip="when"]').click();
    const day = dlg.getByLabel('Day', { exact: true });
    await day.fill('2031-03-03');
    await day.dispatchEvent('change');
    await title.click();
    await title.press('End');
    await title.pressSequentially(' fri');
    await expect(dlg.locator('[data-chip="when"]')).toContainText('3 Mar');

    await dlg.getByRole('button', { name: 'Discard draft' }).click();
    await expect(title).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });

  test('⌘K → New rehearsal: the rest of the line is read too', async ({ page }) => {
    await page.goto('/h/desk?scope=s:playwright');
    await waitForLoaded(page);

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Build a scope' });
    await expect(palette).toBeVisible();
    await palette.getByRole('textbox').fill('rehearsal thu 10-14 Mercat');
    await palette.getByRole('option', { name: /New rehearsal/ }).click();
    await expect(palette).toBeHidden();

    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('What', { exact: true })).toHaveValue('thu 10-14 Mercat');
    await expect(dlg.locator('[data-chip="type"]')).toContainText('Rehearsal');
    await expect(dlg.locator('[data-chip="when"]')).toContainText('Thu');
    await expect(dlg.locator('[data-chip="where"]')).toContainText('Mercat');

    await dlg.getByRole('button', { name: 'Discard draft' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });
});
