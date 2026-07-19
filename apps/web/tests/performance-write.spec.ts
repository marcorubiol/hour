import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * The session arrives from the shared storageState (tests/auth.setup.ts), so
 * there is no sign-in here — but the tests below drive the API from inside
 * the page with relative URLs, and about:blank has no origin to resolve them
 * against. Land on a real page first.
 */
async function openApp(page: Page) {
  // ADR-067: the Planner lens is space-less (scope rides in pins/?scope=).
  await page.goto('/h/planner');
}

/**
 * E2E — performance write path (ADR-043): create a gig from the calendar,
 * then edit status + schedule on the detail page.
 *
 * Everything happens in the test user's own `playwright` workspace
 * (project zzz-e2e-collab, created by collab.spec's fixture bootstrap) —
 * invisible to every other workspace. Created gigs use a unique date per
 * run, so slugs never collide.
 *
 * Self-cleaning (ADR-052): the final test deletes the run's gigs — one
 * through the UI confirm dialog (exercising the delete path), the rest
 * via the API. No more e2e-venue-* accumulation, no manual MCP purge.
 */

/** Unique day per run inside 2032 — keeps fixture slugs collision-free. */
function runDay(): string {
  const dayOfYear = Math.floor((Date.now() / 86_400_000) % 365) + 1;
  const d = new Date(Date.UTC(2032, 0, 1));
  d.setUTCDate(dayOfYear);
  const iso = d.toISOString().slice(0, 10);
  return iso;
}

