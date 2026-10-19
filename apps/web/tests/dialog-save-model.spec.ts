import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * ADR-139 p7 — un diálogo no escribe nada hasta su botón, y lo escrito no se
 * pierde con Esc ni con un clic fuera. «Añadir al plan» lo hace guardando un
 * borrador (p3, «aquí sí»): cerrar no pregunta, porque no tira nada; al
 * reabrir, lo escrito vuelve con «Descartar borrador» a la vista. El primer
 * foco cae en el título, no en la ficha del tipo.
 *
 * El otro camino del marco (preguntar «descartar o seguir» en un diálogo sin
 * borrador) lo fija `Dialog.svelte.test.ts`.
 *
 * Solo lectura: abre «Añadir al plan» en el espacio `playwright` y lo cierra
 * sin guardar.
 */
test.describe('the quick add keeps what was written (ADR-139 p3, p7)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('Esc keeps a draft that comes back; «Discard draft» empties it', async ({ page }) => {
    await page.goto('/h/planner?view=month&scope=s:playwright');
    await waitForLoaded(page);
    await page.getByRole('button', { name: /date/i }).first().click();

    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();
    const title = dlg.locator('.qa__title');
    // The caret is in the title, not on a chip or a type radio.
    await expect(title).toBeFocused();
    await expect(dlg.locator('input[type="radio"]:focus')).toHaveCount(0);

    await title.fill('Ensayo con luces');
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]'), 'closing asks nothing: nothing is lost').toHaveCount(0);

    await page.getByRole('button', { name: /date/i }).first().click();
    await expect(dlg.locator('.qa__title'), 'the draft comes back').toHaveValue('Ensayo con luces');
    await dlg.getByRole('button', { name: 'Discard draft' }).click();
    await expect(dlg.locator('.qa__title')).toHaveValue('');
    await expect(dlg.getByRole('button', { name: 'Discard draft' })).toHaveCount(0);

    // Nothing written: Esc closes, and reopening starts clean.
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });
});
