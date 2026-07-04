import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

test.describe('smoke', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with workspace_membership in hour-phase0).',
  );

  /**
   * Adaptive Digest happy path (rewritten 2026-07-04 for ADR-055 — the nav
   * redesign removed the persistent sidebar; scope is PINS + ⌘K). Covers the
   * integration points that move data end to end:
   *   - login flow (Supabase Auth REST + JWT in localStorage)
   *   - hardcoded post-login redirect → /h/marco-rubiol
   *   - Adaptive shell: lens pills (Today · Calendar · Money), Today active,
   *     Clean|My home toggle on the home
   *   - ⌘K command palette jumps to a real line (built from /api/lines)
   *   - project detail at /h/muk-cia/project/mamemi loads the engagement
   *     count through /api/engagements (RLS)
   *   - Calendar lens routes + month grid; Contacts route (no longer a pill)
   *     still deep-links; Money lens totals render; Today returns home
   *
   * The test user (playwright@hour.test) is member of marco-rubiol, muk-cia
   * and its own playwright workspace; NOT of demo.
   */
  test('login → shell → ⌘K → project → lenses', async ({ page }) => {
    await page.goto('/login');

    await page.locator('input[type=email]').fill(EMAIL!);
    await page.locator('input[type=password]').fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL(/\/h\/marco-rubiol\/?$/);

    // Adaptive shell — lens pills present, Today active, home mode toggle.
    const lensNav = page.getByRole('navigation', { name: 'Lens' });
    await expect(lensNav.getByRole('button', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Clean' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'My home' })).toBeVisible();

    // ⌘K palette is built from /api/lines (RLS): a real line is reachable in
    // one hop even though the sidebar is gone.
    await page.keyboard.press('Meta+k');
    const palette = page.getByRole('dialog', { name: 'Jump to a line or space' });
    await expect(palette).toBeVisible();
    const lineRow = palette.getByRole('option').first();
    await expect(lineRow).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).not.toBeVisible();

    // Project detail proves the whole read path: JWT survived, RLS let the
    // engagements through, the count renders. (Reached by direct URL — the
    // canonical way in; the sidebar link is gone.)
    await page.goto('/h/muk-cia/project/mamemi/');
    const countLabel = page.locator('.rel-stub__count');
    await expect(countLabel).toBeVisible();
    await expect(countLabel).toContainText(/\d+\s+engagements?/);
    expect(await page.locator('.rel-stub__item').count()).toBeGreaterThan(0);

    // Calendar lens: pill navigates, grid renders with weekday headers.
    await lensNav.getByRole('button', { name: 'Calendar' }).click();
    await page.waitForURL(/\/h\/muk-cia\/calendar\/?$/);
    await expect(page.locator('.cal__grid')).toBeVisible();
    expect(await page.locator('.cal__weekday').count()).toBe(7);
    await expect(lensNav.getByRole('button', { name: 'Calendar' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    // Contacts is no longer a top-lens pill (ADR-055) but the route still
    // deep-links: the shared EngagementTable loads contacts inside the shell.
    await page.goto('/h/muk-cia/contacts');
    await expect(page.locator('.status-bar__count')).toContainText(/\d+ contacts/);
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);

    // Money lens: pill navigates, totals strip renders.
    await lensNav.getByRole('button', { name: 'Money' }).click();
    await page.waitForURL(/\/h\/muk-cia\/money\/?$/);
    await expect(page.locator('.mny__totals')).toBeVisible();
    await expect(page.locator('.mny__total').first()).toContainText(/pipeline/);

    // Today pill returns to the home (leaves the routed lens).
    await lensNav.getByRole('button', { name: 'Today' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/money'));
  });
});
