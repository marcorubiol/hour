/**
 * EACH SPACE TURNS ITS LENSES ON OR OFF (ADR-132). A lens off leaves the
 * switcher, ⌘K, the Desk doors and the links that lead to it; reached by URL,
 * the lens says it is off and who turns it on. Nothing is deleted.
 *
 * Runs in the `playwright` workspace (`?scope=s:playwright`) and puts its
 * lenses back as it found them, whatever happens.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL ?? '';
const PASSWORD = process.env.PW_TEST_PASSWORD ?? '';
const SCOPE = '?scope=s:playwright';

async function wsId(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const ws = await fetch('/api/workspaces');
    return ((await ws.json()) as { items: { id: string; slug: string }[] }).items.find((w) => w.slug === 'playwright')?.id ?? null;
  });
  expect(id, 'playwright workspace reachable').not.toBeNull();
  return id!;
}

async function setLensesOff(page: Page, id: string, lensesOff: string[]) {
  const status = await page.evaluate(
    async ({ id, lensesOff }) =>
      (
        await fetch(`/api/workspaces/${id}/lenses`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lenses_off: lensesOff }),
        })
      ).status,
    { id, lensesOff },
  );
  expect(status).toBe(200);
}

test.describe.configure({ mode: 'serial' });

test.describe('Lenses per space (ADR-132)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  let id = '';
  let before: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(`/h/desk${SCOPE}`);
    id = await wsId(page);
    before = await page.evaluate(
      async (id) => ((await (await fetch(`/api/workspaces/${id}/lenses`)).json()) as { lenses_off: string[] }).lenses_off,
      id,
    );
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(`/h/desk${SCOPE}`);
    await setLensesOff(page, id, before);
    await page.close();
  });

  test('a lens off leaves the switcher, the Desk and ⌘K', async ({ page }) => {
    await page.goto(`/h/desk${SCOPE}`);
    await setLensesOff(page, id, ['planner', 'books']);
    await page.goto(`/h/desk${SCOPE}`);
    await waitForLoaded(page);

    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav.getByRole('link', { name: 'Today' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Conversations' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Planner' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Books' })).toHaveCount(0);

    await expect(page.getByTestId('door-conversations')).toBeVisible();
    await expect(page.getByTestId('door-planner')).toHaveCount(0);
    await expect(page.getByTestId('door-books')).toHaveCount(0);
    await expect(page.locator('main a[href^="/h/planner"], main a[href^="/h/books"]')).toHaveCount(0);

    // A written day is a way into the Planner: none while it is off.
    await page.keyboard.press('Meta+k');
    const palette = page.getByRole('dialog', { name: 'Build a scope' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').or(palette.locator('input')).first().fill('12 march');
    await expect(palette.getByText('Day', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Back on: everything returns.
    await setLensesOff(page, id, []);
    await page.goto(`/h/desk${SCOPE}`);
    await waitForLoaded(page);
    await expect(nav.getByRole('link', { name: 'Planner' })).toBeVisible();
    await expect(page.getByTestId('door-planner')).toBeVisible();
    await page.keyboard.press('Meta+k');
    await palette.getByRole('combobox').or(palette.locator('input')).first().fill('12 march');
    await expect(palette.getByText('Day', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('by URL, the lens says it is off and who turns it on', async ({ page }) => {
    await page.goto(`/h/desk${SCOPE}`);
    await setLensesOff(page, id, ['books']);
    await page.goto(`/h/books${SCOPE}`);
    await waitForLoaded(page);

    const off = page.getByTestId('lens-off');
    await expect(off).toBeVisible();
    await expect(off).toContainText('The Books section is off in this space.');
    // The fixture administers the space: the way to Settings, not a name.
    await expect(off.getByRole('link', { name: 'Turn it on in Settings' })).toHaveAttribute(
      'href',
      '/h/playwright/settings?section=lenses',
    );
    // The lens draws nothing of its own (no ledger), and the data is still there.
    await expect(page.locator('#mny-ledger')).toHaveCount(0);
    await expect(page).toHaveTitle(/^Books · Hour$/);
  });

  test('Settings turns a lens back on', async ({ page }) => {
    await page.goto(`/h/desk${SCOPE}`);
    await setLensesOff(page, id, ['books']);
    await page.goto('/h/playwright/settings?section=lenses');
    const group = page.getByTestId('settings-lenses');
    const books = group.getByTestId('lens-toggle-books');
    await expect(books).toHaveAttribute('aria-pressed', 'false');
    await expect(group.getByTestId('lens-toggle-planner')).toHaveAttribute('aria-pressed', 'true');
    await books.click();
    await expect(books).toHaveAttribute('aria-pressed', 'true');

    await page.goto(`/h/books${SCOPE}`);
    await waitForLoaded(page);
    await expect(page.getByTestId('lens-off')).toHaveCount(0);
    await expect(page.locator('#mny-ledger')).toBeVisible();
  });
});
