import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — engagement inline write path on the Contacts lens (ADR-040/044;
 * moved off the retired /booking wrapper in ADR-056 cleanup).
 *
 * Both tests write to a REAL engagement row (the difusión list). Original
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

type RawEngagement = {
  id: string;
  status: string;
  next_action_at: string | null;
  next_action_note: string | null;
  person: { full_name: string | null } | null;
};

/** Session comes from the shared storageState (tests/auth.setup.ts). */
async function openContacts(page: Page, searchName?: string) {
  await page.goto('/h/contacts'); // ADR-067: lens is space-less + cross-space
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
async function fetchListRaw(page: Page): Promise<RawEngagement[]> {
  return await page.evaluate(async () => {
    const res = await fetch(
      '/api/engagements?status=any&project_slug=mamemi&season=2026-27&limit=50',
    );
    const data = (await res.json()) as { items: RawEngagement[] };
    return data.items;
  });
}

/**
 * Direct API restore — UI-independent so it works from a `finally` even if
 * the page is in a broken state. Values pass through the same PATCH
 * whitelist the UI uses (dates must be date-only).
 */
async function restoreEngagement(
  page: Page,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const status = await page.evaluate(
    async ({ id, patch }) => {
      const res = await fetch(`/api/engagements/${id}`, {
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
    (r) => r.request().method() === 'PATCH' && r.url().includes('/api/engagements/'),
  );
  await doClick();
  const r = await resp;
  expect(r.ok(), 'PATCH /api/engagements should succeed').toBe(true);
  const hit = r.url().match(/engagements\/([0-9a-f-]{36})/)?.[1];
  expect(hit, 'probe write must target the captured engagement').toBe(expectedId);
}

test.describe('engagement inline write', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL and PW_TEST_PASSWORD (test user with edit:engagement where the MaMeMi engagements live).',
  );

  test('status change persists and reverts', async ({ page }) => {
    await openContacts(page);

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
      await restoreEngagement(page, original.id, { status: original.status });
    }
  });

  test('next action date + note save, persist and restore', async ({ page }) => {
    await openContacts(page);

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
      await restoreEngagement(page, original.id, restorePatch);
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
});
