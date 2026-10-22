import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

test.describe('smoke', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with a workspace membership in hour-phase0).',
  );

  /**
   * Happy path across the shell (ADR-065 nav). No top-nav buttons: the logo
   * is Home = Desk; Calendar and Money are reached from ⌘K. Covers the
   * integration points that move data end to end:
   *   - bare /h forwards to the Desk, the one front door (ADR-137)
   *   - the shell renders (brand); ⌘K jumps to a real line AND a view
   *   - project detail loads the conversation count through /api/conversations
   *   - Calendar month grid, Conversations table, Money totals all deep-link
   *
   * Sign-in is not exercised here: the session arrives from the shared
   * storageState (tests/auth.setup.ts) and the login flow itself is covered
   * by auth-session.spec.ts.
   *
   * Test user (playwright@hour.test) belongs to its own playwright workspace
   * only (§ 31, 2026-10); the conversations it reads are the synthetic set in
   * project `zzz-difusion`.
   */
  test('shell → ⌘K → project → views', async ({ page }) => {
    // SEVEN NAVIGATIONS AGAINST PRODUCTION IN ONE TEST. The default 30 s was
    // a budget measured on a fast day, not a law: on 2026-09-26, with the
    // suite running at half its August speed, it ran out with Conversations
    // still loading, while the five specs that load that lens passed. Alone
    // it took 15 s. What this test asserts is that every door opens, not how
    // fast; `slow()` triples the budget and keeps that honest.
    test.slow();
    // ADR-137: ONE FRONT DOOR. `/h` was the Hall, a page before the Desk; it
    // forwards to the Desk now, with the lens bar on screen from the start.
    await page.goto('/h');
    await page.waitForURL(/\/h\/desk\/?$/);
    await waitForLoaded(page);
    await expect(page.getByRole('navigation', { name: /sections/i })).toBeVisible();
    // THE WAY HOME IS THE CLOCK (2026-07-31), and home is the Desk. Located by
    // the door itself (`a[href="/h/desk"]` wrapping the clock) rather than by
    // its label, which is translated.
    await expect(page.locator('a[href="/h/desk"] time')).toBeVisible();

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
    await page.goto('/h/books');
    await waitForLoaded(page);
    // Books opens on its collection radar (ADR-117): the ledger is always there.
    await expect(page.locator('#mny-ledger')).toBeVisible();

    // Old space-scoped lens bookmarks 308 to the space-less lens.
    await page.goto('/h/playwright/desk');
    await page.waitForURL(/\/h\/desk\/?$/);
    await waitForLoaded(page);
    // Lens headers were unified to the shared LensHeader (.lenshead) in a6cd10e.
    await expect(page.locator('.lenshead').first()).toBeVisible();

    // Project detail proves the read path: session survived, RLS let the
    // conversations through, the count renders. Entities stay space-scoped.
    await page.goto('/h/playwright/project/zzz-difusion/');
    await waitForLoaded(page);
    // The count rides in the block's head: «Conversations · 12» (ADR-139 § 4).
    const countLabel = page.locator('#rel-stub-title .block-head__n');
    await expect(countLabel).toBeVisible();
    await expect(countLabel).toHaveText(/^\d+$/);
    expect(await page.locator('.rel-stub__item').count()).toBeGreaterThan(0);

    // Calendar month grid (the bare /h/planner opens on the Temporada, ADR-117).
    await page.goto('/h/planner?view=month');
    await waitForLoaded(page);
    await expect(page.locator('.cal__grid')).toBeVisible();
    expect(await page.locator('.cal__weekday').count()).toBe(7);

    // Conversations.
    await page.goto('/h/conversations?etiqueta=sales');
    await waitForLoaded(page);
    await expect(page.locator('.status-bar__count')).toContainText(/\d+ conversations/);
    expect(await page.locator('[data-testid="conversation-row"]').count()).toBeGreaterThan(0);
  });
});
