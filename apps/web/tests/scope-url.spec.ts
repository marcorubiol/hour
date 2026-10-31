import { test, expect, type Page } from '@playwright/test';
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

// The scope is one pill in the lens's title row (ADR-152): «Scope: <name>»
// when scoped, «Scope: Everything. Narrow» when not. The rail's own row is
// the bare word «Everything».
const scopedPill = (page: Page) => page.getByRole('button', { name: /^Scope: (?!Everything)/ });
const everythingPill = (page: Page) => page.getByRole('button', { name: 'Scope: Everything. Narrow' });
const railEverything = (page: Page) => page.getByRole('button', { name: 'Everything', exact: true });

test('Everything clears ?scope= from the URL after opening a scoped link', async ({ page }) => {
  await page.goto(`/h/desk?scope=${FIXTURE_SPACE_TOKEN}`);
  await waitForLoaded(page);

  // The scope pill names the scope once the caches resolve and the token applies.
  await expect(scopedPill(page)).toBeVisible();
  expect(page.url()).toContain('scope=');

  await railEverything(page).click();
  await expect(everythingPill(page)).toBeVisible({ timeout: 5000 });
  await expect(scopedPill(page)).toHaveCount(0);

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
  await railEverything(page).click();

  // 3. Apply the saved scope from the rail → URL gains ?scope=.
  await page.getByRole('button', { name: /E2E scope/ }).click();
  await expect(scopedPill(page)).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/scope=/, { timeout: 5000 });

  // 4. Everything again → the URL must clean (the bug left it scoped).
  await railEverything(page).click();
  await expect(everythingPill(page)).toBeVisible({ timeout: 5000 });
  await expect(scopedPill(page)).toHaveCount(0);

  expect(page.url()).not.toContain('scope=');
});

test('a scoped link to the front door keeps its scope on the Desk, and Everything cleans it', async ({ page }) => {
  await page.goto(`/h?scope=${FIXTURE_SPACE_TOKEN}`);
  // /h forwards with its query (ADR-137): the scope arrives on the Desk.
  await page.waitForURL(/\/h\/desk\?scope=s:playwright/, { timeout: 10000 });
  await waitForLoaded(page);
  await expect(scopedPill(page)).toBeVisible();

  await railEverything(page).click();
  await expect(everythingPill(page)).toBeVisible({ timeout: 5000 });
  await expect(scopedPill(page)).toHaveCount(0);

  expect(page.url()).not.toContain('scope=');
});

