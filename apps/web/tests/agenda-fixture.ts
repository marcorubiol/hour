import { expect, type Page } from '@playwright/test';

/**
 * A FORTNIGHT THE AGENDA CAN BE JUDGED ON, PLANTED AND TAKEN BACK BY THE RUN.
 *
 * The `playwright` workspace has nothing from today until 2031, so the
 * Agenda's laws that need a case (a trip leg, the amber «Falta», a list long
 * enough to scroll, a ＋ beside a day, «Now» landing on today) skipped on
 * every deploy and were only ever seen by planting performances by hand and
 * deleting them (17-11). This plants them in the spec that needs them and
 * removes them after, so those laws run on every pass.
 *
 * What it plants, on the fixture project `zzz-e2e-collab` only:
 * - a confirmed performance today with no start time and no bolo: «Falta»
 *   (no time, no bolo) inside the two-week window, and today in the diary;
 * - a travel day tomorrow: one leg, never a row;
 * - a confirmed performance on each of the next `FILL_DAYS` days, so the
 *   diary is taller than any screen the suite uses.
 *
 * Every row carries `AGENDA_MARK` (venue for a performance, title for a
 * trip). `plantAgenda` first sweeps rows with the mark that a crashed run
 * left behind, and `clearAgenda` deletes by id and then sweeps again, so a
 * pass never leaves more than it found. Nothing outside the fixture project
 * is read for deletion: the E2E login is also admin of `muk-cia`, whose data
 * is real.
 *
 * The page must already be on an app origin (the fetches are relative and
 * ride the session cookie).
 */

/** zzz-e2e-collab — the stable fixture project of the `playwright` workspace. */
export const AGENDA_PROJECT = '019f21d2-7482-77e6-9ad9-27d881cff305';
export const AGENDA_MARK = 'ZZZ E2E Agenda';
/** Days after today that get a performance each. 12 rows outgrow 844 px. */
const FILL_DAYS = 12;
/** How far the sweep looks: past the fill, with slack for a run across midnight. */
const SWEEP_BACK = 3;
const SWEEP_AHEAD = FILL_DAYS + 5;

export type PlantedAgenda = { performances: string[]; dates: string[]; today: string };

/** Today in the suite's zone (playwright.config `timezoneId`), not UTC's. */
function madridDay(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

type Res = { status: number; json: Record<string, unknown> | null };
function api(page: Page, method: string, path: string, body?: unknown): Promise<Res> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* a 204 */
      }
      return { status: r.status, json };
    },
    { method, path, body },
  );
}

function idOf(r: Res, key: string): string | null {
  const nested = r.json?.[key] as { id?: string } | undefined;
  return nested?.id ?? (r.json?.id as string | undefined) ?? null;
}

/** Deletes every marked row of the fixture project around today. */
async function sweep(page: Page): Promise<void> {
  const from = madridDay(-SWEEP_BACK);
  const to = madridDay(SWEEP_AHEAD);
  const perfs = await api(
    page,
    'GET',
    `/api/performances?project_id=${AGENDA_PROJECT}&status=any&from=${from}&to=${to}&limit=200`,
  );
  const perfItems = (perfs.json?.items as { id: string; venue_name: string | null }[] | undefined) ?? [];
  for (const p of perfItems) {
    if (p.venue_name?.startsWith(AGENDA_MARK)) await api(page, 'DELETE', `/api/performances/${p.id}`);
  }
  const dates = await api(page, 'GET', `/api/dates?project_ids=${AGENDA_PROJECT}&from=${from}&to=${to}&limit=200`);
  const dateItems = (dates.json?.items as { id: string; title: string | null }[] | undefined) ?? [];
  for (const d of dateItems) {
    if (d.title?.startsWith(AGENDA_MARK)) await api(page, 'DELETE', `/api/dates/${d.id}`);
  }
}

export async function plantAgenda(page: Page): Promise<PlantedAgenda> {
  await sweep(page);
  const made: PlantedAgenda = { performances: [], dates: [], today: madridDay() };

  for (let i = 0; i <= FILL_DAYS; i++) {
    const res = await api(page, 'POST', '/api/performances', {
      project_id: AGENDA_PROJECT,
      performed_at: madridDay(i),
      venue_name: `${AGENDA_MARK} ${i}`,
      city: 'Girona',
      country: 'ES',
      status: 'confirmed',
    });
    const id = idOf(res, 'performance');
    expect(id, `planting the performance of day +${i} answered ${res.status}`).toBeTruthy();
    made.performances.push(id!);
  }

  const trip = await api(page, 'POST', '/api/dates', {
    project_id: AGENDA_PROJECT,
    kind: 'travel_day',
    starts_at: `${madridDay(1)}T08:00:00.000Z`,
    ends_at: null,
    all_day: true,
    title: `${AGENDA_MARK} trip`,
    origin_city: 'Barcelona',
    destination_city: 'Girona',
    city: 'Girona',
    status: 'confirmed',
  });
  const tripId = idOf(trip, 'date');
  expect(tripId, `planting the trip answered ${trip.status}`).toBeTruthy();
  made.dates.push(tripId!);

  return made;
}

export async function clearAgenda(page: Page, made: PlantedAgenda | null): Promise<void> {
  for (const id of made?.performances ?? []) await api(page, 'DELETE', `/api/performances/${id}`);
  for (const id of made?.dates ?? []) await api(page, 'DELETE', `/api/dates/${id}`);
  await sweep(page);
}
