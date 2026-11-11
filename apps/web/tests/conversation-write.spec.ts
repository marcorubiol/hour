import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { fixtureLine, fixtureLineHref, type FixtureLine } from './fixture-line';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — conversation inline write path of a conversation row (ADR-040/044;
 * moved off the retired /booking wrapper in ADR-056 cleanup).
 *
 * Since ADR-176 the Conversations lens draws chat rows with no inline
 * controls (no relation menu, next step or history button), and since
 * ADR-177 § 4 the organization's record draws one row per project instead
 * of the table: the inline row lives on in a line's Conversations module
 * (ADR-056), the same ConversationTable. These tests drive it there, on a
 * line of the fixture project that the suite finds or creates (lines have
 * no delete path, so it is stable and reused, like `line-detail.spec.ts`).
 *
 * Both tests write to a REAL conversation row (the difusión list). Original
 * values are captured via the API up front and restored in a `finally`
 * with a direct API call, so a mid-test failure (or a CI retry) cannot
 * leave probe data behind. Net data change is zero up to the editor's own
 * normalization (date-only next_action_at, trimmed/nulled note);
 * `updated_at` bumps and audit_log rows appear — the cost of testing a
 * real write.
 *
 * The working row is the one row of the fixture's own organization (a
 * conversation with only a person gets an organization named after them,
 * ADR-102), so a write cannot reorder it away.
 */

type RawConversation = {
  id: string;
  relation: string;
  not_now_until: string | null;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  person: { full_name: string | null } | null;
  organization: { slug: string } | null;
};

/** The suite's line in the fixture project: its module carries the inline row. */
let line: FixtureLine | null = null;

/**
 * Session comes from the shared storageState (tests/auth.setup.ts). The
 * fixture line's page, whose Conversations module carries the inline row
 * (ConversationTable's normal mode; the lens's chat rows have none).
 */
async function openConversations(page: Page) {
  expect(line, 'the fixture line exists (beforeAll)').not.toBeNull();
  await page.goto(fixtureLineHref(line!));
  await waitForLoaded(page);
  await expect(rowOf(page)).toBeVisible({ timeout: 15_000 });
}

/** The fixture conversation's row in the line's module, and only it. */
function rowOf(page: Page) {
  return page
    .locator('#mod-conversations [data-testid="conversation-row"]')
    .filter({ hasText: 'ZZZ E2E write fixture' })
    .first();
}

/** First page of the difusión list (same rows the lens can reach), raw values. */
/**
 * THIS SUITE OWNS ITS ROW. IT DID NOT, AND THAT WAS A REAL LEAK.
 *
 * Until 2026-08-11 this helper asked for `project_slug=mamemi&season=2026-27`
 * with NO workspace filter, and took `[0]` to mutate. The fixture login is a
 * member of `muk-cia` — Marco's actual company — the fixture workspace holds
 * ZERO conversations, and MaMeMi is a real project there. So every run of the
 * three write tests below stamped `contacted today` on a REAL difusión row:
 * verified after the fact on `Teatre Principal d'Olot`, whose last-contact
 * date this suite overwrote.
 *
 * A test may not read its subject out of the world. It creates one, in the
 * fixture workspace, and deletes it — the shape `conversation-create.spec.ts`
 * already used.
 */
async function fixtureProjectId(page: Page): Promise<string> {
  return await page.evaluate(async (): Promise<string> => {
    type Ws = { id: string; slug: string };
    type Pr = { id: string; slug: string; workspace_id: string };
    const wsBody = (await fetch('/api/workspaces').then((r) => r.json())) as { items: Ws[] };
    const fixture = wsBody.items.find((w) => w.slug === 'playwright');
    if (!fixture) throw new Error('no fixture workspace');
    const prBody = (await fetch('/api/projects?status=active').then((r) => r.json())) as {
      items: Pr[];
    };
    const project = prBody.items.find(
      (pr) => pr.workspace_id === fixture.id && pr.slug === 'zzz-e2e-collab',
    );
    if (!project) throw new Error('no fixture project in the fixture workspace');
    return project.id;
  });
}

/** The one row these tests are allowed to touch, created and torn down here. */
let fixtureConversationId: string | null = null;

async function fetchListRaw(page: Page): Promise<RawConversation[]> {
  return await page.evaluate(async (id) => {
    const res = await fetch(`/api/conversations?limit=100&q=${'ZZZ E2E write'}`);
    const data = (await res.json()) as { items: RawConversation[] };
    const mine = data.items.filter((c) => c.id === id);
    if (mine.length === 0) throw new Error('the fixture conversation is not in the list');
    return mine;
  }, fixtureConversationId);
}

