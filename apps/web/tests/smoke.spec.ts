import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

test.describe('smoke', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with workspace_membership in hour-phase0).',
  );

  /**
   * Happy path across the shell (ADR-065 nav). No top-nav buttons: the logo
   * is Home = Desk; Calendar and Money are reached from ⌘K. Covers the
   * integration points that move data end to end:
   *   - bare /h/ forwards to the default workspace's Desk
   *   - the shell renders (brand); ⌘K jumps to a real line AND a view
   *   - project detail loads the conversation count through /api/conversations
   *   - Calendar month grid, Conversations table, Money totals all deep-link
   *
   * Sign-in is not exercised here: the session arrives from the shared
   * storageState (tests/auth.setup.ts) and the login flow itself is covered
   * by auth-session.spec.ts.
   *
   * Test user (playwright@hour.test) is member of marco-rubiol, muk-cia and
   * its own playwright workspace; NOT demo.
   */
  test('shell → ⌘K → project → views', async ({ page }) => {
    // ADR-068: `/h` is the HALL — greeting + the "posa'm al dia" door to
    // /h/desk. The cross-space digest died; the projects grid lives on the
    // space portada now. Note the bare path: sign-in lands on `/h`.
    await page.goto('/h');
    await expect(page.getByRole('link', { name: /Hour — home/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /catch me up/i })).toBeVisible();

    // ⌘K is the SCOPE BUILDER (Scope v2), not a lens switcher: it lists
    // spaces / projects / lines from /api/workspaces + /api/projects +
    // /api/lines (RLS). No Money option lives in here any more.
    await page.keyboard.press('Meta+k');
    const palette = page.getByRole('dialog', { name: 'Build a scope' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).not.toBeVisible();

    // ADR-067: lens routes are SPACE-LESS — scope rides in pins / ?scope=,
    // never in the path.
    await page.goto('/h/money');
    await expect(page.locator('.mny__totals')).toBeVisible();
    // Books header leads with Vendido/sold now (grill ADR-088); pipeline is demoted.
    await expect(page.locator('.mny__total').first()).toContainText(/sold/);

    // Old space-scoped lens bookmarks 308 to the space-less lens.
    await page.goto('/h/muk-cia/desk');
    await page.waitForURL(/\/h\/desk\/?$/);
    await expect(page.locator('.desk__head')).toBeVisible();

    // Project detail proves the read path: session survived, RLS let the
    // conversations through, the count renders. Entities stay space-scoped.
    await page.goto('/h/muk-cia/project/mamemi/');
    const countLabel = page.locator('.rel-stub__count');
    await expect(countLabel).toBeVisible();
    await expect(countLabel).toContainText(/\d+\s+conversations?/);
    expect(await page.locator('.rel-stub__item').count()).toBeGreaterThan(0);

    // Calendar month grid.
    await page.goto('/h/planner');
    await expect(page.locator('.cal__grid')).toBeVisible();
    expect(await page.locator('.cal__weekday').count()).toBe(7);

    // Conversations.
    await page.goto('/h/conversations');
    await expect(page.locator('.status-bar__count')).toContainText(/\d+ conversations/);
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);
  });
});
