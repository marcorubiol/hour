import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

test.describe('smoke', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with workspace_membership in hour-phase0).',
  );

  /**
   * Post-ADR-029 happy path. Covers the integration points that move data
   * end to end:
   *   - login flow (Supabase Auth REST + JWT in localStorage)
   *   - hardcoded post-login redirect → /h/marco-rubiol/
   *   - workspace shell renders (Plaza, lens pills, sidebar footer)
   *   - JWT auth hook injected current_workspace_id (otherwise /api/houses
   *     would return zero rows under RLS)
   *   - /api/houses returned this user's actual memberships (sidebar
   *     shows MaMeMi for the playwright test user even though the URL
   *     lands on marco-rubiol, which playwright is NOT a member of —
   *     the sidebar is user-scoped, not URL-scoped, per ADR-029)
   *   - clicking the MaMeMi room navigates to /h/mamemi/room/mamemi
   *   - /api/engagements?project_slug=mamemi returned the 154 contacts
   *   - RelationshipStub renders the count + at least one row
   *   - logout clears state and redirects to /login
   *
   * The test user (playwright@hour.test) is admin of `mamemi` and owner
   * of its own `playwright` workspace post the 2026-05-18 migration —
   * see build/runbooks/test-user-setup.md.
   */
  test('login → navigate to MaMeMi room → engagements load → sign out', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.locator('input[type=email]').fill(EMAIL!);
    await page.locator('input[type=password]').fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Hardcoded redirect lands on /h/marco-rubiol/ for every signed-in
    // user in Phase 0 (will become dynamic in Phase 1 multi-workspace
    // switching). The playwright user isn't a member of marco-rubiol —
    // RLS returns their real workspace list (mamemi + playwright) and
    // Plaza renders those instead.
    // SvelteKit normalises the trailing slash, so the URL lands as
    // /h/marco-rubiol (no slash). Match both forms.
    await page.waitForURL(/\/h\/marco-rubiol\/?$/);

    // Shell loaded — the "Plaza" lens pill must be active.
    const plazaLens = page.getByRole('button', { name: 'Plaza' });
    await expect(plazaLens).toBeVisible();
    await expect(plazaLens).toHaveClass(/workspace-shell__lens--active/);

    // Plaza must surface the MaMeMi room link. Targeting by href avoids
    // the ambiguity between "MaMeMi" the House and "MaMeMi" the Room
    // (the room.name happens to match the workspace.name for now).
    const mameMiRoomLink = page.locator('a[href="/h/mamemi/room/mamemi"]');
    await expect(mameMiRoomLink).toBeVisible();
    await mameMiRoomLink.click();

    await page.waitForURL(/\/h\/mamemi\/room\/mamemi\/?$/);

    // RelationshipStub header reports the engagement count. The fact that
    // any positive count renders proves: JWT survived, auth hook injected
    // current_workspace_id, /api/engagements reached PostgREST with the
    // right token, and RLS let the rows through.
    const countLabel = page.locator('.rel-stub__count');
    await expect(countLabel).toBeVisible();
    await expect(countLabel).toContainText(/\d+\s+engagements?/);

    // Items list is non-empty. We don't assert the specific count (154)
    // because future data changes shouldn't break the smoke — if the
    // number ever drops to zero we want a different test telling us so.
    const items = page.locator('.rel-stub__item');
    expect(await items.count()).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
  });
});
