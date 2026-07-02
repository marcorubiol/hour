import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

test.describe('smoke', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with workspace_membership in hour-phase0).',
  );

  /**
   * Post-ADR-037/038/039 happy path (rewritten 2026-07-02 against the live
   * world — the previous version predated the muk-cia rename and the
   * sidebar-as-filter shell). Covers the integration points that move data
   * end to end:
   *   - login flow (Supabase Auth REST + JWT in localStorage)
   *   - hardcoded post-login redirect → /h/marco-rubiol
   *   - shell renders with the lens pills, Today active
   *   - /api/workspaces + /api/projects under RLS fill Plaza (sidebar is
   *     user-scoped: the MaMeMi project link appears even though the URL
   *     lands on marco-rubiol)
   *   - project detail at /h/muk-cia/project/mamemi loads the engagement
   *     count through /api/engagements (154 contacts under RLS)
   *   - the Calendar lens routes, renders the month grid, and the Today
   *     pill returns to the workspace
   *
   * The test user (playwright@hour.test) is member of marco-rubiol,
   * muk-cia and its own playwright workspace; NOT of demo — see
   * tests/rls/cross-tenant.test.ts for the authoritative fixture map.
   */
  test('login → MaMeMi project → engagements load → calendar lens', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.locator('input[type=email]').fill(EMAIL!);
    await page.locator('input[type=password]').fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL(/\/h\/marco-rubiol\/?$/);

    // Shell loaded — lens pills present, Today active.
    const lensNav = page.getByRole('navigation', { name: 'Lens' });
    await expect(lensNav.getByRole('button', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    // Plaza is user-scoped: the MaMeMi project appears even though the URL
    // landed on marco-rubiol. (Plaza row clicks are filter TOGGLES since
    // ADR-038 — the canonical URL is the deterministic way in, so the
    // smoke navigates directly; toggle UX gets its own test some day.)
    await expect(
      page.getByRole('link', { name: 'MaMeMi', exact: true }).first(),
    ).toBeAttached();
    await page.goto('/h/muk-cia/project/mamemi/');

    // RelationshipStub proves the whole read path: JWT survived, RLS let
    // the engagements through, the count renders.
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

    // Today pill leaves the calendar (lands on the serialized selection —
    // canonical project URL or query form, both fine; just not /calendar).
    await lensNav.getByRole('button', { name: 'Today' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/calendar'));
  });
});
