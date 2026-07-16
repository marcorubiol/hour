import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(EMAIL!);
  await page.locator('input[type=password]').fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  // ADR-067 lands on `/h` with no trailing slash — the old /\/h\// never matches.
  await page.waitForURL(/\/h\/?$/);
}

async function sessionCookies(context: BrowserContext) {
  const cookies = await context.cookies();
  return {
    access: cookies.find((cookie) => cookie.name === 'hour_at'),
    refresh: cookies.find((cookie) => cookie.name === 'hour_rt'),
  };
}

test.describe('httpOnly session', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('login → refresh recovery → UI logout', async ({ page, context }) => {
    await login(page);

    const loggedIn = await sessionCookies(context);
    for (const cookie of [loggedIn.access, loggedIn.refresh]) {
      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.secure).toBe(true);
      expect(cookie?.sameSite).toBe('Strict');
    }
    expect(await page.evaluate(() => localStorage.getItem('hour_jwt'))).toBeNull();

    // Lose only the short-lived access cookie. The session probe must use
    // the scoped refresh cookie and restore a complete session silently.
    await context.clearCookies({ name: 'hour_at' });
    const recovered = await page.request.get('/api/auth/session');
    expect(recovered.status()).toBe(200);
    expect((await recovered.json()).user.email).toBe(EMAIL);
    expect((await sessionCookies(context)).access).toBeDefined();

    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login\/?$/);

    const loggedOut = await sessionCookies(context);
    expect(loggedOut.access).toBeUndefined();
    expect(loggedOut.refresh).toBeUndefined();
    expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  });
});
