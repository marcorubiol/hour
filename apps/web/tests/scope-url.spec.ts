import { test, expect } from '@playwright/test';

/**
 * Scope ⇄ URL sync (ADR-067) — regression suite.
 *
 * Born from a real bug (2026-07-17): SvelteKit's replaceState (shallow
 * routing) updates the ADDRESS BAR but not the reactive `page.url`, so the
 * sync effects comparing against page.url went permanently stale after
 * their own writes — clearing pins found ''===null and never cleaned the
 * bar. The effects now read `location.href` for truth and keep page.url
 * only as the navigation trigger. These three flows pin that behavior:
 * inbound scoped link → clear; the rail-applied scope → clear (the
 * originally failing sequence); and clearing from the hall.
 *
 * Fixture-owned data only: the seeded saved scope mixes the `playwright`
 * space token with its own project — never a real user's project ids.
 */

// The e2e fixture workspace + its one stable project (zzz-e2e-collab).
const FIXTURE_SPACE_TOKEN = 's:playwright';
const FIXTURE_PROJECT_TOKEN = 'p:019f21d2-7482-77e6-9ad9-27d881cff305';

test('Everything clears ?scope= from the URL after opening a scoped link', async ({ page }) => {
  await page.goto(`/h/desk?scope=${FIXTURE_SPACE_TOKEN}`);

  // The scope chip renders once the caches resolve and the token applies.
  await expect(page.locator('.tok').first()).toBeVisible({ timeout: 15000 });
  expect(page.url()).toContain('scope=');

  await page.getByRole('button', { name: /Everything/ }).click();
  await expect(page.locator('.tok')).toHaveCount(0, { timeout: 5000 });

  expect(page.url()).not.toContain('scope=');
});

test('rail-applied saved scope, then Everything, cleans the URL (replaceState staleness)', async ({ page }) => {
  // Seed a saved multi-token scope owned by the fixture (space + project).
  await page.addInitScript(
    ([space, project]) => {
      localStorage.setItem(
        'hour_scopes',
        JSON.stringify({
          saved: [{ name: 'E2E scope', tokens: [space, project] }],
          recent: [],
        }),
      );
      localStorage.removeItem('hour_pins');
    },
    [FIXTURE_SPACE_TOKEN, FIXTURE_PROJECT_TOKEN],
  );

  // 1. Land on the hall.
  await page.goto('/h');
  await expect(page.getByRole('region', { name: 'Home' })).toBeVisible({ timeout: 15000 });

  // 2. Everything → lands on /h/desk, clean.
  await page.getByRole('button', { name: /Everything/ }).click();
  await page.waitForURL(/\/h\/desk/, { timeout: 10000 });

  // 3. Apply the saved scope from the rail → URL gains ?scope=.
  await page.getByRole('button', { name: /E2E scope/ }).click();
  await expect(page.locator('.tok').first()).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/scope=/, { timeout: 5000 });

  // 4. Everything again → the URL must clean (the bug left it scoped).
  await page.getByRole('button', { name: /Everything/ }).click();
  await expect(page.locator('.tok')).toHaveCount(0, { timeout: 5000 });

  expect(page.url()).not.toContain('scope=');
});

test('Everything from the HALL with a scoped link also lands clean on /h/desk', async ({ page }) => {
  await page.goto(`/h?scope=${FIXTURE_SPACE_TOKEN}`);
  // Hall greets; the scope applies underneath (no chip on the hall).
  await expect(page.getByRole('region', { name: 'Home' })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: /Everything/ }).click();
  await page.waitForURL(/\/h\/desk/, { timeout: 10000 });
  await expect(page.locator('.tok')).toHaveCount(0, { timeout: 5000 });

  expect(page.url()).not.toContain('scope=');
});
