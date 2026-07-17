import { test, expect } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — contact capture (ADR-051): add a person + conversation from the
 * Conversations lens, duplicate returns 409, self-clean via DELETE.
 *
 * Fixtures live in the `playwright` workspace (project zzz-e2e-collab).
 * The fixture person (stable zzz e-mail) persists globally — reruns
 * reuse it via the RPC's find-or-create, and the conversation resurrects
 * from its soft-deleted state, so nothing accumulates.
 */

const FIXTURE_NAME = 'ZZZ E2E Contact';
const FIXTURE_EMAIL = 'zzz-e2e-contact@hour.test';

test.describe('contact capture', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('add contact → appears in the lens → duplicate 409 → cleanup', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.goto('/h/conversations'); // ADR-067: lens is space-less + cross-space
    await expect(page.getByRole('button', { name: 'Add conversation' })).toBeVisible();

    // Crash recovery: a run killed after create but before the tail
    // cleanup would leave the fixture conversation live → next run's
    // dialog create 409s and wedges red. Soft-delete any leftover first.
    // (Search is over person name/organization, so query by name then
    // filter by the fixture email.)
    await page.evaluate(async ({ name, email }) => {
      const list = await fetch(
        `/api/conversations?status=any&q=${encodeURIComponent(name)}`,
      );
      const items = (
        (await list.json()) as {
          items: Array<{ id: string; person: { email: string | null } | null }>;
        }
      ).items.filter((i) => i.person?.email === email);
      for (const i of items) {
        await fetch(`/api/conversations/${i.id}`, { method: 'DELETE' });
      }
    }, { name: FIXTURE_NAME, email: FIXTURE_EMAIL });

    // Capture through the dialog.
    await page.getByRole('button', { name: 'Add conversation' }).click();
    const dialog = page.locator('dialog[open]');
    // The dialog is multi-space since ADR-057: projects are checkboxes
    // grouped by workspace, not a single select.
    await dialog.getByLabel('ZZZ e2e collab').check({ force: true });
    await dialog.getByLabel('Full name').fill(FIXTURE_NAME);
    await dialog.getByLabel('Email').fill(FIXTURE_EMAIL);
    await dialog.getByLabel('Organization').fill('E2E Teatre');
    await dialog.getByRole('button', { name: 'Add conversation' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // The new conversation shows up in the lens after the invalidation.
    // (Target the lens search by placeholder — 'Search' also matches the
    // global command bar's aria-label.)
    await page.getByPlaceholder('People or organizations…').fill('ZZZ E2E Contact');
    await expect(page.locator('main')).toContainText(FIXTURE_NAME, {
      timeout: 10_000,
    });

    // Duplicate capture → 409 conversation_exists (no silent merge) — via
    // the API, same surface the dialog uses.
    const apiChecks = await page.evaluate(
      async ({ name, email }) => {
        const headers = {
          'content-type': 'application/json',
        };

        // Locate the created conversation (project + person embedded).
        const list = await fetch(
          `/api/conversations?status=any&q=${encodeURIComponent(name)}`,
          { headers },
        );
        const items = (
          (await list.json()) as {
            items: Array<{ id: string; project_id: string; person: { email: string | null } | null }>;
          }
        ).items;
        const mine = items.find((i) => i.person?.email === email);
        if (!mine) return { found: false as const };

        const dup = await fetch('/api/conversations', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            project_id: mine.project_id,
            person: { full_name: name, email },
          }),
        });

        // Self-clean: soft-delete the conversation (resurrects next run).
        const del = await fetch(`/api/conversations/${mine.id}`, {
          method: 'DELETE',
          headers,
        });

        const after = await fetch(
          `/api/conversations?status=any&q=${encodeURIComponent(name)}`,
          { headers },
        );
        const remaining = (
          (await after.json()) as { items: Array<{ person: { email: string | null } | null }> }
        ).items.filter((i) => i.person?.email === email).length;

        return {
          found: true as const,
          dupStatus: dup.status,
          delStatus: del.status,
          remaining,
        };
      },
      { name: FIXTURE_NAME, email: FIXTURE_EMAIL },
    );

    expect(apiChecks.found).toBe(true);
    if (apiChecks.found) {
      expect(apiChecks.dupStatus).toBe(409);
      expect(apiChecks.delStatus).toBe(204);
      expect(apiChecks.remaining).toBe(0);
    }
  });
});
