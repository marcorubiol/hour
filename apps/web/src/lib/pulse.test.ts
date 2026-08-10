/**
 * The pulse — NOW and NEXT for the shell rail.
 *
 * Two things these tests exist to stop. First, an invented hour: the pulse
 * may never print an end it does not have on file, so every «soft» case
 * below asserts `until === null` rather than midnight. Second, the word
 * «free» claimed off ignorance — the person axis drops only what it can
 * rule out, and the `unattributed` case is the one that proves it.
 *
 * Madrid in August is UTC+2, so 15h30 local is 13:30Z throughout.
 */

import { describe, expect, test } from 'vitest';
import { computePulse } from './pulse';
import { buildPersonAttribution } from './people';
import type { DateEvent, PerformanceEvent } from './month-events';

const TZ = 'Europe/Madrid';
const DAY = '2026-08-14';

function perf(over: Partial<PerformanceEvent> = {}): PerformanceEvent {
  return {
    id: 'p1',
    slug: 'p1',
    performed_at: DAY,
    status: 'confirmed',
    start_at: null,
    venue_name: 'Teatre Principal',
    city: null,
    country: null,
    line_id: null,
    project: null,
    venue: null,
    ...over,
  };
}

function date(over: Partial<DateEvent> = {}): DateEvent {
  return {
    id: 'd1',
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: `${DAY}T08:00:00Z`,
    ends_at: null,
    all_day: false,
    venue_name: null,
    city: null,
    project: null,
    venue: null,
    ...over,
  };
}

/** A full sheet: load-in 15h30, soundcheck 17h, show 20h, wrap 23h (local). */
const SHEET = perf({
  load_in_at: `${DAY}T13:30:00Z`,
  soundcheck_at: `${DAY}T15:00:00Z`,
  start_at: `${DAY}T18:00:00Z`,
  wrap_at: `${DAY}T21:00:00Z`,
});

const at = (z: string) => new Date(`${DAY}T${z}Z`);
const pulse = (input: Parameters<typeof computePulse>[0], now: Date) => computePulse(input, now);
const sheetAt = (z: string) =>
  pulse({ performances: [SHEET], dates: [], viewerTz: TZ }, at(z));

describe('now — the day is segments, not events', () => {
  test('before the first moment it is free, until that moment', () => {
    const { now } = sheetAt('06:22:00');
    expect(now.doing).toBeNull();
    expect(now.until?.at).toBe(`${DAY}T13:30:00.000Z`);
  });

  test('between two moments it says the earlier one, until the later', () => {
    const { now } = sheetAt('14:00:00');
    expect(now.doing?.word).toEqual({ of: 'step', key: 'load_in' });
    expect(now.until?.at).toBe(`${DAY}T15:00:00.000Z`);
  });

  test('the last moment runs soft: what you are in, never an invented end', () => {
    const only = perf({ start_at: `${DAY}T18:00:00Z` });
    const { now } = pulse({ performances: [only], dates: [], viewerTz: TZ }, at('20:00:00'));
    expect(now.doing?.word).toEqual({ of: 'step', key: 'start' });
    expect(now.until).toBeNull();
  });

  test('after the sheet is out it is free again, and says nothing about the end', () => {
    const { now } = sheetAt('21:30:00');
    expect(now.doing).toBeNull();
    expect(now.until).toBeNull();
  });

  test('the boundary is dropped when it falls on another day', () => {
    // The only thing ahead starts tomorrow: today has no boundary left.
    const tomorrow = perf({ id: 'p2', performed_at: '2026-08-15', start_at: '2026-08-15T18:00:00Z' });
    const { now } = pulse({ performances: [tomorrow], dates: [], viewerTz: TZ }, at('06:22:00'));
    expect(now.doing).toBeNull();
    expect(now.until).toBeNull();
  });

  test('an all-day row IS the day, and the innermost thing wins', () => {
    const residency = date({
      id: 'r1',
      kind: 'residency',
      all_day: true,
      starts_at: `${DAY}T00:00:00Z`,
      ends_at: `${DAY}T00:00:00Z`,
    });
    const rehearsal = date({
      id: 'r2',
      starts_at: `${DAY}T08:00:00Z`,
      ends_at: `${DAY}T12:00:00Z`,
    });

    const early = pulse({ performances: [], dates: [residency, rehearsal], viewerTz: TZ }, at('05:00:00'));
    expect(early.now.doing?.word).toEqual({ of: 'kind', key: 'residency', label: null });
    expect(early.now.until?.at).toBe(`${DAY}T08:00:00.000Z`);

    const inside = pulse({ performances: [], dates: [residency, rehearsal], viewerTz: TZ }, at('09:00:00'));
    expect(inside.now.doing?.word).toEqual({ of: 'kind', key: 'rehearsal', label: null });
    expect(inside.now.until?.at).toBe(`${DAY}T12:00:00.000Z`);
  });

  test('a cancelled row is not a day', () => {
    const off = perf({ status: 'cancelled', start_at: `${DAY}T18:00:00Z` });
    const { now, next } = pulse({ performances: [off], dates: [], viewerTz: TZ }, at('19:00:00'));
    expect(now.doing).toBeNull();
    expect(next).toBeNull();
  });
});

