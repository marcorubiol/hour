import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * GREEN against production since 2026-07-30 (runtime `0f8e12f`), on its
 * first real run. It was written on 2026-07-25 and carried a "NEVER RUN"
 * banner until then: the credential that supposedly returned "Invalid
 * credentials" was fine all along — what was broken was the TARGET, since
 * `.env.local` points a local build at a local Supabase where the fixture
 * users do not exist. Run it against a deployed origin (`PW_BASE_URL`),
 * never against `vite preview`, which has no `platform.env` and therefore
 * no Supabase at all.
 *
 * The old banner's warning earned itself, so it is kept as history: the
 * first run went red, and it was the SPEC that was wrong, not the app —
 * see `runDay()`. `money.spec.ts` had the same story on 2026-07-24
 * (unrun, and asserting the opposite of the product rule). Read the
 * failure before touching the app.
 *
 * ── What it pins ──────────────────────────────────────────────────────
 * The write path that existed but was unreachable until task 15: PATCH
 * and DELETE /api/dates/:id were built, whitelisted and gated, and no
 * component ever called them. Rehearsals, press days, residencies, days
 * off and travel days could be created and never opened again.
 *
 * The load-bearing assertion is the SILENT one: saving a date without
 * touching its time must leave `starts_at` byte-identical. The dialog
 * shows venue-local wall time (ADR-078 §11) and converts back on save; if
 * the prefill ever reads the stored instant raw, every save shifts the
 * hour by the workspace's UTC offset — invisible in the dialog, wrong on
 * the grid, and it would have to be discovered in production.
 *
 * ── Safety ────────────────────────────────────────────────────────────
 * Everything happens in the `playwright` fixture workspace, scoped by URL
 * token, on rows carrying a unique title this run created. The test user
 * is admin of `muk-cia` (REAL production data): an unscoped list here
 * would return real rehearsals, and the sweep would delete them. Never
 * widen these filters. Self-cleaning per ADR-052.
 */

/** The e2e fixture workspace token (same one scope-url.spec.ts uses). */
const FIXTURE_SPACE_TOKEN = 's:playwright';
/** zzz-e2e-collab — the fixture's one stable project. */
const FIXTURE_PROJECT_ID = '019f21d2-7482-77e6-9ad9-27d881cff305';

/**
 * TODAY — the only day BOTH projections show without navigation, which is
 * what a test opening the same dialog from two of them needs.
 *
 * The day has to be one the two views land on by themselves, and their
 * windows are not the same shape: the month draws the whole current month (so
 * any day of it works), while the agenda is a diary that OPENS ON TODAY and
 * runs forward — `agendaFromIso = todayIso`, with earlier days behind a
 * "load earlier".
 *
 * (Since ADR-095 §9 the planner DOES take `?ym=YYYY-MM`, so the month half of
 * this could now be navigated instead of waited for. The agenda half still
 * cannot — a continuous book has no month to name — so `today` remains the
 * only intersection and this spec keeps its rule.)
 * The intersection is today onwards, and only today is guaranteed to be
 * inside the current month too (today+2 falls into next month at a month
 * end, which the month view would then need a click to reach).
 *
 * This is what the first run of this file caught: the 15th of the current
 * month passed the month test and failed the agenda one for 15 days out of
 * every 30 — visible in one drawing, behind the fold in the other. The app
 * is right (a diary starts where you are); the day was wrong.
 */
