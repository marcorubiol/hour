import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * ⌘K crea (ADR-139 «después»): escribir en la paleta encuentra «New
 * rehearsal», lo escrito detrás llega como título al alta rápida del shell, y
 * eso funciona fuera del Planner (desde Desk). La fila es una opción del
 * listbox. El spec es dueño de su fila: el «Undo» del aviso la borra.
 *
 * Escribe en `playwright` (proyecto «ZZZ e2e collab»), nunca en otro espacio.
 */
test.describe('⌘K creates (ADR-139)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('⌘K → New rehearsal with the typed title → added → Undo', async ({ page }) => {
    test.setTimeout(60_000);
    const title = `E2E cmdk ${Date.now()}`;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    await page.goto('/h/desk?scope=s:playwright');
    await waitForLoaded(page);

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Build a scope' });
    await expect(palette).toBeVisible();
    await palette.getByRole('textbox').fill(`rehearsal ${title}`);

    const create = palette.getByRole('option', { name: /New rehearsal/ });
    await expect(create).toBeVisible();
    await expect(create).toContainText(title);
    await create.click();
    await expect(palette).toBeHidden();

    // The shell's quick add, on a rehearsal, with the text as its title.
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('What', { exact: true })).toHaveValue(title);
    await expect(dialog.locator('[data-chip="type"]')).toContainText('Rehearsal');
    await dialog.locator('[data-chip="owner"]').click();
    await dialog.getByLabel('Project', { exact: true }).selectOption({ label: 'ZZZ e2e collab' });
    await dialog.locator('[data-chip="when"]').click();
    await dialog.getByLabel('Day', { exact: true }).fill(today);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Still on Desk: the notice says it, and «Undo» takes it back.
    await expect(page).toHaveURL(/\/h\/desk/);
    const toast = page.locator('.toast').filter({ hasText: 'Added to the plan' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Undone.' })).toBeVisible({ timeout: 10_000 });

    // Nothing of it is left.
    const left = await page.evaluate(
      async ({ d, name }) => {
        const res = await fetch(`/api/dates?from=${d}&to=${d}`);
        const data = (await res.json()) as { items?: Array<{ title?: string | null }> };
        return (data.items ?? []).filter((i) => i.title === name).length;
      },
      { d: today, name: title },
    );
    expect(left).toBe(0);
  });
});
