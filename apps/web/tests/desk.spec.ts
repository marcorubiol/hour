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
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROPOSAL_ADD = `ZZZ E2E Desk Proposal Add ${RUN_TAG}`;
const PROPOSAL_DROP = `ZZZ E2E Desk Proposal Drop ${RUN_TAG}`;

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
    await expect(main.getByRole('heading', { name: /^The season/ })).toBeVisible();
    // A band with nothing in it is not drawn (ADR-145 § 1, amends ADR-127 § 4):
    // «Waiting for you» and «What changed» are there with something in them,
    // and with both quiet Hoy says so once.
    const waits = main.getByRole('heading', { name: /^Waiting for you/ });
    const changed = page.getByTestId('desk-changed');
    const quiet = main.getByText('All caught up.', { exact: true });
    await expect(waits.or(changed).or(quiet).first()).toBeVisible();
    if ((await changed.count()) > 0) await expect(changed).not.toContainText(/Nothing new/);
    if ((await quiet.count()) > 0) {
      await expect(waits).toHaveCount(0);
      await expect(changed).toHaveCount(0);
    }
    await expect(page.getByTestId('door-planner')).toHaveAttribute('href', '/h/planner');
    await expect(page.getByTestId('door-conversations')).toHaveAttribute('href', '/h/conversations?etiqueta=sales');

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

  // ADR-131: «Add» makes an AI proposal a normal task, and it stays one after
  // a reload; «dismiss» removes it. Nothing writes origin='ai' through the API,
  // so the spec turns its own tasks into proposals with the service key.
  test('an AI proposal: «Add» keeps it as a task, «dismiss» removes it', async ({ page }) => {
    test.skip(!SB_URL || !SERVICE_KEY, 'Set PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
    test.setTimeout(90_000);
    await page.goto(DESK);
    const wsId = await playwrightWsId(page);
    await sweep(page, wsId);

    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const ids = await page.evaluate(
      async ({ wsId, titles, today }) => {
        const out: string[] = [];
        for (const title of titles) {
          const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title, workspace_id: wsId, due_at: today }),
          });
          out.push(((await res.json()) as { task: { id: string } }).task.id);
        }
        return out;
      },
      { wsId, titles: [PROPOSAL_ADD, PROPOSAL_DROP], today },
    );
    const res = await fetch(new URL(`/rest/v1/task?id=in.(${ids.join(',')})`, SB_URL), {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY!,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ origin: 'ai', note: 'ZZZ E2E reason' }),
    });
    expect(res.status).toBe(204);

    await page.goto(DESK);
    await waitForLoaded(page);
    const waits = page.locator('section.waits');
    const addRow = waits.locator('li.row--ai', { hasText: PROPOSAL_ADD });
    const dropRow = waits.locator('li.row--ai', { hasText: PROPOSAL_DROP });
    await expect(addRow).toBeVisible({ timeout: 10_000 });
    await expect(dropRow).toBeVisible();

    await addRow.getByRole('button', { name: 'Add' }).click();
    await expect(waits.getByRole('checkbox', { name: PROPOSAL_ADD })).toBeVisible();
    await dropRow.getByRole('button', { name: 'dismiss' }).click();
    await expect(dropRow).toHaveCount(0);
    await expect(waits.getByRole('checkbox', { name: PROPOSAL_DROP })).toHaveCount(0);

    // Persisted: the accepted one is manual; the dismissed one is gone once
    // its «Undo» runs out, and neither is marked done.
    const read = () =>
      page.evaluate(async ({ wsId }) => {
        const r = await fetch(`/api/tasks?workspace_ids=${wsId}&status=any&limit=200`);
        return ((await r.json()) as { items: { title: string; origin: string; status: string }[] }).items;
      }, { wsId });
    await expect
      .poll(async () => (await read()).filter((t) => t.title === PROPOSAL_DROP).length, { timeout: 15_000 })
      .toBe(0);
    const accepted = (await read()).find((t) => t.title === PROPOSAL_ADD);
    expect(accepted).toMatchObject({ origin: 'manual', status: 'open' });

    await page.reload();
    await waitForLoaded(page);
    await expect(waits.getByRole('checkbox', { name: PROPOSAL_ADD })).toBeVisible({ timeout: 10_000 });
    await expect(waits.locator('li.row--ai', { hasText: PROPOSAL_ADD })).toHaveCount(0);

    await sweep(page, wsId);
  });

  // ADR-133: the Planner door counts the Season's «Clashes», by the same rule.
  test('the Planner door says the clashes the Season counts', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/h/planner?scope=s:playwright&view=overview');
    await waitForLoaded(page);
    // The Season counts its clashes in its «Clashes» block, drawn only with
    // something in it (ADR-145 § 1; the census line is gone, fase 2).
    await expect(page.locator('.ov__strip')).toBeVisible({ timeout: 15_000 });
    const head = page.locator('.ov .block-head', { hasText: /^Clashes/ });
    const n = (await head.count()) > 0 ? Number(await head.locator('.block-head__n').innerText()) : 0;

    await page.goto(DESK);
    await waitForLoaded(page);
    const door = page.getByTestId('door-planner');
    await expect(door.locator('.door__n')).toHaveText(/^\d+$/, { timeout: 15_000 });
    if (n > 0) await expect(door).toContainText(`${n} ${n === 1 ? 'clash' : 'clashes'}`);
    else await expect(door).not.toContainText('clash');
  });

  // ADR-133: a show on the card says who goes and opens the editor in its sheet.
  test('«Next up» on a show: the cast line and «Who goes» to the sheet', async ({ page }) => {
    await page.goto(DESK);
    await waitForLoaded(page);
    const card = page.getByTestId('desk-next');
    test.skip((await card.count()) === 0, 'Nothing within two weeks to draw a card for.');
    const who = card.getByRole('link', { name: /^Who goes/ });
    if ((await who.count()) === 0) {
      // Not a show (a trip, a press call): no cast, no link (the Day's law).
      await expect(card.locator('.cast-line')).toHaveCount(0);
      return;
    }
    await expect(who).toHaveAttribute('href', /\/performance\/[^/]+#who-goes$/);
    await expect(card.locator('.cast-line')).toHaveCount(1);
    await who.click();
    await page.waitForURL(/#who-goes$/);
    await expect(page.locator('#who-goes')).toBeVisible();
  });

  // ADR-133: «cobrado» reads payments recorded since the visit, by others only.
  test('the payments feed answers «recorded since, by others»', async ({ page }) => {
    await page.goto(DESK);
    const wsId = await playwrightWsId(page);
    const out = await page.evaluate(async ({ wsId }) => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const ok = await fetch(`/api/payments?workspace_ids=${wsId}&recorded_since=${encodeURIComponent(since)}&others=1`);
      const bad = await fetch(`/api/payments?workspace_ids=${wsId}&recorded_since=yesterday`);
      return { ok: ok.status, items: Array.isArray(((await ok.json()) as { items: unknown }).items), bad: bad.status };
    }, { wsId });
    expect(out).toEqual({ ok: 200, items: true, bad: 400 });
  });

  test('«+» (New task) opens the composer in place', async ({ page }) => {
    await page.goto(DESK);
    await waitForLoaded(page);
    const add = page.getByRole('button', { name: 'New task', exact: true });
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
    // boundingBox() waits for the element: a band that is not drawn must answer at once.
    const top = async (sel: string) => {
      const el = page.locator(sel).first();
      return (await el.count()) ? ((await el.boundingBox())?.y ?? -1) : -1;
    };
    // A band with nothing in it is not drawn (ADR-145 § 1): the order holds
    // among the bands that are there.
    const order = (
      await Promise.all(['section.next', 'section.waits', 'section.season', 'section.changed'].map(top))
    ).filter((y) => y >= 0);
    expect(order[0]).toBeGreaterThan(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
