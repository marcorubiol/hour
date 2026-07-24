import { test, expect, type Browser, type Page } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — collaborative notes over Yjs (ADR-025, Phase 0.2 collab half).
 *
 * Needs the REAL Worker runtime: the RoadsheetCollab DO lives in
 * hour-collab and is bound cross-worker, which vite preview cannot
 * emulate — run with PW_BASE_URL pointing at a deployment:
 *
 *   PW_BASE_URL=https://hour.zerosense.studio pnpm exec playwright test tests/collab.spec.ts
 *
 * Fixtures: everything lives in the test user's OWN `playwright`
 * workspace (its JWT claim points there, so claim-bound inserts work):
 * project zzz-e2e-collab + performances zzz-e2e-1 / zzz-e2e-2. Created
 * idempotently via PostgREST on first run; invisible to every other
 * workspace by RLS.
 *
 * Covers the 2026-05-09 smoke list (adapted post-rename): two-client
 * convergence, reload restore, notes-column write-back, target isolation,
 * and auth-deny on the upgrade.
 */

const SB_URL = 'https://lqlyorlccnniybezugme.supabase.co';
const SB_ANON = 'sb_publishable_IavZsGp7i04juuafanQk9w_33pFDhNu';

type Fixture = { perf1: string; perf2: string };

async function sbLogin(): Promise<string> {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SB_ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function pg<T>(
  jwt: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; rows: T[] }> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_ANON,
      Authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.text();
  // RPCs return a bare object for single-row results — normalize to array.
  const parsed: unknown = body ? JSON.parse(body) : [];
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as T[];
  return { status: res.status, rows };
}

/** Idempotent fixture: project + two performances in the playwright ws. */
async function ensureFixture(): Promise<Fixture> {
  const jwt = await sbLogin();

  const ws = await pg<{ id: string }>(jwt, 'workspace?slug=eq.playwright&select=id');
  if (ws.rows.length !== 1) throw new Error('playwright workspace not found');
  const wsId = ws.rows[0].id;

  let proj = await pg<{ id: string }>(
    jwt,
    `project?slug=eq.zzz-e2e-collab&workspace_id=eq.${wsId}&select=id`,
  );
  if (proj.rows.length === 0) {
    const created = await pg<{ id: string }>(jwt, 'rpc/create_project', {
      method: 'POST',
      body: JSON.stringify({
        p_workspace_id: wsId,
        p_name: 'ZZZ e2e collab',
        p_slug: 'zzz-e2e-collab',
      }),
    });
    if (created.rows.length === 0) throw new Error('create_project failed');
    proj = created;
  }
  const projectId = proj.rows[0].id;

  const perfs: string[] = [];
  for (const [slug, day] of [
    ['zzz-e2e-1', '2031-01-15'],
    ['zzz-e2e-2', '2031-01-16'],
  ] as const) {
    const existing = await pg<{ id: string }>(
      jwt,
      `performance?slug=eq.${slug}&project_id=eq.${projectId}&select=id`,
    );
    if (existing.rows.length > 0) {
      perfs.push(existing.rows[0].id);
      continue;
    }
    const inserted = await pg<{ id: string }>(jwt, 'performance', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: wsId,
        project_id: projectId,
        slug,
        performed_at: day,
        status: 'proposed',
        venue_name: 'E2E Hall',
        city: 'Testville',
      }),
    });
    if (inserted.rows.length === 0) throw new Error(`insert performance ${slug} failed`);
    perfs.push(inserted.rows[0].id);
  }
  return { perf1: perfs[0], perf2: perfs[1] };
}

/**
 * Two independent clients, both signed in as the test user — that's the
 * point of the test (convergence between them).
 *
 * `browser.newContext()` does NOT inherit the project's storageState, so the
 * shared session (tests/auth.setup.ts) has to be handed over explicitly.
 * Without it both clients would land on /login and this would spend two more
 * logins against the rate limit.
 */
