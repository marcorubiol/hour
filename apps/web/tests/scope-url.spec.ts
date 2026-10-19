import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { openInFull } from './peek';

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
 * originally failing sequence); and a scoped link to the front door (/h).
 *
 * Fixture-owned data only: the seeded saved scope mixes the `playwright`
 * space token with its own project — never a real user's project ids.
 */

// The e2e fixture workspace + its one stable project (zzz-e2e-collab).
const FIXTURE_SPACE_TOKEN = 's:playwright';
const FIXTURE_PROJECT_TOKEN = 'p:019f21d2-7482-77e6-9ad9-27d881cff305';

test('Everything clears ?scope= from the URL after opening a scoped link', async ({ page }) => {
  await page.goto(`/h/desk?scope=${FIXTURE_SPACE_TOKEN}`);
  await waitForLoaded(page);

  // The scope chip renders once the caches resolve and the token applies.
  await expect(page.locator('.tok').first()).toBeVisible();
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

  // 1. Enter by the front door: /h is the Desk (ADR-137).
  await page.goto('/h');
  await page.waitForURL(/\/h\/desk/, { timeout: 10000 });
  await waitForLoaded(page);

  // 2. Everything → the Desk, clean.
  await page.getByRole('button', { name: /Everything/ }).click();

  // 3. Apply the saved scope from the rail → URL gains ?scope=.
  await page.getByRole('button', { name: /E2E scope/ }).click();
  await expect(page.locator('.tok').first()).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/scope=/, { timeout: 5000 });

  // 4. Everything again → the URL must clean (the bug left it scoped).
  await page.getByRole('button', { name: /Everything/ }).click();
  await expect(page.locator('.tok')).toHaveCount(0, { timeout: 5000 });

  expect(page.url()).not.toContain('scope=');
});

test('a scoped link to the front door keeps its scope on the Desk, and Everything cleans it', async ({ page }) => {
  await page.goto(`/h?scope=${FIXTURE_SPACE_TOKEN}`);
  // /h forwards with its query (ADR-137): the scope arrives on the Desk.
  await page.waitForURL(/\/h\/desk\?scope=s:playwright/, { timeout: 10000 });
  await waitForLoaded(page);
  await expect(page.locator('.tok').first()).toBeVisible();

  await page.getByRole('button', { name: /Everything/ }).click();
  await expect(page.locator('.tok')).toHaveCount(0, { timeout: 5000 });

  expect(page.url()).not.toContain('scope=');
});

test('Conversations is a scoped lens and copies its canonical scoped URL', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/h/conversations?scope=${FIXTURE_SPACE_TOKEN}`);
  await waitForLoaded(page);

  await expect(page.locator('.tok').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Conversations', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page).toHaveURL(/\/h\/conversations\?scope=s:playwright$/);

  await page.getByRole('button', { name: /Copy link/ }).click();
  await expect(page.getByText('Link copied — scope included.')).toBeVisible();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
});

test('a scope change on a person opened from Conversations lands back on Conversations', async ({ page }) => {
  // Drop 11-10: off a lens route a scope click went to Desk, so leaving the
  // list for a person and changing the scope threw you out of Conversations.
  await page.goto(`/h/conversations?scope=${FIXTURE_SPACE_TOKEN}`);
  await waitForLoaded(page);
  await expect(page.locator('tbody tr').first()).toBeVisible();

  // The contact's link (ADR-102: the first link of a row is the organization).
  await page.locator('tbody tr').first().locator('td').nth(1).getByRole('link').click();
  // The vistazo first (ADR-139 p1), then the page this test is about.
  await openInFull(page);
  await page.waitForURL(/\/h\/[^/]+\/person\//);
  await waitForLoaded(page);

  await page.getByRole('button', { name: /Everything/ }).click();
  await page.waitForURL(/\/h\/conversations/, { timeout: 10000 });
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Conversations', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
