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
   *   - project detail loads the engagement count through /api/engagements
   *   - Calendar month grid, Contacts table, Money totals all deep-link
   *
   * Sign-in is not exercised here: the session arrives from the shared
   * storageState (tests/auth.setup.ts) and the login flow itself is covered
   * by auth-session.spec.ts.
   *
   * Test user (playwright@hour.test) is member of marco-rubiol, muk-cia and
   * its own playwright workspace; NOT demo.
   */
  test('shell → ⌘K → project → views', async ({ page }) => {
    // Bare /h/ forwards to a workspace Desk (no stale "pick a workspace").
    await page.goto('/h/');
    await page.waitForURL(/\/h\/[^/]+\/desk\/?$/);

    // Shell loaded — the brand is the home affordance (no nav buttons).
    await expect(page.getByRole('link', { name: /Hour — home/i })).toBeVisible();

    // The projects grid moved: the home IS the Desk now (ADR-062/065), so the
    // ADR-060 grid lives on the space portada, scoped to that space. Assert it
    // on muk-cia — marco-rubiol (the default landing space) is empty.
    await page.goto('/h/muk-cia/');
    await expect(page.locator('.pcard__name').first()).toBeVisible();

    // ⌘K is the SCOPE BUILDER now (Scope v2), not a lens switcher: it lists
    // spaces / projects / lines from /api/workspaces + /api/projects +
    // /api/lines (RLS). Lens switching moved to the visible "view as" control,
    // so there is no Money option in here any more.
    await page.keyboard.press('Meta+k');
    const palette = page.getByRole('dialog', { name: 'Build a scope' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).not.toBeVisible();

    // "view as" is how you change lens — it only exists on a lens route.
    await page.goto('/h/muk-cia/desk');
    await page.getByRole('button', { name: 'Money', exact: true }).click();
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

  });
});