/**
 * Direct API restore — UI-independent so it works from a `finally` even if
 * the page is in a broken state. Values pass through the same PATCH
 * whitelist the UI uses (dates must be date-only).
 */
async function restoreConversation(
  page: Page,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const status = await page.evaluate(
    async ({ id, patch }) => {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      return res.status;
    },
    { id, patch },
  );
  expect(status, 'restore PATCH must succeed').toBe(200);
}

/**
 * Run a mutating click and require the PATCH to be acked by the server —
 * otherwise the assertions would certify the optimistic paint only.
 * `expectedId` guards against mis-targeting (review 2026-07-12): the lens
 * is unscoped and a multi-space person renders N same-name rows, so a
 * probe write MUST prove it landed on the row the restore knows about.
 */
async function patchOk(page: Page, expectedId: string, doClick: () => Promise<void>) {
  const resp = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/api/conversations/'),
  );
  await doClick();
  const r = await resp;
  expect(r.ok(), 'PATCH /api/conversations should succeed').toBe(true);
  const hit = r.url().match(/conversations\/([0-9a-f-]{36})/)?.[1];
  expect(hit, 'probe write must target the captured conversation').toBe(expectedId);
  return r;
}

test.describe('conversation inline write', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL and PW_TEST_PASSWORD.');
  // Serial: one fixture row, created once, mutated by each test in turn.
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/h/conversations');
    const projectId = await fixtureProjectId(page);
    const fixture = await fixtureLine(page);
    line = fixture;
    fixtureConversationId = await page.evaluate(async (project_id) => {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id,
          person: { full_name: 'ZZZ E2E write fixture', email: 'zzz-e2e-write@hour.test' },
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { item?: { id: string } };
        if (body.item?.id) return body.item.id;
      }
      // 409 = it is still there from a previous run. A soft-deleted
      // conversation resurrects rather than duplicating (same rule
      // `conversation-create.spec.ts` relies on), so reuse it.
      const found = (await fetch(
        `/api/conversations?limit=100&q=${encodeURIComponent('ZZZ E2E write fixture')}`,
      ).then((r) => r.json())) as { items: Array<{ id: string }> };
      if (found.items?.[0]?.id) return found.items[0].id;
      throw new Error(`could not create or find the fixture (${res.status})`);
    }, projectId);
    // On the line (a row reused from before ADR-177 may have none).
    const linked = await page.evaluate(
      ({ id, line_id }) =>
        fetch(`/api/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ line_id }),
        }).then((r) => r.status),
      { id: fixtureConversationId, line_id: fixture.id },
    );
    expect(linked, 'the fixture conversation goes on the fixture line').toBe(200);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!fixtureConversationId) return;
    const page = await browser.newPage();
    await page.goto('/h/conversations');
    await page.evaluate(
      (id) => fetch(`/api/conversations/${id}`, { method: 'DELETE' }).then(() => undefined),
      fixtureConversationId,
    );
    await page.close();
    fixtureConversationId = null;
  });

  test('«not this time» sets with a day to write again, persists and lifts (ADR-138)', async ({ page }) => {
    // Against production the menu, the dialog and a reload take their time.
    test.setTimeout(60_000);
    await openConversations(page);

    let original = (await fetchListRaw(page))[0];
    // A run that died mid-test (a timeout closes the page before its
    // `finally` restores) leaves the revived fixture in «not this time»:
    // lift it first, so this run starts from a derived state.
    if (original.relation === 'not_now') {
      await restoreConversation(page, original.id, { not_now: null });
      await openConversations(page);
      original = (await fetchListRaw(page))[0];
    }
    const name = original.person?.full_name;
    expect(name).toBeTruthy();

    try {
      const row = rowOf(page);
      const trigger = row.locator('button[aria-haspopup="menu"]');
      // Whatever it derives to now (a fresh fixture: «Not contacted»; one
      // revived from a past run keeps its history), «not this time» wins.
      const originalLabel = (await trigger.innerText()).replace('▾', '').trim();
      expect(originalLabel).not.toMatch(/^Not this time/);

      // The menu offers only «Not this time…»: the relation is derived.
      await trigger.click();
      await expect(page.getByRole('menuitem')).toHaveText(['Not this time…']);
      await page.getByRole('menuitem', { name: 'Not this time…', exact: true }).click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/When to write again/).fill('2099-01-15');
      await patchOk(page, original.id, () => dialog.getByRole('button', { name: 'Save' }).click());
      await expect(trigger).toContainText('Not this time');

      // PATCH acked above — reload proves the change survives a fresh fetch.
      await page.reload();
      await waitForLoaded(page);
      const after = rowOf(page).locator('button[aria-haspopup="menu"]');
      await expect(after).toContainText('Not this time, until');
      const raw = (await fetchListRaw(page)).find((item) => item.id === original.id);
      expect(raw?.relation).toBe('not_now');
      expect(raw?.not_now_until).toBe('2099-01-15');

      // Lift it through the same menu.
      await after.click();
      await patchOk(page, original.id, () =>
        page.getByRole('menuitem', { name: 'Lift «not this time»', exact: true }).click(),
      );
      await expect(after).toHaveText(new RegExp(`^${originalLabel}`));
    } finally {
      // Safety net: unconditional API restore (no-op when the UI lift
      // already ran). Survives a dead page mid-test and CI retries.
      await restoreConversation(page, original.id, { not_now: null });
    }
  });

  test('next action date + note save, persist and restore', async ({ page }) => {
    await openConversations(page);

    const original = (await fetchListRaw(page))[0];
    const name = original.person?.full_name;
    expect(name).toBeTruthy();

    // The restore goes through the same date-only PATCH contract the UI
    // uses, so normalize up front.
    const restorePatch = {
      next_action_at: original.next_action_at?.slice(0, 10) ?? null,
      next_action_note: original.next_action_note?.trim() || null,
    };

    try {
      // Set a probe date + note through the dialog. The probe date is far
      // in the past on purpose: the list sorts next_action_at ASC, so the
      // row stays on page 1 where the assertions can still find it.
      await rowOf(page).locator('button.crow-next').click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Date').fill('2020-01-01');
      await dialog.locator('#next-action-note').fill('e2e probe — will be reverted');
      await patchOk(page, original.id, () =>
        dialog.getByRole('button', { name: 'Save' }).click(),
      );

      await expect(
        rowOf(page).locator('.crow-next__note'),
      ).toContainText('e2e probe');

      await page.reload();
      await waitForLoaded(page);
      await expect(
        rowOf(page).locator('.crow-next__note'),
      ).toContainText('e2e probe');
    } finally {
      await restoreConversation(page, original.id, restorePatch);
    }

    // Verify the restore against the API (raw values) — after a restore
    // the row may fall off page 1 (nulls sort last), so the UI row is not
    // a reliable witness. Dates compare date-only per the editor contract.
    await expect
      .poll(async () => {
        const items = await fetchListRaw(page);
        const item = items.find((i) => i.person?.full_name === name);
        return item
          ? { at: item.next_action_at?.slice(0, 10) ?? null, note: item.next_action_note }
          : null;
      })
      .toEqual({ at: restorePatch.next_action_at, note: restorePatch.next_action_note });
  });

  test('a contact logged from the conversation records an event and the row says today', async ({
    page,
  }) => {
    // ADR-098: a contact is an event. Events are append-only and the fixture
    // resurrects WITH its old history, so this run's note carries its own mark.
    // Logging has two doors since tarea 134 (the composer's «+ Log» and the
    // lens's «+ → Call»); the row's own «Log contact…» and its history dialog
    // are gone, and the last-contact cell leads to the conversation.
    const mark = `ZZZ e2e history ${Date.now().toString(36)}`;
    await openConversations(page);

    const original = (await fetchListRaw(page))[0];
    const name = original.person?.full_name;
    expect(name).toBeTruthy();

    await rowOf(page).locator('a.crow-when').click();
    await waitForLoaded(page);
    await page.getByTestId('composer-to-log').click();
    const form = page.getByTestId('contact-log');
    await expect(form.getByRole('button', { name: 'Call', pressed: true })).toBeVisible();
    await expect(form.getByRole('button', { name: 'Me', pressed: true })).toBeVisible();
    await expect(form.getByRole('button', { name: 'Now', pressed: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'What was said…' }).fill(mark);

    const posted = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes(`/api/conversations/${original.id}/events`),
    );
    await page.getByRole('button', { name: 'Log call' }).click();
    const response = await posted;
    expect(response.status(), 'POST /events should create').toBe(201);
    // Now travels without an instant: the server owns the clock.
    expect(response.request().postDataJSON()).toEqual({
      kind: 'call',
      direction: 'outbound',
      body: mark,
    });
    const { item } = (await response.json()) as { item: { occurred_at: string } };
    const skew = Math.abs(Date.parse(item.occurred_at) - Date.now());
    expect(skew, 'the server stamped something that is not now').toBeLessThan(60_000);

    // A fresh fetch: the event and the stamp both survive.
    await openConversations(page);
    await expect(rowOf(page).locator('.crow-when')).toContainText('today');
  });
});