async function openAsClient(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

const notesBox = (page: Page) => page.locator('.ynotes textarea');

test.describe('collaborative notes (Yjs over the RoadsheetCollab DO)', () => {
  // Serial: the fixture bootstrap must run once, not once per worker.
  test.describe.configure({ mode: 'serial' });

  test.skip(
    !EMAIL || !PASSWORD,
    'Set PW_TEST_EMAIL / PW_TEST_PASSWORD (see runbook).',
  );
  test.skip(
    !process.env.PW_BASE_URL,
    'Collab needs the real Worker runtime (cross-worker DO binding) — set PW_BASE_URL to a deployment.',
  );

  let fx: Fixture;
  test.beforeAll(async () => {
    fx = await ensureFixture();
  });

  test('two clients converge, survive reload, and materialize the notes column', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const marker = `e2e-${Date.now()}`;

    const a = await openAsClient(browser, '/h/playwright/performance/zzz-e2e-1');
    const b = await openAsClient(browser, '/h/playwright/performance/zzz-e2e-1');

    await expect(notesBox(a)).toBeVisible();
    await expect(notesBox(b)).toBeVisible();
    // Wait for both providers to report a live connection.
    await expect(a.locator('.ynotes')).toHaveAttribute('data-collab-status', 'live', {
      timeout: 15_000,
    });
    await expect(b.locator('.ynotes')).toHaveAttribute('data-collab-status', 'live', {
      timeout: 15_000,
    });

    // A rewrites the note with this run's marker. The select-all races the
    // provider's initial sync: content restored from the DO can land AFTER
    // the selection and survive the rewrite (observed as residue from prior
    // runs interleaved into the doc). Retry the rewrite until the doc holds
    // exactly this run's text — which also leaves the fixture doc clean for
    // the next run.
    await expect(async () => {
      await notesBox(a).click();
      await notesBox(a).press('ControlOrMeta+a');
      await notesBox(a).pressSequentially(`${marker} from A`, { delay: 10 });
      await expect(notesBox(a)).toHaveValue(`${marker} from A`, { timeout: 3000 });
    }).toPass({ timeout: 45_000 });

    // B converges without touching anything.
    await expect(notesBox(b)).toHaveValue(new RegExp(`${marker} from A`), {
      timeout: 15_000,
    });

    // Presence: B sees someone here (peer count in the meta line).
    await expect(b.locator('.ynotes__status')).toContainText('2 here');

    // B appends — A converges (bidirectional).
    await notesBox(b).click();
    await notesBox(b).press('End');
    await notesBox(b).pressSequentially(' +B', { delay: 10 });
    await expect(notesBox(a)).toHaveValue(new RegExp(`${marker} from A \\+B`), {
      timeout: 15_000,
    });

    // Reload restore: fresh page state, content comes back from the DO.
    await a.reload();
    await expect(notesBox(a)).toHaveValue(new RegExp(marker), { timeout: 15_000 });

    // Column write-back: the DO materializes notes into the performance
    // row after its save debounce (~2s) — poll the detail API.
    await expect
      .poll(
        async () => {
          return await a.evaluate(async (perfId) => {
            const res = await fetch(`/api/performances/${perfId}`);
            if (!res.ok) return `http-${res.status}`;
            const data = (await res.json()) as {
              performance: { notes: string | null };
            };
            return data.performance.notes ?? '';
          }, fx.perf1);
        },
        { timeout: 30_000 },
      )
      .toContain(marker);

    // Target isolation: the sibling performance's doc never sees the marker.
    await b.goto('/h/playwright/performance/zzz-e2e-2');
    await expect(notesBox(b)).toBeVisible();
    await expect(b.locator('.ynotes')).toHaveAttribute('data-collab-status', 'live', {
      timeout: 15_000,
    });
    await b.waitForTimeout(1500);
    await expect(notesBox(b)).not.toHaveValue(new RegExp(marker));

    await a.context().close();
    await b.context().close();
  });

  test('upgrade is denied without a valid token', async ({ browser }) => {
    // Deliberately signed OUT. Two traps here, both learned the hard way:
    //   1. the `page` fixture now carries the suite's shared session
    //      (tests/auth.setup.ts), and post-ADR-061 the socket authenticates
    //      from that cookie — `?token=` is ignored — so it would open;
    //   2. a bare browser.newContext() does NOT help: it inherits the
    //      project's `use`, storageState included (that's also why relative
    //      goto works here). It has to be emptied EXPLICITLY.
    // Without this the test still passes/fails for the wrong reason and
    // asserts nothing. No session → the upgrade must be refused.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/login');
    const result = await page.evaluate(
      ({ perfId }) =>
        new Promise<string>((resolve) => {
          const proto = location.protocol === 'https:' ? 'wss' : 'ws';
          const ws = new WebSocket(
            `${proto}://${location.host}/api/collab/performance/${perfId}?token=garbage`,
          );
          const timer = setTimeout(() => {
            ws.close();
            resolve('timeout');
          }, 8000);
          ws.onopen = () => {
            clearTimeout(timer);
            ws.close();
            resolve('open');
          };
          ws.onerror = () => {
            clearTimeout(timer);
            resolve('denied');
          };
        }),
      { perfId: fx.perf1 },
    );
    expect(result).toBe('denied');
    await context.close();
  });
});
