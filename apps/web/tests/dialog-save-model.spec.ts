import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * ADR-139 p7 — un diálogo no escribe nada hasta su botón, y lo escrito no se
 * pierde con Esc ni con un clic fuera: el pie pregunta «descartar o seguir».
 * Sin nada escrito, Esc cierra como siempre. El primer foco cae en un campo,
 * no en la pastilla del tipo.
 *
 * Solo lectura: abre «Añadir al plan» en el espacio `playwright` y lo cierra
 * sin guardar. La lógica la fijan `Dialog.svelte.test.ts` y
 * `dialog-guard.svelte.test.ts`; esto fija que el marco real la lleva.
 */
test.describe('the dialog keeps what was written (ADR-139 p7)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('Esc asks with something written, closes with nothing', async ({ page }) => {
    await page.goto('/h/planner?view=month&scope=s:playwright');
    await waitForLoaded(page);
    await page.getByRole('button', { name: /date/i }).first().click();

    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();
    // The caret is in a field, not on the «Performance» pill.
    await expect(dlg.locator('input[type="radio"]:focus')).toHaveCount(0);
    await expect(dlg.locator('input:focus, select:focus')).toHaveCount(1);

    const venue = dlg.getByLabel('Venue');
    await venue.fill('Ensayo con luces');
    await page.keyboard.press('Escape');
    await expect(dlg, 'something written: the dialog stays').toBeVisible();
    await expect(dlg.getByText('There are unsaved changes.')).toBeVisible();

    await dlg.getByRole('button', { name: 'Keep editing' }).click();
    await expect(venue).toHaveValue('Ensayo con luces');

    await page.keyboard.press('Escape');
    await dlg.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // Nothing written: Esc closes without a question.
    await page.getByRole('button', { name: /date/i }).first().click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });
});