function runDay(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`;
}

type CreatedDate = { id: string; starts_at: string };

async function createFixtureDate(
  page: Page,
  title: string,
  day: string,
): Promise<{ status: number; date: CreatedDate | null }> {
  return page.evaluate(
    async ({ t, d, projectId }) => {
      const res = await fetch('/api/dates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          kind: 'rehearsal',
          // 09:00Z — a real instant, so the wall-clock roundtrip has an
          // offset to get wrong. Midnight would hide the whole bug class.
          starts_at: `${d}T09:00:00.000Z`,
          ends_at: null,
          all_day: false,
          title: t,
          venue_name: null,
          city: 'Testville',
          status: 'tentative',
          line_id: null,
          performance_id: null,
        }),
      });
      const body = (await res.json()) as { date?: CreatedDate };
      return { status: res.status, date: body.date ?? null };
    },
    { t: title, d: day, projectId: FIXTURE_PROJECT_ID },
  );
}

/** One date row by id, straight from the feed — the truth after a write. */
async function readDate(page: Page, id: string, day: string) {
  return page.evaluate(
    async ({ rowId, d, projectId }) => {
      const res = await fetch(`/api/dates?project_ids=${projectId}&from=${d}&to=${d}&limit=200`);
      const data = (await res.json()) as {
        items: Array<{
          id: string;
          title: string | null;
          status: string;
          kind: string;
          city: string | null;
          starts_at: string;
        }>;
      };
      return data.items.find((i) => i.id === rowId) ?? null;
    },
    { rowId: id, d: day, projectId: FIXTURE_PROJECT_ID },
  );
}

test.describe('date edit path (task 15)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  // Serial: test 2 opens the row test 1 created, test 3 deletes it.
  test.describe.configure({ mode: 'serial' });

  const title = `E2E Date ${Date.now()}`;
  const day = runDay();
  let created: CreatedDate | null = null;

  test('month chip opens the dialog; an untouched save never moves the hour', async ({ page }) => {
    test.setTimeout(90_000);

    // Land on a real page first so the relative fetch resolves an origin.
    await page.goto(`/h/planner?view=month&scope=${FIXTURE_SPACE_TOKEN}`);
    await expect(page.locator('.cal__grid')).toBeVisible({ timeout: 15_000 });

    const made = await createFixtureDate(page, title, day);
    expect(made.status, 'fixture date created').toBe(201);
    created = made.date;
    expect(created?.id).toBeTruthy();
    const storedAt = created!.starts_at;

    await page.reload();
    await expect(page.locator('.cal__grid')).toBeVisible({ timeout: 15_000 });

    // The chip is the openable date card carrying this run's title. Since
    // ADR-095 §0 the month draws ONE object for both primitives — `Slip` — and
    // a slip with no page of its own IS the button, so there is no inner hit
    // target any more. (`.cal__event--date` + `button.cal__event-hit` was the
    // DateChip markup, which now survives only for multi-day series.)
    const chip = page.locator('button.slip', { hasText: title });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Edit date');

    // Save with the time untouched — the roundtrip guard. Change only the
    // title and the status, both of which are timezone-innocent.
    const edited = `${title} edited`;
    await dialog.getByLabel('Title').fill(edited);
    await dialog.getByLabel('Status').selectOption('confirmed');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const after = await readDate(page, created!.id, day);
    expect(after, 'row still there after the patch').toBeTruthy();
    expect(after!.title).toBe(edited);
    expect(after!.status).toBe('confirmed');
    // THE assertion: the hour survived a save that never touched it.
    expect(after!.starts_at).toBe(storedAt);

    // And the grid shows the edit after a reload, not just the API.
    await page.reload();
    await expect(page.locator('button.slip', { hasText: edited })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('the agenda opens the same dialog — a kind change clears what the old kind carried', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    if (!created) test.skip(true, 'no fixture date from the first test');

    await page.goto(`/h/planner?view=agenda&scope=${FIXTURE_SPACE_TOKEN}`);
    // THE DIARY DRAWS THE MONTH'S SLIP now (ADR-095 §0) — `ag__row` was the
    // second implementation of one card and died with the rework, so the row
    // is located as what it is, and by the kind the slip itself declares.
    //
    // AND IT IS LOOKED FOR INSIDE `main`, because the diary is no longer the
    // only place that draws this object. Since ADR-096 the rail's pulse draws
    // a slip too — whatever is next — and this spec's fixture date IS what is
    // next for as long as it exists, so an unscoped `.slip` resolved to two on
    // 2026-08-27 and the test died of strict mode. The furniture lives in the
    // `complementary`, the diary in `main`; the day the pulse and the diary
    // agree is exactly the day the distinction matters.
    const diary = page.locator('main');
    const row = diary.locator('.slip', { hasText: title });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    // rehearsal → travel day: the direction segment appears, and the
    // endpoint must accept a direction it previously would have rejected.
    await dialog.getByRole('button', { name: 'Travel', exact: true }).click();
    await dialog.getByRole('button', { name: 'Return', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const after = await readDate(page, created!.id, day);
    expect(after!.kind).toBe('travel_day');

    // Back to a rehearsal — the endpoint clears travel_direction on the
    // way out instead of tripping the DB CHECK (a 400 here means the
    // kind-scoped field rode along when it shouldn't have).
    // `main` again, and for a sharper reason than above: this one carries
    // `.first()`, so a pulse slip would not have failed — it would have been
    // CLICKED, and the pulse's slip is a link to the day, not the dialog.
    await diary.locator('.slip[data-kind="travel_day"]', { hasText: 'Testville' }).first().click();
    const back = page.locator('dialog[open]');
    await expect(back).toBeVisible();
    await back.getByRole('button', { name: 'Rehearsal', exact: true }).click();
    await back.getByRole('button', { name: 'Save changes' }).click();
    await expect(back).toBeHidden({ timeout: 10_000 });

    expect((await readDate(page, created!.id, day))!.kind).toBe('rehearsal');
  });

  test('delete needs two presses, and the sweep leaves nothing behind (ADR-052)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/h/planner?view=month&scope=${FIXTURE_SPACE_TOKEN}`);
    await expect(page.locator('.cal__grid')).toBeVisible({ timeout: 15_000 });

    if (created) {
      const chip = page.locator('button.slip', { hasText: title });
      await expect(chip).toBeVisible({ timeout: 15_000 });
      await chip.click();

      const dialog = page.locator('dialog[open]');
      const del = dialog.getByRole('button', { name: 'Delete', exact: true });
      await del.click();
      // First press only ARMS it — the row must still be there.
      await expect(dialog).toBeVisible();
      expect(await readDate(page, created.id, day)).toBeTruthy();

      await dialog.getByRole('button', { name: 'Delete for good?' }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      expect(await readDate(page, created.id, day)).toBeNull();
    }

    // Sweep any leftover from a run that died mid-flight. Scoped to the
    // fixture project AND this suite's title prefix — never a real row.
    const sweep = await page.evaluate(
      async ({ d, projectId }) => {
        const listMine = async () => {
          const res = await fetch(
            `/api/dates?project_ids=${projectId}&from=${d}&to=${d}&limit=200`,
          );
          const data = (await res.json()) as {
            items: Array<{ id: string; title: string | null }>;
          };
          return data.items.filter((i) => i.title?.startsWith('E2E Date '));
        };
        const statuses: number[] = [];
        for (const item of await listMine()) {
          const res = await fetch(`/api/dates/${item.id}`, { method: 'DELETE' });
          statuses.push(res.status);
        }
        return { statuses, remaining: (await listMine()).length };
      },
      { d: day, projectId: FIXTURE_PROJECT_ID },
    );
    expect(sweep.statuses.every((s) => s === 204)).toBe(true);
    expect(sweep.remaining).toBe(0);
  });
});
