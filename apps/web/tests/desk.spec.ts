/**
 * THE DESK AS A DASHBOARD (ADR-117, ADR-121) — four bands, each loading on
 * its own: lo siguiente, te espera, ha cambiado, la temporada.
 *
 * Everything here runs in the `playwright` workspace (`?scope=s:playwright`)
 * and owns what it writes: one ZZZ task, soft-deleted at the end.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL ?? '';
const PASSWORD = process.env.PW_TEST_PASSWORD ?? '';
const RUN_TAG = Date.now().toString(36);
const TASK_TODAY = `ZZZ E2E Desk Today ${RUN_TAG}`;
const TASK_LOOSE = `ZZZ E2E Desk Loose ${RUN_TAG}`;
const DESK = '/h/desk?scope=s:playwright';

async function playwrightWsId(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const ws = await fetch('/api/workspaces');
    return ((await ws.json()) as { items: { id: string; slug: string }[] }).items.find((w) => w.slug === 'playwright')?.id ?? null;
  });
  expect(id, 'playwright workspace reachable').not.toBeNull();
  return id!;
}

async function sweep(page: Page, wsId: string) {
  await page.evaluate(async ({ wsId }) => {
    const res = await fetch(`/api/tasks?workspace_ids=${wsId}&status=any&limit=200`);
    const items = ((await res.json()) as { items: { id: string; title: string }[] }).items;
    for (const t of items.filter((t) => t.title.startsWith('ZZZ E2E Desk'))) {
      await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
    }
  }, { wsId });
}

test.describe.configure({ mode: 'serial' });

test.describe('Desk — the dashboard (ADR-117)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('draws its bands, the doors say their lens, and no key leaks', async ({ page }) => {
    await page.goto(DESK);
    await waitForLoaded(page);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: /^Next up/ })).toBeVisible();
    await expect(main.getByRole('heading', { name: /^Waiting for you/ })).toBeVisible();
    await expect(main.getByRole('heading', { name: /^The season/ })).toBeVisible();
    // «What changed» never disappears (ADR-127 § 4): a line when there is nothing.
    await expect(page.getByTestId('desk-changed')).toBeVisible();
    await expect(page.getByTestId('desk-changed')).toContainText(/Since|Nothing new|\d/);
    await expect(page.getByTestId('door-planner')).toHaveAttribute('href', '/h/planner');
    await expect(page.getByTestId('door-conversations')).toHaveAttribute('href', '/h/conversations');

    // Cuentas exists only with read:money (ADR-117): the door follows the gate.
    const readMoney = await page.evaluate(async () => {
      const r = await fetch('/api/money/access');
      return r.ok ? ((await r.json()) as { read_money: boolean }).read_money : false;
    });
    await expect(page.getByTestId('door-books')).toHaveCount(readMoney ? 1 : 0);
    if (readMoney) await expect(page.getByTestId('door-books')).not.toContainText('·', { timeout: 15_000 });

    // The agenda is the Planner's now: no day banner, no agenda rows.
    await expect(main.locator('.run--agenda')).toHaveCount(0);
    // The composer waits behind its button.
    await expect(page.getByRole('textbox', { name: /new task/i })).toHaveCount(0);
    // A key that does not exist renders itself: none may reach the screen.
    expect(await main.innerText()).not.toMatch(/\b(desk|pulse|overview|lens)\.[a-z_]+/);
  });

  test('a task due today is in «Waiting for you»; «See all» swaps in the list by days', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(DESK);
    const wsId = await playwrightWsId(page);
    await sweep(page, wsId);

    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    // Plus an undated one: «See all» is offered only when the full list has
    // more than the short one (ADR-127 § 5), and «anytime» stays out of it.
    const status = await page.evaluate(
      async ({ wsId, title, loose, today }) => {
        const post = (body: object) =>
          fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const a = await post({ title, workspace_id: wsId, due_at: today });
        const b = await post({ title: loose, workspace_id: wsId });
        return [a.status, b.status];
      },
      { wsId, title: TASK_TODAY, loose: TASK_LOOSE, today },
    );
    expect(status).toEqual([201, 201]);

    await page.goto(DESK);
    await waitForLoaded(page);
    const waits = page.locator('section.waits');
    await expect(waits.getByRole('checkbox', { name: TASK_TODAY })).toBeVisible({ timeout: 10_000 });

    // One list at a time: the full list replaces the short one, never both.
    await waits.getByRole('button', { name: /^See all by day/ }).click();
    await expect(waits.getByRole('checkbox', { name: TASK_TODAY })).toHaveCount(1);
    await expect(waits.locator('.bucket--today')).toBeVisible();
    await expect(waits.getByRole('checkbox', { name: TASK_LOOSE })).toHaveCount(1);
    // The swap leaves the focus on the band's heading, not on <body>.
    await expect(waits.getByRole('heading', { name: /^Waiting for you/ })).toBeFocused();
    await waits.getByRole('button', { name: 'See less' }).click();
    await expect(waits.getByRole('checkbox', { name: TASK_TODAY })).toHaveCount(1);

    await sweep(page, wsId);
  });

  test('«+ Task» opens the composer in place', async ({ page }) => {
    await page.goto(DESK);
    await waitForLoaded(page);
    const add = page.getByRole('button', { name: '+ Task' });
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await add.click();
    await expect(add).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('textbox', { name: /new task/i })).toBeFocused();
    // Escape folds it back, and the focus returns to its button.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: /new task/i })).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('the visit is written on the way out, so «since» has a start next time', async ({ page }) => {
    await page.goto(DESK);
    await waitForLoaded(page);
    await page.evaluate(() => localStorage.removeItem('hour.desk.last-visit'));
    await page.goto('/h/planner');
    await page.waitForURL(/\/h\/planner/);
    const stored = await page.evaluate(() => localStorage.getItem('hour.desk.last-visit'));
    expect(stored && Number.isFinite(Date.parse(stored))).toBe(true);
  });

  test('phone: one column in DOM order (focus goes where the eye goes), no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(DESK);
    await waitForLoaded(page);
    const top = async (sel: string) => (await page.locator(sel).first().boundingBox())?.y ?? -1;
    const next = await top('section.next');
    const waits = await top('section.waits');
    const season = await top('section.season');
    expect(next).toBeGreaterThan(0);
    expect(waits).toBeGreaterThan(next);
    expect(season).toBeGreaterThan(waits);
    const changed = await top('section.changed');
    expect(changed).toBeGreaterThan(season);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
