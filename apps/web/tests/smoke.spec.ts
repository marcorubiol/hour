import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

test.describe('smoke', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with workspace_membership in hour-phase0).',
  );

  /**
   * Adaptive Digest happy path (ADR-055, final nav). No top-nav buttons: the
   * logo is Home = Agenda; Calendar and Money are reached from ⌘K. Covers the
   * integration points that move data end to end:
   *   - login (server-side Supabase grant + httpOnly session) → /h/marco-rubiol
   *   - the shell renders (brand); ⌘K jumps to a real line AND a view
   *   - project detail loads the engagement count through /api/engagements
   *   - Calendar month grid, Contacts table, Money totals all deep-link
   *
   * Test user (playwright@hour.test) is member of marco-rubiol, muk-cia and
   * its own playwright workspace; NOT demo.
   */
  test('login → shell → ⌘K → project → views', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type=email]').fill(EMAIL!);
    await page.locator('input[type=password]').fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/h\/marco-rubiol\/?$/);

    // Shell loaded — the brand is the home affordance (no nav buttons).
    await expect(page.getByRole('link', { name: /Hour — home/i })).toBeVisible();

    // Home = projects-first grid (ADR-060): at least one project card
    // renders with its name (the ghost "+ New project" card has none).
    await expect(page.locator('.pcard__name').first()).toBeVisible();

    // ⌘K palette: built from /api/lines + /api/projects (RLS) + the views.
    await page.keyboard.press('Meta+k');
    const palette = page.getByRole('dialog', { name: 'Jump to a project, line or space' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('option').first()).toBeVisible();
    // Money is reachable from ⌘K.
    await page.locator('.cmdk__search input').fill('Money');
    await palette.getByRole('option', { name: /Money/ }).first().click();
    await page.waitForURL(/\/h\/[^/]+\/money\/?$/);
    await expect(page.locator('.mny__totals')).toBeVisible();
    await expect(page.locator('.mny__total').first()).toContainText(/pipeline/);

    // Project detail proves the read path: JWT survived, RLS let the
    // engagements through, the count renders.
    await page.goto('/h/muk-cia/project/mamemi/');
    const countLabel = page.locator('.rel-stub__count');
    await expect(countLabel).toBeVisible();
    await expect(countLabel).toContainText(/\d+\s+engagements?/);
    expect(await page.locator('.rel-stub__item').count()).toBeGreaterThan(0);

    // Calendar month grid deep-links.
    await page.goto('/h/muk-cia/calendar');
    await expect(page.locator('.cal__grid')).toBeVisible();
    expect(await page.locator('.cal__weekday').count()).toBe(7);

    // Contacts deep-links (no longer a top-nav item).
    await page.goto('/h/muk-cia/contacts');
    await expect(page.locator('.status-bar__count')).toContainText(/\d+ contacts/);
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);

    // Bare /h/ forwards to a workspace agenda (no stale "pick a workspace").
    await page.goto('/h/');
    await page.waitForURL(/\/h\/[^/]+\/?$/);
    expect(new URL(page.url()).pathname).not.toBe('/h/');
  });
});
