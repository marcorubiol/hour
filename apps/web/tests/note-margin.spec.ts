import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * THE MARGIN — the private post-it, written from the Planner (ADR-093).
 *
 * The titular piece of ADR-093 had no E2E until 2026-08-27. The RLS suite
 * covered the table and `person.spec.ts` covered the note on a person's
 * dossier, so what nobody guarded was the thing the ADR is actually about:
 * writing a note ON A DAY from the diary, and the anchor it lands on.
 *
 * ── The law this pins (the three branches of one rule) ────────────────
 * The margin never asks a question it can answer. `AgendaList` builds the
 * day's anchor options from the rows that day already draws, and:
 *   · ONE entry  → no question. The anchor comes filled, as a word.
 *   · SEVERAL    → a `select`, plus the fallback as its last option.
 *   · NONE       → the fallback alone, again as a word.
 * The fallback is the scope, resolved by the Planner (`noteFallback`): a lone
 * project or line becomes that anchor, otherwise the pinned space, and only
 * with nothing pinned at all does it mean «the company».
 *
 * A note anchored to a date must come back carrying that `date_id`, and one
 * that fell back must come back carrying NO calendar anchor at all — that is
 * the half a UI assertion cannot see, so it is read from the API.
 *
 * ── Safety ────────────────────────────────────────────────────────────
 * Everything happens in the `playwright` fixture workspace, scoped by URL
 * token, on rows this run created and titled with its own timestamp. The test
 * user is admin of `muk-cia` (REAL production data): never widen these
 * filters. Notes are author-scoped by RLS, so the sweep can only reach its
 * own. Self-cleaning per ADR-052.
 *
 * Run it against a deployed origin (`PW_BASE_URL`), never `vite preview`.
 */

/** The e2e fixture workspace token (same one date-edit.spec.ts uses). */
const FIXTURE_SPACE_TOKEN = 's:playwright';
/** zzz-e2e-collab — the fixture's one stable project. */
const FIXTURE_PROJECT_ID = '019f21d2-7482-77e6-9ad9-27d881cff305';

/**
 * A DAY THIS RUN OWNS, and the diary is asked which one rather than told.
 *
 * The first branch of the law needs a day with EXACTLY ONE entry, and today is
 * not that day: the fixture space already carries whatever the last run left
 * and whatever else is on file, so a spec that assumed «today is empty» would
 * quietly test the picker branch and report the filled-anchor one as green.
 *
 * So the day is chosen by the only authority on it — the diary itself. A day
 * the agenda draws NO row for is a day with nothing on it; an empty stretch
 * collapses into a week band and the `[data-day]` never appears. Candidates
 * start at today+2 (clear of anything the day view or another spec is holding)
 * and stay inside the window the diary has already loaded forward.
 */