describe('next — the first moment still ahead', () => {
  test('the call is the first moment on the sheet, whatever it is', () => {
    const { next } = sheetAt('06:22:00');
    expect(next?.at).toBe(`${DAY}T18:00:00Z`);
    expect(next?.call).toBe(`${DAY}T13:30:00Z`);
    expect(next?.today).toBe(true);
    expect(next?.ref.place).toBe('Teatre Principal');
  });

  test('a lone start time is a start, not a call', () => {
    const only = perf({ start_at: `${DAY}T18:00:00Z` });
    const { next } = pulse({ performances: [only], dates: [], viewerTz: TZ }, at('06:00:00'));
    expect(next?.call).toBeNull();
  });

  test('the gig you are loading in for is still what comes next', () => {
    const { now, next } = sheetAt('14:00:00');
    expect(now.doing?.word).toEqual({ of: 'step', key: 'load_in' });
    expect(next?.ref.id).toBe('p1');
    expect(next?.at).toBe(`${DAY}T18:00:00Z`);
  });

  test('an untimed gig today stays ahead until the day is out', () => {
    const untimed = perf({ start_at: null });
    const { next } = pulse({ performances: [untimed], dates: [], viewerTz: TZ }, at('19:00:00'));
    expect(next?.ref.id).toBe('p1');
    expect(next?.at).toBeNull();
    expect(next?.today).toBe(true);
  });

  test('an all-day row you are already inside is the NOW row, not the NEXT one', () => {
    const dayOff = date({ kind: 'day_off', all_day: true, starts_at: `${DAY}T00:00:00Z` });
    const { now, next } = pulse({ performances: [], dates: [dayOff], viewerTz: TZ }, at('09:00:00'));
    expect(now.doing?.word).toEqual({ of: 'kind', key: 'day_off', label: null });
    expect(next).toBeNull();
  });

  test('another day is named as another day', () => {
    const later = perf({ id: 'p9', performed_at: '2026-08-20', start_at: '2026-08-20T18:00:00Z' });
    const { next } = pulse({ performances: [later], dates: [], viewerTz: TZ }, at('06:22:00'));
    expect(next?.day).toBe('2026-08-20');
    expect(next?.today).toBe(false);
  });

  test('nothing ahead is null, not an empty shape', () => {
    expect(sheetAt('23:59:00').next).toBeNull();
  });
});

describe('whose day it is', () => {
  const ME = 'me';
  const OTHER = 'other';
  const PROJECT = { id: 'pr1', slug: 'pr', name: 'Project', workspace_id: 'w1' };

  const axisFor = (projectIds: string[]) =>
    buildPersonAttribution({
      pinnedPersonIds: [ME],
      team: [{ person_id: ME, workspace_id: 'w1', slug: 'me', full_name: 'Me', project_ids: projectIds }],
      blocks: [],
    });

  test('a roster that names somebody else drops the row', () => {
    const theirs = perf({
      project: PROJECT,
      start_at: `${DAY}T18:00:00Z`,
      person_ids: [OTHER],
    });
    const { now, next } = pulse(
      { performances: [theirs], dates: [], viewerTz: TZ, axis: axisFor(['pr1']) },
      at('06:00:00'),
    );
    expect(next).toBeNull();
    expect(now.until).toBeNull();
  });

  test('a roster that names you is a fact', () => {
    const mine = perf({ project: PROJECT, start_at: `${DAY}T18:00:00Z`, person_ids: [ME, OTHER] });
    const { next } = pulse(
      { performances: [mine], dates: [], viewerTz: TZ, axis: axisFor(['pr1']) },
      at('06:00:00'),
    );
    expect(next?.ref.attribution).toBe('explicit');
  });

  test('your project, nobody cast: kept, and marked as the guess it is', () => {
    const rehearsal = date({ project: PROJECT, starts_at: `${DAY}T10:00:00Z` });
    const { next } = pulse(
      { performances: [], dates: [rehearsal], viewerTz: TZ, axis: axisFor(['pr1']) },
      at('06:00:00'),
    );
    expect(next?.ref.attribution).toBe('inferred');
  });

  test('NOBODY on file is not «not yours» — the row survives, so «free» stays honest', () => {
    // The company has no cast anywhere: every row is unattributed. A filter
    // would drop them all and the rail would draw an empty evening on top of
    // a full one. This is the case that made the four-state verdict exist.
    const blind = perf({ project: PROJECT, start_at: `${DAY}T18:00:00Z` });
    const { next } = pulse(
      { performances: [blind], dates: [], viewerTz: TZ, axis: axisFor([]) },
      at('06:00:00'),
    );
    expect(next?.ref.id).toBe('p1');
    expect(next?.ref.attribution).toBe('unattributed');
  });

  test('an inactive axis speaks for the whole company, unmarked', () => {
    const theirs = perf({ project: PROJECT, start_at: `${DAY}T18:00:00Z`, person_ids: [OTHER] });
    const { next } = pulse(
      {
        performances: [theirs],
        dates: [],
        viewerTz: TZ,
        axis: buildPersonAttribution({ pinnedPersonIds: [], team: [], blocks: [] }),
      },
      at('06:00:00'),
    );
    expect(next?.ref.attribution).toBe('explicit');
  });

  test('inference stops at the door of an absence', () => {
    const rehearsal = date({ project: PROJECT, starts_at: `${DAY}T10:00:00Z` });
    const away = buildPersonAttribution({
      pinnedPersonIds: [ME],
      team: [
        { person_id: ME, workspace_id: 'w1', slug: 'me', full_name: 'Me', project_ids: ['pr1'] },
      ],
      blocks: [{ person_id: ME, starts_on: DAY, ends_on: DAY }],
    });
    const { next } = pulse(
      { performances: [], dates: [rehearsal], viewerTz: TZ, axis: away },
      at('06:00:00'),
    );
    // Not inferred onto a day you are away — and not dropped either: with
    // nobody left to guess from the row is unattributed, which is the truth.
    expect(next?.ref.attribution).toBe('unattributed');
  });
});
