import { expect, type Page } from '@playwright/test';

/**
 * THE VISTAZO (ADR-139 p1): from a lens, a link to a performance, a
 * conversation or a person opens the record in the panel over the lens, not
 * its page. A spec that wants the PAGE (it pins something only the page
 * does, or the next lens it lands on) goes through «Open in full», as a
 * person would.
 */
export async function openInFull(page: Page): Promise<void> {
  const peek = page.getByTestId('peek');
  await expect(peek, 'the record opened in the vistazo').toBeVisible({ timeout: 15_000 });
  await peek.getByTestId('peek-full').click();
}