test('Conversations is a scoped lens and copies its canonical scoped URL', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/h/conversations?scope=${FIXTURE_SPACE_TOKEN}`);
  await waitForLoaded(page);

  await expect(scopedPill(page)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Conversations', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page).toHaveURL(/\/h\/conversations\?scope=s:playwright$/);

  // Copy link lives in what the pill opens: a dialog named «Scope».
  await scopedPill(page).click();
  const dialog = page.getByRole('dialog', { name: 'Scope' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Link copied — scope included.')).toBeVisible();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
});

test('a scope change on a person opened from Conversations lands back on Conversations', async ({ page }) => {
  // Drop 11-10: off a lens route a scope click went to Desk, so leaving the
  // list for a person and changing the scope threw you out of Conversations.
  await page.goto(`/h/conversations?etiqueta=sales&scope=${FIXTURE_SPACE_TOKEN}`);
  await waitForLoaded(page);
  await expect(page.locator('[data-testid="conversation-row"]').first()).toBeVisible();

  // The contact's link (ADR-102: the first link of a row is the organization),
  // on the first row that has one: a run cut short leaves rows without a person.
  await page
    .locator('[data-testid="conversation-row"]')
    .filter({ has: page.locator('a.crow-contact') })
    .first()
    .locator('a.crow-contact')
    .click();
  // The vistazo first (ADR-139 p1), then the page this test is about.
  await openInFull(page);
  await page.waitForURL(/\/h\/[^/]+\/person\//);
  await waitForLoaded(page);

  await railEverything(page).click();
  await page.waitForURL(/\/h\/conversations/, { timeout: 10000 });
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Conversations', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

// 2026-10-20 (prod 4ffc6b6e): with a saved scope, a FULL load of a lens with no
// ?scope= in the address (new tab, reload, the installed app) drew nothing.
// The shell wrote the saved scope into the URL from its first effect run,
// inside SvelteKit's first mount, before the router had its root: replaceState
// threw «reading '$set'» and the app stayed blank. Every lens, both kinds of pin.
for (const [lens, token] of [
  ['desk', FIXTURE_SPACE_TOKEN],
  ['conversations', FIXTURE_PROJECT_TOKEN],
  ['planner', FIXTURE_SPACE_TOKEN],
  ['books', FIXTURE_PROJECT_TOKEN],
] as const) {
  test(`a saved scope survives a full load of /h/${lens}: it paints, and the URL takes the scope`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((pin) => {
      // Only the first load: the next one must read what the app saved.
      if (sessionStorage.getItem('e2e-pins-seeded')) return;
      localStorage.setItem('hour_pins', JSON.stringify([pin]));
      sessionStorage.setItem('e2e-pins-seeded', '1');
    }, token);

    await page.goto(`/h/${lens}`);
    await waitForLoaded(page);
    await expect(scopedPill(page), 'the scope pill names the saved scope').toBeVisible();
    await expect(page).toHaveURL(/[?&]scope=/);

    // Again with a bare address, as a new tab or the installed app opens it.
    await page.goto(`/h/${lens}`);
    await waitForLoaded(page);
    await expect(scopedPill(page)).toBeVisible();
    await expect(page).toHaveURL(/[?&]scope=/);
    expect(errors, 'no page error on a full load with a saved scope').toEqual([]);
  });
}

// ADR-152: the scope box above the headline is gone at every width; the pill
// in the title row opens a dialog (a popover from 48 rem, a sheet below)
// with the tokens and the acts, Esc closes it and the focus comes back.
for (const width of [1440, 390] as const) {
  test(`the scope pill opens its dialog and gives the focus back (${width})`, async ({ page }) => {
    const height = width > 400 ? 900 : 844;
    await page.setViewportSize({ width, height });
    await page.goto(`/h/planner?scope=${FIXTURE_SPACE_TOKEN},${FIXTURE_PROJECT_TOKEN}`);
    await waitForLoaded(page);

    const pill = scopedPill(page);
    await expect(pill).toHaveAccessibleName(/^Scope: .+ \+1$/);
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
    // No box above the headline: the pill sits inside the lens's title row.
    await expect(page.locator('.lenshead__titlerow').getByRole('button', { name: /^Scope: / })).toHaveCount(1);

    await pill.click();
    const dialog = page.getByRole('dialog', { name: 'Scope' });
    await expect(dialog).toBeVisible();
    await expect(pill).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByRole('button', { name: /^Remove / })).toHaveCount(2);
    for (const act of ['+ add', 'Copy link', 'Clear']) {
      await expect(dialog.getByRole('button', { name: act, exact: true })).toBeVisible();
    }

    const box = (await dialog.locator('.dialog__panel').boundingBox())!;
    const pillBox = (await pill.boundingBox())!;
    if (width > 400) {
      // A popover hanging from the pill, its right edge on the pill's.
      expect(box.y).toBeGreaterThanOrEqual(pillBox.y + pillBox.height);
      expect(Math.abs(box.x + box.width - (pillBox.x + pillBox.width))).toBeLessThan(2);
    } else {
      // A sheet from below, the whole width.
      expect(Math.round(box.y + box.height)).toBe(height);
      expect(Math.round(box.width)).toBe(width);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(pill).toBeFocused();

    // Removing every token leaves «Everything», with the focus on it and the URL clean.
    await pill.click();
    await dialog.getByRole('button', { name: /^Remove / }).first().click();
    await expect(pill).toHaveAccessibleName(/^Scope: [^+]+$/);
    await dialog.getByRole('button', { name: /^Remove / }).first().click();
    await expect(dialog).toBeHidden();
    await expect(everythingPill(page)).toBeFocused();
    await expect(page).not.toHaveURL(/scope=/);
  });
}
