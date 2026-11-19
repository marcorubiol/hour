import { expect, type Page } from '@playwright/test';

/** Opens a Hoy fold (ADR-218 § 3: «Ha cambiado» and «La temporada» fold on a desktop). */
export async function unfold(page: Page, testid: string): Promise<void> {
  const lid = page.getByTestId(testid).locator('> .lid');
  await expect(lid).toBeVisible({ timeout: 15_000 });
  if ((await lid.getAttribute('aria-expanded')) !== 'true') await lid.click();
  await expect(lid).toHaveAttribute('aria-expanded', 'true');
}
