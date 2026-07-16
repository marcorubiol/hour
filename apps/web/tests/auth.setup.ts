import { test as setup, expect } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';

/**
 * Sign in ONCE for the whole suite and hand the session to every spec.
 *
 * WHY: each spec used to run its own login(). At ~14 logins per run, all
 * from one IP, the suite ate its own rate limit — `/api/auth/login` admits
 * 10 per 5 min per IP (LOGIN_RULE, ADR-061) — and later specs got a 429
 * ("Too many attempts") that surfaced as an unexplained 90s navigation
 * timeout. The limit is correctly sized for humans; the suite was the
 * abuser. Diagnosed 2026-07-16 from venue-link.spec's saved page snapshot.
 *
 * Serialising the suite does NOT fix this: 14 sequential logins still
 * exceed 10 in the same 5-minute window. Sharing one session does — the
 * run now spends 1 login instead of 14, and is faster for it.
 *
 * The session is httpOnly cookies (hour_at + hour_rt); storageState
 * captures those fine. auth-session.spec.ts is deliberately excluded from
 * the shared state — it tests the login/refresh/logout flow itself and must
 * start signed out (see the `auth` project in playwright.config.ts).
 *
 * This setup doubles as the login smoke test: if sign-in breaks, every
 * dependent spec fails loudly here rather than 14 times over.
 */

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

setup('authenticate', async ({ page }) => {
  if (!EMAIL || !PASSWORD) {
    // No credentials: write an empty state so dependent projects can still
    // build a context. Their own test.skip(!EMAIL || !PASSWORD) guards do
    // the skipping — without this file, Playwright errors before reaching them.
    await page.context().storageState({ path: STORAGE_STATE });
    return;
  }

  await page.goto('/login');
  await page.locator('input[type=email]').fill(EMAIL);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // ADR-067: sign-in lands on `/h` — the home IS the cross-space Desk digest,
  // a real page. Note the missing trailing slash: `/\/h\//` does NOT match.
  await page.waitForURL(/\/h\/?$/);
  await expect(page.getByRole('link', { name: /Hour — home/i })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
