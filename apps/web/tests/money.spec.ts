import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const LIMITED_EMAIL = process.env.PW_LIMITED_EMAIL;
const LIMITED_PASSWORD = process.env.PW_LIMITED_PASSWORD;

/**
 * E2E: Cuentas (`/h/books`) as a dashboard (ADR-117, ADR-119).
 *
 * THE SPEC OWNS ITS ROWS. It works in the `playwright` space, project
 * `zzz-e2e-collab`, on two deals it finds by name or creates once and then
 * reuses on every run (there is no way to delete a bolo, so a fresh one per
 * run would pile up):
 *   - «ZZZ e2e radar»: confirmed, fee 1000, and for the length of the test one
 *     function in the past that the test itself creates and deletes. With it,
 *     the deal is «por facturar» and must surface in «Pide atención» with ONE
 *     action, and the «Por facturar» filter must list it.
 *   - «ZZZ e2e fee»: the fee write path round-trips (set, persists across a
 *     reload, clear). It ends with no fee, as it began.
 * The limited fixture user does not read money: the lens is not in the
 * switcher and the page says so instead of «no deals». It only reads; it
 * never changes that user's access (the RLS suite does, see `_context.md`).
 */

const PROJECT_SLUG = 'zzz-e2e-collab';
const RADAR = 'ZZZ e2e radar';
const FEE = 'ZZZ e2e fee';

type Bolo = { id: string; venue_name: string | null; status: string; fee_amount: number | null };

/** Find the spec's deal by name, or create it; leave it confirmed with `fee`. */
async function ownBolo(page: Page, venue: string, fee: number | null): Promise<{ projectId: string; boloId: string }> {
  return page.evaluate(
    async ({ slug, venue, fee }) => {
      const projects = (await (await fetch('/api/projects?status=active')).json()) as {
        items: { id: string; slug: string }[];
      };
      const projectId = projects.items.find((p) => p.slug === slug)?.id;
      if (!projectId) throw new Error(`no project ${slug}`);
      const list = (await (await fetch(`/api/money/bolos?project_ids=${projectId}&limit=500`)).json()) as {
        items: Bolo[];
      };
      let bolo = list.items.find((b) => b.venue_name === venue);
      if (!bolo) {
        const res = await fetch('/api/money/bolos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, venue_name: venue, fee_amount: fee, fee_currency: 'EUR' }),
        });
        if (!res.ok) throw new Error(`create bolo ${res.status}`);
        bolo = ((await res.json()) as { bolo: Bolo }).bolo;
      }
      const patch = await fetch(`/api/money/bolos/${bolo.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed', fee_amount: fee, fee_currency: 'EUR' }),
      });
      if (!patch.ok) throw new Error(`patch bolo ${patch.status}`);
      return { projectId, boloId: bolo.id };
    },
    { slug: PROJECT_SLUG, venue, fee },
  );
}

test.describe('Cuentas', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('a function done without invoice asks to be invoiced; the filter is the figure', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/h/books');
    await waitForLoaded(page);
    const { projectId, boloId } = await ownBolo(page, RADAR, 1000);

    // A function in the past, hung from the deal: now it is «por facturar».
    const perfId = await page.evaluate(
      async ({ projectId, boloId, venue }) => {
        const res = await fetch('/api/performances', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            performed_at: '2025-01-10',
            venue_name: venue,
            status: 'done',
            bolo_id: boloId,
          }),
        });
        if (!res.ok) throw new Error(`create performance ${res.status}`);
        return ((await res.json()) as { performance: { id: string } }).performance.id;
      },
      { projectId, boloId, venue: RADAR },
    );

    try {
      await page.reload();
      await waitForLoaded(page);

      // The four figures are there, and «Pide atención» names the deal with
      // the one action that fits it.
      await expect(page.locator('.fig[data-fig="owed"]').first()).toBeVisible();
      await expect(page.locator('.fig[data-fig="season"]').first()).toBeVisible();
      const row = page.locator('.att__row', { hasText: RADAR });
      await expect(row).toHaveAttribute('data-kind', 'to_invoice');
      await expect(row.getByRole('button')).toHaveText('Make invoice');

      // The «to invoice» figure filters the ledger to exactly that.
      await page.locator('.fig[data-fig="to_invoice"]').first().click();
      const chip = page.locator('.ledger__filters button', { hasText: 'To invoice' });
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      const ledgerRow = page.locator(`#bolo-${boloId}`);
      await expect(ledgerRow).toBeVisible();

      // The row unfolds in place into the bolo's sheet, and says so in the URL.
      await ledgerRow.getByRole('button', { name: RADAR }).click();
      await expect(page.locator(`#bolo-sheet-${boloId}`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#bolo-${boloId}$`));
    } finally {
      await page.evaluate(async (id) => {
        await fetch(`/api/performances/${id}`, { method: 'DELETE' });
      }, perfId);
    }
  });

  test('/h/money answers 301 to /h/books with its query, and the anchor opens the sheet', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/books');
    await waitForLoaded(page);
    const { boloId } = await ownBolo(page, FEE, null);

    const res = await page.request.get('/h/money?scope=x', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    const to = new URL(res.headers()['location']!, page.url());
    expect(to.pathname + to.search).toBe('/h/books?scope=x');

    await page.goto(`/h/money#bolo-${boloId}`);
    await page.waitForURL(new RegExp(`/h/books#bolo-${boloId}$`));
    await waitForLoaded(page);
    await expect(page.locator(`#bolo-${boloId} .book__toggle`)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`#bolo-sheet-${boloId}`)).toBeVisible();
  });

  test('fee set → persists across a reload → clear', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/books');
    await waitForLoaded(page);
    const { boloId } = await ownBolo(page, FEE, null);
    await page.reload();
    await waitForLoaded(page);

    const fee = page.locator(`#bolo-${boloId} .book__fee`);
    await expect(fee).toHaveText('no fee');

    await fee.click();
    let dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Amount').fill('1234.56');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(fee).toHaveText('1,234.56', { timeout: 10_000 });

    await page.reload();
    await waitForLoaded(page);
    await expect(fee).toHaveText('1,234.56', { timeout: 10_000 });

    await fee.click();
    dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Amount').fill('');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(fee).toHaveText('no fee', { timeout: 10_000 });
  });
});

test.describe('Cuentas without read:money', () => {
  test.skip(!LIMITED_EMAIL || !LIMITED_PASSWORD, 'Set PW_LIMITED_EMAIL / PW_LIMITED_PASSWORD.');
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the lens is not offered, and the page says there is no access', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/login');
    await page.locator('input[type=email]').fill(LIMITED_EMAIL!);
    await page.locator('input[type=password]').fill(LIMITED_PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/h\/?$/, { timeout: 60_000 });

    await page.goto('/h/planner');
    await waitForLoaded(page);
    const tabs = page.locator('.lensswitch');
    await expect(tabs.getByRole('tab', { name: 'Conversations' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Books' })).toHaveCount(0);

    await page.goto('/h/books');
    await waitForLoaded(page);
    await expect(page.getByTestId('money-no-access')).toBeVisible();
    await expect(page.locator('.fig')).toHaveCount(0);
  });
});