function dayPlus(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

async function pickEmptyDay(page: Page): Promise<string> {
  for (let n = 2; n <= 10; n += 1) {
    const iso = dayPlus(n);
    if ((await page.locator('main').locator(`[data-day="${iso}"]`).count()) === 0) return iso;
  }
  throw new Error('no empty day in the next ten — the fixture space is unexpectedly full');
}

/** Every row this spec writes carries it — see the stale sweep. */
const MARKER = 'E2E Margin';

type Created = { id: string };

/**
 * WHAT A FAILED RUN LEFT BEHIND, cleared before this one starts.
 *
 * ADR-052 asks a spec to clean up after itself, and the last test does. But a
 * run that dies in the middle never reaches it, and while this file was being
 * written that happened four times — the residue was found by hand afterwards.
 * A self-cleaning spec that only cleans when it passes is not self-cleaning, so
 * the sweep runs at both ends. Scoped to the fixture project and to rows
 * carrying this file's marker; notes are author-scoped by RLS on top of that.
 */
async function sweepStale(page: Page): Promise<number> {
  return page.evaluate(
    async ({ proj, marker }) => {
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
      let gone = 0;
      const dates = (await (
        await fetch(`/api/dates?project_ids=${proj}&from=${from}&to=${to}&limit=300`)
      ).json()) as { items?: Array<{ id: string; title: string | null }> };
      for (const row of dates.items ?? []) {
        if (!(row.title ?? '').startsWith(marker)) continue;
        await fetch(`/api/dates/${row.id}`, { method: 'DELETE' });
        gone += 1;
      }
      const notes = (await (await fetch(`/api/notes?from=${from}&to=${to}`)).json()) as {
        items?: Array<{ id: string; body: string }>;
      };
      for (const row of notes.items ?? []) {
        if (!(row.body ?? '').startsWith(marker)) continue;
        await fetch(`/api/notes/${row.id}`, { method: 'DELETE' });
        gone += 1;
      }
      return gone;
    },
    { proj: FIXTURE_PROJECT_ID, marker: MARKER },
  );
}

async function createFixtureDate(
  page: Page,
  title: string,
  day: string,
): Promise<{ status: number; raw: string; date: Created | null }> {
  return page.evaluate(
    async ({ t, d, projectId }) => {
      const res = await fetch('/api/dates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          kind: 'rehearsal',
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
      const raw = await res.text();
      let parsed: { date?: { id: string } } = {};
      try {
        parsed = JSON.parse(raw) as { date?: { id: string } };
      } catch {
        /* the raw text is the evidence */
      }
      return { status: res.status, raw: raw.slice(0, 300), date: parsed.date ?? null };
    },
    { t: title, d: day, projectId: FIXTURE_PROJECT_ID },
  );
}

type ApiNote = {
  id: string;
  body: string;
  on_day: string;
  workspace_id: string | null;
  project_id: string | null;
  line_id: string | null;
  performance_id: string | null;
  date_id: string | null;
};

/** MY notes on one day, straight from the feed — the truth after a write. */
async function readNotes(page: Page, day: string): Promise<ApiNote[]> {
  return page.evaluate(async (d) => {
    const res = await fetch(`/api/notes?from=${d}&to=${d}`);
    const data = (await res.json()) as { items?: ApiNote[] };
    return data.items ?? [];
  }, day);
}

test.describe('the margin — a private post-it on a day (ADR-093)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  // Serial: each test writes into the day the one before it set up, and the
  // last one sweeps. Also the suite's own rule — one workspace, one worker.
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now();
  /** Chosen in the first test, once the diary has told us which day is free. */
  let day = '';
  const titleA = `${MARKER} A ${stamp}`;
  const titleB = `${MARKER} B ${stamp}`;
  // One marker on every row this file writes, dates and notes alike, so the
  // stale sweep below can recognise its own leavings without guessing.
  const bodyOne = `${MARKER} one entry ${stamp}`;
  const bodyChosen = `${MARKER} chosen entry ${stamp}`;
  const bodyFallback = `${MARKER} no entry ${stamp}`;
  let dateA: Created | null = null;
  let dateB: Created | null = null;

  /** The day's section in the diary — `main`, never the rail: since ADR-096
      the pulse draws a Slip too, and this file is not the first to learn it. */
  const dayCell = (page: Page) => page.locator('main').locator(`[data-day="${day}"]`);

  /**
   * The anchor options are built from THE ROWS THE DAY ALREADY DRAWS, so the
   * writer can only be asked about an entry the diary has actually painted.
   * Waiting for the row is the precondition, not a sleep dressed up as one:
   * open the writer too early and it truthfully answers «the company», which
   * would read as the fallback branch passing when nothing was tested.
   */
  async function waitForEntry(page: Page, title: string) {
    const cell = dayCell(page);
    await expect(cell, 'the diary did not draw the fixture day').toBeVisible({ timeout: 20_000 });
    await expect(
      cell.locator('.slip', { hasText: title }),
      `the diary never drew «${title}»`,
    ).toBeVisible({ timeout: 20_000 });
  }

  async function openWriter(page: Page) {
    const cell = dayCell(page);
    await expect(cell, 'the diary did not draw the fixture day').toBeVisible({ timeout: 20_000 });
    await cell.locator('.ag__note-add').click();
    await expect(cell.locator('.ag__note-input')).toBeVisible();
  }

  async function write(page: Page, body: string) {
    const input = dayCell(page).locator('.ag__note-input');
    await input.fill(body);
    // Enter saves, Shift+Enter is a newline (`noteKeydown`). There is no
    // submit button: the margin is a hand writing, not a form.
    await input.press('Enter');
    await expect(dayCell(page).locator('.ag__note-body', { hasText: body })).toBeVisible({
      timeout: 15_000,
    });
  }

  test('ONE ENTRY ON THE DAY — the anchor comes filled, and it is not a question', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // Navigate FIRST: the fixture is created with the page's own session, and
    // a relative `fetch` needs an origin to be relative to.
    await page.goto(`/h/planner?view=agenda&scope=${FIXTURE_SPACE_TOKEN}`);
    const stale = await sweepStale(page);
    if (stale > 0) {
      // Not a failure — a previous run died mid-way. Said out loud so it is
      // visible rather than silently absorbed.
      console.log(`[note-margin] cleared ${stale} row(s) a previous run left behind`);
      await page.reload();
    }
    await expect(page.locator('main [data-day]').first()).toBeVisible({ timeout: 20_000 });
    day = await pickEmptyDay(page);

    const madeA = await createFixtureDate(page, titleA, day);
    expect(madeA.date, `fixture date A was not created: ${madeA.status} ${madeA.raw}`).toBeTruthy();
    dateA = madeA.date;
    await page.reload();
    await waitForEntry(page, titleA);

    const cell = dayCell(page);
    // The premise, asserted instead of assumed: this day holds exactly one
    // entry, so the branch under test is the one that actually runs.
    await expect(cell.locator('.slip'), 'the day did not end up with one entry').toHaveCount(1);

    await openWriter(page);
    // A word, not a picker: with one option there is nothing to choose.
    await expect(cell.locator('select.ag__note-anchor')).toHaveCount(0);
    await expect(cell.locator('.ag__note-anchorword')).toHaveText(titleA);

    await write(page, bodyOne);

    // THE HALF THE SCREEN CANNOT SHOW: the note landed on that date, not
    // merely on that day.
    const note = (await readNotes(page, day)).find((n) => n.body === bodyOne);
    expect(note, 'the note was not stored').toBeTruthy();
    expect(note!.date_id, 'the filled anchor was not the one that was saved').toBe(dateA!.id);
    expect(note!.performance_id).toBeNull();
  });

  test('SEVERAL ENTRIES — a picker appears, and the choice is what is saved', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/h/planner?view=agenda&scope=${FIXTURE_SPACE_TOKEN}`);
    const madeB = await createFixtureDate(page, titleB, day);
    expect(madeB.date, `fixture date B was not created: ${madeB.status} ${madeB.raw}`).toBeTruthy();
    dateB = madeB.date;
    await page.reload();
    await waitForEntry(page, titleB);
    // Two entries and the note the first test left — the slips are the two.
    await expect(dayCell(page).locator('.slip')).toHaveCount(2);

    await openWriter(page);
    const select = dayCell(page).locator('select.ag__note-anchor');
    await expect(select, 'two entries did not produce a picker').toBeVisible();
    // The two entries AND the fallback — the margin always leaves a way to say
    // «this is about the day, not about any of these».
    await expect(select.locator('option')).toHaveCount(3);

    await select.selectOption({ label: titleB });
    await write(page, bodyChosen);

    const note = (await readNotes(page, day)).find((n) => n.body === bodyChosen);
    expect(note, 'the note was not stored').toBeTruthy();
    expect(note!.date_id, 'the chosen anchor was not the one that was saved').toBe(dateB!.id);
  });

  test('THE FALLBACK — a note about no entry falls to the scope, not to the air', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/h/planner?view=agenda&scope=${FIXTURE_SPACE_TOKEN}`);
    await waitForEntry(page, titleB);
    await openWriter(page);

    // '' is the fallback option's value (`AgendaList`: '' = the scope).
    await dayCell(page).locator('select.ag__note-anchor').selectOption('');
    await write(page, bodyFallback);

    const note = (await readNotes(page, day)).find((n) => n.body === bodyFallback);
    expect(note, 'the note was not stored').toBeTruthy();
    expect(note!.date_id, 'the fallback still anchored to a calendar row').toBeNull();
    expect(note!.performance_id).toBeNull();
    // Scoped to the fixture SPACE, so the Planner's fallback resolves to that
    // workspace — a note is never homeless, which is what «the company» means.
    expect(
      note!.workspace_id ?? note!.project_id ?? note!.line_id,
      'the fallback left the note with no home at all',
    ).toBeTruthy();
  });

  test('the sweep leaves nothing behind (ADR-052)', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/h/planner?view=agenda&scope=${FIXTURE_SPACE_TOKEN}`);
    const cell = dayCell(page);
    await expect(cell).toBeVisible({ timeout: 20_000 });

    // Deleted through the UI, because the × is part of the margin too.
    for (const body of [bodyOne, bodyChosen, bodyFallback]) {
      const note = cell.locator('.ag__note', { hasText: body });
      await expect(note, `«${body}» was not on the day`).toBeVisible({ timeout: 15_000 });
      await note.locator('.ag__note-x').click();
      await expect(note).toBeHidden({ timeout: 15_000 });
    }

    const left = await readNotes(page, day);
    expect(
      left.filter((n) => n.body.endsWith(String(stamp))),
      'a note from this run survived the sweep',
    ).toHaveLength(0);

    for (const d of [dateA, dateB]) {
      if (!d) continue;
      const status = await page.evaluate(
        async (id) => (await fetch(`/api/dates/${id}`, { method: 'DELETE' })).status,
        d.id,
      );
      expect(status, 'the fixture date did not go').toBeLessThan(300);
    }
  });
});
