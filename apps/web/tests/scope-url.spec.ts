import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

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
// when scoped, «Scope: Everything. Narrow» when not. Since tarea 132 it is the
// scope's only door: the rail no longer lists «Everything», the saved scopes
// or the recents; the pill's dialog does («Clear» is the way back to all).
const scopedPill = (page: Page) => page.getByRole('button', { name: /^Scope: (?!Everything)/ });
const everythingPill = (page: Page) => page.getByRole('button', { name: 'Scope: Everything. Narrow' });
const scopeDialog = (page: Page) => page.getByRole('dialog', { name: 'Scope' });
/** Back to everything, from the pill: what the rail's «Everything» did. */
async function clearScope(page: Page) {
  await scopedPill(page).click();
  await scopeDialog(page).getByRole('button', { name: 'Clear', exact: true }).click();
}

test('Everything clears ?scope= from the URL after opening a scoped link', async ({ page }) => {
  await page.goto(`/h/desk?scope=${FIXTURE_SPACE_TOKEN}`);
  await waitForLoaded(page);

  // The scope pill names the scope once the caches resolve and the token applies.
  await expect(scopedPill(page)).toBeVisible();
  expect(page.url()).toContain('scope=');

  await clearScope(page);
  await expect(everythingPill(page)).toBeVisible({ timeout: 5000 });
  await expect(scopedPill(page)).toHaveCount(0);

  expect(page.url()).not.toContain('scope=');
});

test('pill-applied saved scope, then Everything, cleans the URL (replaceState staleness)', async ({ page }) => {
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

  // 2. Unscoped, the pill opens its dialog with the saved scope listed.
  await everythingPill(page).click();
  await expect(scopeDialog(page).getByRole('heading', { name: 'Saved' })).toBeVisible();

  // 3. Apply the saved scope from the pill → URL gains ?scope=.
  await scopeDialog(page).getByRole('button', { name: /E2E scope/ }).click();
  await expect(scopedPill(page)).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/scope=/, { timeout: 5000 });

  // 4. Everything again → the URL must clean (the bug left it scoped).
  await clearScope(page);
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

  await clearScope(page);
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
  // No long dashes in the copy (ADR-167 § 9).
  await expect(page.getByText('Link copied, scope included.')).toBeVisible();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
});

test('a scope change on a person opened from Conversations lands back on Conversations', async ({ page }) => {
  // Drop 11-10: off a lens route a scope click went to Desk, so leaving the
  // list for a person and changing the scope threw you out of Conversations.
  await page.goto(`/h/conversations?etiqueta=sales&scope=${FIXTURE_SPACE_TOKEN}`);
  await waitForLoaded(page);
  await expect(page.locator('[data-testid="feed-row"]').first()).toBeVisible();

  // Since ADR-176 the lens's chat rows do not link the contact: the person is
  // reached through the organization's record (ADR-159), whose contacts
  // block does (ADR-177 § 4). The lens stays the last one visited, which is what this pins. The
  // first conversation of the space with a contact (a run cut short leaves
  // rows without a person).
  const org = await page.evaluate(async () => {
    const wsBody = (await fetch('/api/workspaces').then((r) => r.json())) as { items: Array<{ id: string; slug: string }> };
    const ws = wsBody.items.find((w) => w.slug === 'playwright');
    if (!ws) throw new Error('no fixture workspace');
    const list = (await fetch(`/api/conversations?etiqueta=sales&workspace_ids=${ws.id}&limit=100`).then((r) => r.json())) as {
      items: Array<{ person: { slug: string | null } | null; organization: { slug: string } | null }>;
    };
    return list.items.find((i) => i.person?.slug && i.organization?.slug)?.organization?.slug ?? null;
  });
  expect(org, 'a fixture conversation with a contact').toBeTruthy();
  await page.goto(`/h/playwright/organization/${encodeURIComponent(org!)}`);
  await waitForLoaded(page);
  // From a record's page the contact's link opens the person's page, not the vistazo.
  await page.getByTestId('organization-contacts').locator('a.organization__row-name').first().click();
  await page.waitForURL(/\/h\/[^/]+\/person\//);
  await waitForLoaded(page);

  // Off a lens there is no pill (ADR-152) and, since tarea 132, no rail of
  // scopes: the scope changes from the search, «narrow» on the space's row.
  await page.getByRole('button', { name: 'Search or jump to a project or line' }).click();
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('textbox').fill('playwright');
  await search.getByRole('button', { name: /^Show only .*playwright/i }).first().click();
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