test.describe('performance write path', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  // Serial: the delete test consumes the gig the create test makes, and
  // the sweep must not race the create/ordering tests (fullyParallel is
  // on globally). Same idiom as collab.spec.ts.
  test.describe.configure({ mode: 'serial' });

  test('create from calendar → detail → status + schedule edits persist', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const day = runDay();
    const venue = `E2E Venue ${Date.now()}`;

    await page.goto('/h/planner'); // ADR-067: lens is space-less
    await expect(page.locator('.cal__grid')).toBeVisible();

    // Create from the header button (ADR-078: unified dialog — pick the
    // Performance type pill, then the shared PerformanceForm).
    await page.getByRole('button', { name: 'Add to calendar', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('group', { name: 'Type' })
      .getByRole('button', { name: 'Performance', exact: true })
      .click();
    await dialog.getByLabel('Project').selectOption({ label: 'ZZZ e2e collab' });
    await dialog.getByLabel('Date').fill(day);
    await dialog.getByLabel('Venue').fill(venue);
    await dialog.getByLabel('City').fill('Testville');
    await dialog.getByRole('button', { name: 'Create performance' }).click();

    // Creation navigates to the new performance detail.
    await page.waitForURL(/\/h\/playwright\/performance\/e2e-venue-/);
    await expect(page.locator('.perf__title')).toContainText(venue);

    // Status: proposed → confirmed via the status menu.
    await page.getByRole('button', { name: 'Change status' }).click();
    await page.getByRole('menuitem', { name: 'confirmed', exact: true }).click();
    await expect(page.locator('.state-badge')).toContainText('confirmed', {
      timeout: 10_000,
    });

    // Schedule: set load in + start through the edit dialog.
    await page.getByRole('button', { name: 'Edit details' }).click();
    const edit = page.locator('dialog[open]');
    await edit.locator('#f-loadin').fill(`${day}T11:00`);
    await edit.locator('#f-start').fill(`${day}T19:30`);
    await edit.getByRole('button', { name: 'Save', exact: true }).click();

    // The schedule table renders both slots after the refetch.
    await expect(page.locator('.schedule')).toContainText('load in', {
      timeout: 10_000,
    });
    await expect(page.locator('.schedule')).toContainText('19:30');

    // Reload — everything survived the round-trip.
    await page.reload();
    await expect(page.locator('.state-badge')).toContainText('confirmed');
    await expect(page.locator('.schedule')).toContainText('11:00');

    // The gig shows up on its calendar day.
    await page.goto('/h/planner'); // ADR-067: lens is space-less
    // Navigate to the right month (2032 — click next until the chip shows,
    // bounded). Cheaper: assert via API that the row exists with the data.
    const raw = await page.evaluate(
      async ({ d }) => {
        const res = await fetch(`/api/performances?status=any&from=${d}&to=${d}`);
        const data = (await res.json()) as {
          items: Array<{ venue_name: string | null; status: string; load_in_at: string | null }>;
        };
        return data.items;
      },
      { d: day },
    );
    const created = raw.find((i) => i.venue_name === venue);
    expect(created).toBeTruthy();
    expect(created!.status).toBe('confirmed');
    expect(created!.load_in_at).toBeTruthy();
  });

  test('timeslot ordering violation surfaces as a clear error', async ({ page }) => {
    await openApp(page);
    const day = runDay();
    // The DB CHECK orders ADJACENT pairs (NULL-safe — partial schedules
    // are legal, so load-in + wrap with gaps in between never violates).
    // soundcheck before load-in IS adjacent → must bounce with a 400.
    const result = await page.evaluate(
      async ({ d }) => {
        // Find the run's created performance (previous test) or any fixture gig.
        const list = await fetch(`/api/performances?status=any&from=${d}&to=${d}`);
        const items = ((await list.json()) as { items: Array<{ id: string }> }).items;
        if (items.length === 0) return { skipped: true, status: 0 };
        const res = await fetch(`/api/performances/${items[0].id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            load_in_at: `${d}T20:00:00.000Z`,
            soundcheck_at: `${d}T10:00:00.000Z`,
          }),
        });
        return { skipped: false, status: res.status, body: await res.json() };
      },
      { d: day },
    );
    if (result.skipped) test.skip(true, 'no fixture gig for this run');
    expect(result.status).toBe(400);
  });

  test('delete performance: UI confirm removes the gig, API sweeps the rest (ADR-052)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openApp(page);
    const day = runDay();

    // CRITICAL: scope every list to the `playwright` fixture workspace AND
    // the fixture venue prefix. The test user is admin of `muk-cia` (real
    // production data) — an unscoped date query would return, and the
    // sweep would hard-delete, any real gig that happens to share the run
    // day. Never let this test see a row it didn't create.
    const fixture = await page.evaluate(
      async ({ d }) => {
        const ws = await fetch('/api/workspaces');
        const workspaces = ((await ws.json()) as { items: Array<{ id: string; slug: string }> })
          .items;
        const wsId = workspaces.find((w) => w.slug === 'playwright')?.id ?? '';
        if (!wsId) return { wsId: '', items: [] as Array<{ id: string; slug: string | null; venue_name: string | null }> };
        const res = await fetch(
          `/api/performances?status=any&from=${d}&to=${d}&workspace_ids=${wsId}`,
        );
        const data = (await res.json()) as {
          items: Array<{ id: string; slug: string | null; venue_name: string | null }>;
        };
        // Only rows this suite created (E2E Venue prefix, ADR-043 create test).
        const mine = data.items.filter((i) => i.venue_name?.startsWith('E2E Venue'));
        return { wsId, items: mine };
      },
      { d: day },
    );
    if (!fixture.wsId) test.skip(true, 'playwright workspace not resolved');
    if (fixture.items.length === 0) test.skip(true, 'no fixture gig for this run');

    // Delete the first one through the UI: edit dialog → danger zone →
    // confirm dialog → lands on the planner.
    const first = fixture.items[0];
    await page.goto(`/h/playwright/performance/${first.slug ?? first.id}`);
    await page.getByRole('button', { name: 'Edit details' }).click();
    const edit = page.locator('dialog[open]').filter({ hasText: 'Edit performance' });
    await edit.getByRole('button', { name: 'Delete performance…' }).click();
    const confirm = page
      .locator('dialog[open]')
      .filter({ hasText: 'There is no undo from the UI.' });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    // ADR-067: delete returns to the space-less Planner lens.
    await page.waitForURL(/\/h\/calendar/, { timeout: 15_000 });

    // Sweep the remainder — still workspace + prefix scoped, never touching
    // any workspace but `playwright`.
    const sweep = await page.evaluate(
      async ({ d, wsId }) => {
        const listMine = async () => {
          const res = await fetch(
            `/api/performances?status=any&from=${d}&to=${d}&workspace_ids=${wsId}`,
          );
          const data = (await res.json()) as {
            items: Array<{ id: string; venue_name: string | null }>;
          };
          return data.items.filter((i) => i.venue_name?.startsWith('E2E Venue'));
        };
        const statuses: number[] = [];
        for (const item of await listMine()) {
          const del = await fetch(`/api/performances/${item.id}`, {
            method: 'DELETE',
          });
          statuses.push(del.status);
        }
        return { statuses, remaining: (await listMine()).length };
      },
      { d: day, wsId: fixture.wsId },
    );
    expect(sweep.statuses.every((s) => s === 204)).toBe(true);
    expect(sweep.remaining).toBe(0);
  });
});
