import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — conversation inline write path on the Conversations lens (ADR-040/044;
 * moved off the retired /booking wrapper in ADR-056 cleanup).
 *
 * Both tests write to a REAL conversation row (the difusión list). Original
 * values are captured via the API up front and restored in a `finally`
 * with a direct API call, so a mid-test failure (or a CI retry) cannot
 * leave probe data behind. Net data change is zero up to the editor's own
 * normalization (date-only next_action_at, trimmed/nulled note);
 * `updated_at` bumps and audit_log rows appear — the cost of testing a
 * real write.
 *
 * The working row is located by person name (captured up front), not by
 * position — writes can reorder the list (it sorts by next_action_at,
 * then updated_at).
 */

type RawConversation = {
  id: string;
  status: string;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  person: { full_name: string | null } | null;
};

/** Session comes from the shared storageState (tests/auth.setup.ts). */
async function openConversations(page: Page, searchName?: string) {
  await page.goto('/h/conversations'); // ADR-067: lens is space-less + cross-space
  if (searchName) {
    // The lens is pins-scoped (unscoped = everything RLS allows) — narrow
    // to the target person server-side so the row is on the first page.
    await page.getByPlaceholder('People or organizations…').fill(searchName);
  }
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

function rowByName(page: Page, name: string) {
  return page.locator('tbody tr', { hasText: name }).first();
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
    const res = await fetch(`/api/conversations?status=any&limit=100&q=${'ZZZ E2E write'}`);
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
        `/api/conversations?status=any&limit=100&q=${encodeURIComponent('ZZZ E2E write fixture')}`,
      ).then((r) => r.json())) as { items: Array<{ id: string }> };
      if (found.items?.[0]?.id) return found.items[0].id;
      throw new Error(`could not create or find the fixture (${res.status})`);
    }, projectId);
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

  test('status change persists and reverts', async ({ page }) => {
    await openConversations(page);

    const original = (await fetchListRaw(page))[0];
    const name = original.person?.full_name;
    expect(name).toBeTruthy();
    // Narrow the lens to the person server-side (unscoped lens = every
    // workspace; the row must be on page 1 and unambiguous).
    await page.getByPlaceholder('People or organizations…').fill(name!);

    try {
      const row = rowByName(page, name!);
      const trigger = row.locator('button[aria-haspopup="menu"]');
      const originalLabel = (await trigger.innerText()).replace('▾', '').trim();
      const target = original.status === 'hold' ? 'Dormant' : 'Hold';

      // Change status via the badge menu; require the server ack.
      await trigger.click();
      await patchOk(page, original.id, () =>
        page.getByRole('menuitem', { name: target, exact: true }).click(),
      );
      await expect(trigger).toContainText(target);
      await expect(row.locator('.last-contact')).toContainText('today');

      const touched = (await fetchListRaw(page)).find((item) => item.id === original.id);
      expect(touched?.first_contacted_at).toBeTruthy();
      expect(Date.parse(touched?.last_contacted_at ?? '')).toBeGreaterThanOrEqual(
        Date.parse(original.last_contacted_at ?? '1970-01-01T00:00:00Z'),
      );

      // PATCH acked above — reload proves the change survives a fresh fetch.
      await page.reload();
      await page.getByPlaceholder('People or organizations…').fill(name!);
      await expect(
        rowByName(page, name!).locator('button[aria-haspopup="menu"]'),
      ).toContainText(target);

      // Revert to the original status through the UI (exercises the same
      // path in the opposite direction).
      const triggerAfter = rowByName(page, name!).locator(
        'button[aria-haspopup="menu"]',
      );
      await triggerAfter.click();
      await patchOk(page, original.id, () =>
        page.getByRole('menuitem', { name: originalLabel, exact: true }).click(),
      );
      await expect(triggerAfter).toContainText(originalLabel);

      await page.reload();
      await page.getByPlaceholder('People or organizations…').fill(name!);
      await expect(
        rowByName(page, name!).locator('button[aria-haspopup="menu"]'),
      ).toContainText(originalLabel);
    } finally {
      // Safety net: unconditional API restore (no-op when the UI revert
      // already ran). Survives a dead page mid-test and CI retries.
      await restoreConversation(page, original.id, { status: original.status });
    }
  });

  test('next action date + note save, persist and restore', async ({ page }) => {
    await openConversations(page);

    const original = (await fetchListRaw(page))[0];
    const name = original.person?.full_name;
    expect(name).toBeTruthy();
    await page.getByPlaceholder('People or organizations…').fill(name!);

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
      await rowByName(page, name!).locator('button.next-action').click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Date').fill('2020-01-01');
      await dialog.locator('#next-action-note').fill('e2e probe — will be reverted');
      await patchOk(page, original.id, () =>
        dialog.getByRole('button', { name: 'Save' }).click(),
      );

      await expect(
        rowByName(page, name!).locator('.next-action__note'),
      ).toContainText('e2e probe');

      await page.reload();
      await page.getByPlaceholder('People or organizations…').fill(name!);
      await expect(
        rowByName(page, name!).locator('.next-action__note'),
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

  test('contacted today uses the server clock and persists', async ({ page }) => {
    await openConversations(page);

    const original = (await fetchListRaw(page))[0];
    const name = original.person?.full_name;
    expect(name).toBeTruthy();
    await page.getByPlaceholder('People or organizations…').fill(name!);

    const row = rowByName(page, name!);
    await row.locator('button[aria-haspopup="menu"]').click();
    const response = await patchOk(page, original.id, () =>
      page.getByRole('menuitem', { name: 'Contacted today', exact: true }).click(),
    );
    expect(response.request().postDataJSON()).toEqual({ contacted_today: true });
    const body = (await response.json()) as { item: RawConversation };
    expect(body.item.first_contacted_at).toBeTruthy();
    expect(body.item.last_contacted_at).toBeTruthy();
    // TWO CLOCKS, AND THE POINT OF THIS TEST IS THAT ONLY ONE OF THEM COUNTS.
    // `<= Date.now()` compares the SERVER's stamp against this laptop's clock
    // with zero tolerance, so it passes only while the local clock happens to
    // run ahead. On 2026-08-11 it drifted 11ms behind and the test went red
    // for good — with nothing wrong anywhere. The law is that the stamp is
    // NOW and not a fabricated date, so it is asserted as a distance.
    const skew = Math.abs(Date.parse(body.item.last_contacted_at!) - Date.now());
    expect(skew, 'the server stamped something that is not now').toBeLessThan(60_000);
    await expect(row.locator('.last-contact')).toContainText('today');

    await page.reload();
    await page.getByPlaceholder('People or organizations…').fill(name!);
    await expect(rowByName(page, name!).locator('.last-contact')).toContainText('today');
  });

  test('contact grouping persists and a project chip focuses its conversation', async ({
    page,
  }) => {
    await openConversations(page);
    const conversationCount = await page.locator('.conversation-table tbody tr').count();

    await page.getByRole('button', { name: 'By contact', exact: true }).click();
    await expect(page.getByRole('button', { name: 'By contact', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.contact-table tbody tr').first()).toBeVisible();
    expect(await page.locator('.contact-table tbody tr').count()).toBeLessThanOrEqual(
      conversationCount,
    );
    expect(
      await page.evaluate(() => localStorage.getItem('hour:conversations:view')),
    ).toBe('contact');

    await page.reload();
    await expect(page.getByRole('button', { name: 'By contact', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('.project-chip').first().click();
    await expect(page.locator('.conversation-table tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Show all loaded' })).toBeVisible();
    await page.getByRole('button', { name: 'Show all loaded' }).click();
    expect(await page.locator('.conversation-table tbody tr').count()).toBeGreaterThan(0);
  });
});
