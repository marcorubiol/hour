import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — tasks (ADR-068, D3): the Desk quick-add creates a free workspace
 * task, completing it drops it off the open feed; the Tasks line module
 * round-trips add-module → create → complete (done fold) → remove.
 *
 * Scoping (ADR-052 discipline): every task is created in the playwright
 * workspace with a ZZZ prefix and soft-deleted through the API; sweeps are
 * bound to that workspace. The stable `ZZZ E2E Modules` line fixture
 * (created by line-detail.spec) hosts the module test — if it doesn't
 * exist yet, that test skips rather than minting a second fixture line.
 */

// Unique per run: a crashed earlier run leaves its task painted in the
// already-mounted feed, and a same-name locator can click the stale row —
// whose id the sweep just soft-deleted (PATCH → 0 rows → 404).
const RUN_TAG = Date.now().toString(36);
const TASK_FREE = `ZZZ E2E Free Task ${RUN_TAG}`;
const TASK_LINE = `ZZZ E2E Line Task ${RUN_TAG}`;
const LINE_NAME = 'ZZZ E2E Modules';

/** Give the context an origin before in-page fetches (ADR-067: Desk is space-less). */
async function openApp(page: Page) {
  await page.goto('/h/desk?scope=s:playwright');
}

async function playwrightWsId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const ws = await fetch('/api/workspaces');
    return (
      ((await ws.json()) as { items: { id: string; slug: string }[] }).items.find(
        (w) => w.slug === 'playwright',
      )?.id ?? null
    );
  }) as Promise<string | null>;
}

/** Crash recovery: soft-delete any ZZZ task a killed run left behind. */
async function sweepTasks(page: Page, wsId: string) {
  await page.evaluate(async ({ wsId }) => {
    const res = await fetch(`/api/tasks?workspace_ids=${wsId}&status=any&limit=200`);
    const items = ((await res.json()) as { items: { id: string; title: string }[] }).items;
    for (const t of items.filter((t) => t.title.startsWith('ZZZ E2E'))) {
      await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
    }
  }, { wsId });
}

type LineRow = { id: string; slug: string | null; name: string };

async function findFixtureLine(page: Page): Promise<LineRow | null> {
  return page.evaluate(async ({ name }) => {
    const ws = await fetch('/api/workspaces');
    const wsId = ((await ws.json()) as { items: { id: string; slug: string }[] }).items.find(
      (w) => w.slug === 'playwright',
    )?.id;
    if (!wsId) return null;
    const res = await fetch(`/api/lines?workspace_ids=${wsId}&status=any`);
    const items = ((await res.json()) as { items: LineRow[] }).items;
    return items.find((l) => l.name === name) ?? null;
  }, { name: LINE_NAME }) as Promise<LineRow | null>;
}

test.describe.configure({ mode: 'serial' });

test.describe('tasks — Desk feed + line module', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('Desk quick-add creates a free task; completing it leaves the open feed', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openApp(page);
    const wsId = await playwrightWsId(page);
    expect(wsId, 'playwright workspace reachable').not.toBeNull();
    await sweepTasks(page, wsId!);

    // The scoped URL makes the fixture workspace the composer's explicit
    // default. Assert that visible contract before writing anything.
    const title = page.getByRole('textbox', { name: /add a loose end/i });
    const composer = page.locator('form').filter({ has: title });
    await title.fill(TASK_FREE);
    await expect(composer).toContainText(/playwright/i);
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST',
      ),
      composer.getByRole('button', { name: /^add$/i }).click(),
    ]);
    expect(created.status()).toBe(201);

    const row = page.getByRole('checkbox', { name: TASK_FREE });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Complete it — server-ack the PATCH (the optimistic paint alone proves
    // nothing), then the open-only feed drops the row.
    const [patched] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/tasks\//.test(r.url()) && r.request().method() === 'PATCH',
      ),
      row.check(),
    ]);
    expect(patched.status()).toBe(200);
    await expect(row).not.toBeVisible({ timeout: 10_000 });

    // Verify done through the API, then self-clean.
    const check = await page.evaluate(async ({ wsId, title }) => {
      const res = await fetch(`/api/tasks?workspace_ids=${wsId}&status=any&limit=200`);
      const items = (
        (await res.json()) as { items: { id: string; title: string; status: string }[] }
      ).items;
      const mine = items.find((t) => t.title === title);
      if (!mine) return { found: false as const };
      const del = await fetch(`/api/tasks/${mine.id}`, { method: 'DELETE' });
      return { found: true as const, status: mine.status, delStatus: del.status };
    }, { wsId: wsId!, title: TASK_FREE });

    expect(check.found).toBe(true);
    if (check.found) {
      expect(check.status).toBe('done');
      expect(check.delStatus).toBe(204);
    }
  });

  test('Tasks line module: add module → create → complete → remove', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    const line = await findFixtureLine(page);
    test.skip(!line, `${LINE_NAME} fixture not created yet — run line-detail.spec first.`);
    const wsId = await playwrightWsId(page);
    await sweepTasks(page, wsId!);

    // Crash recovery: reset the stack to the fixture's booking shape (no
    // tasks module) so the add-module step below is always real coverage.
    await page.evaluate(async ({ lineId }) => {
      await fetch(`/api/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modules: ['conversations', 'planner', 'materials', 'notes'] }),
      });
    }, { lineId: line!.id });

    await page.goto(`/h/playwright/project/zzz-e2e-collab/line/${line!.slug ?? line!.id}`);
    await expect(page.getByRole('heading', { name: LINE_NAME })).toBeVisible({
      timeout: 15_000,
    });

    // Add the Tasks module through the menu.
    await page.getByRole('button', { name: /add module/i }).click();
    await page.getByRole('menuitem', { name: /Tasks/ }).click();
    const mod = page.locator('#mod-tasks');
    await expect(mod).toBeVisible({ timeout: 10_000 });

    // Create a task in the module — line_id auto-assigned by context.
    await mod.getByRole('textbox', { name: /add a loose end/i }).fill(TASK_LINE);
    await mod.getByLabel(/due/i).fill('2030-01-15');
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST',
      ),
      mod.getByRole('button', { name: /^add$/i }).click(),
    ]);
    expect(created.status()).toBe(201);
    const body = (await created.json()) as { task: { line_id: string | null } };
    expect(body.task.line_id).toBe(line!.id);

    const row = mod.getByRole('checkbox', { name: TASK_LINE });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Complete → the row moves behind the done fold.
    const [patched] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/tasks\//.test(r.url()) && r.request().method() === 'PATCH',
      ),
      mod.getByText(TASK_LINE, { exact: true }).click(),
    ]);
    expect(patched.status()).toBe(200);
    await mod.getByRole('button', { name: /show 1 done/i }).click();
    await expect(mod.getByRole('checkbox', { name: TASK_LINE })).toBeChecked({
      timeout: 10_000,
    });

    // Remove the task (self-clean), then the module — full round-trip.
    const [deleted] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/tasks\//.test(r.url()) && r.request().method() === 'DELETE',
      ),
      mod.getByRole('button', { name: `Remove task: ${TASK_LINE}` }).click(),
    ]);
    expect(deleted.status()).toBe(204);

    await mod.getByRole('button', { name: /module actions/i }).click();
    await page.getByRole('menuitem', { name: /remove module/i }).click();
    await expect(mod).not.toBeVisible({ timeout: 10_000 });
  });
});
