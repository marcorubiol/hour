import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — public road sheet links (ADR-047, D6): create a link from the
 * operator road sheet, open it logged-OUT in a fresh context, verify the
 * role-filtered document renders, revoke, verify the link dies.
 * Self-cleaning: the share ends revoked (revocation is an assertion).
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(EMAIL!);
  await page.locator('input[type=password]').fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\//);
}

test.describe('public road sheet link', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('create → anonymous open → revoke → dead', async ({ page, browser }) => {
    test.setTimeout(90_000);

    await login(page);
    await page.goto('/h/playwright/performance/zzz-e2e-1/roadsheet');
    await expect(page.locator('.rsv__title')).toBeVisible();

    // Pre-clean via API: revoke strays from previously failed runs so the
    // count assertions below are deterministic.
    await page.evaluate(async () => {
      const base = '/api/performances/zzz-e2e-1/roadsheet/shares';
      const res = await fetch(`${base}?ws=playwright`);
      const { items } = (await res.json()) as { items: Array<{ id: string }> };
      for (const s of items) {
        await fetch(`${base}/${s.id}?ws=playwright`, { method: 'DELETE' });
      }
    });
    await page.reload();
    await expect(page.locator('.rsv__title')).toBeVisible();

    // Create a venue-role link; capture the token from the API response.
    await page.locator('.rs__share-pick select').selectOption('venue');
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/roadsheet/shares') && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Create link' }).click(),
    ]);
    expect(response.status()).toBe(201);
    const { share } = (await response.json()) as {
      share: { id: string; token: string; role: string };
    };
    expect(share.token).toMatch(/^[0-9a-f]{64}$/);
    await expect(page.locator('.rs__share-list li', { hasText: 'venue' })).toBeVisible();

    // Open the public URL in a fresh context — no auth, no storage.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`/public/roadsheet/${share.token}`);
    await expect(anonPage.locator('.rsv__title')).toBeVisible({ timeout: 15_000 });
    // Venue role: schedule yes, no notes section ever (public roles never
    // see free-text notes by matrix).
    await expect(anonPage.locator('[aria-label="Notes"]')).toHaveCount(0);

    // Revoke from the operator page.
    const shareRow = page.locator('.rs__share-list li', { hasText: 'venue' }).first();
    await shareRow.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.locator('.rs__share-list li', { hasText: 'venue' })).toHaveCount(0, {
      timeout: 10_000,
    });

    // The link is dead on the next request.
    await anonPage.reload();
    await expect(anonPage.getByText('This link is no longer active')).toBeVisible({
      timeout: 15_000,
    });

    await anonContext.close();
  });
});
