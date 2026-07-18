import { describe, expect, it } from 'vitest';
import {
  computeHallStatus,
  hallSentence,
  nextTimedMoment,
  todayMoments,
  type HallConversation,
  type HallPerformance,
  type HallTask,
} from './hall-status';

// Friday 2026-07-17, 10:00 — built with the LOCAL constructor so the
// viewer-calendar-day math is deterministic in any test timezone.
const NOW = new Date(2026, 6, 17, 10, 0, 0);

/** A wall-clock moment `offset` days from NOW's day, as an absolute ISO —
 * built LOCAL like NOW so "after 10:00" holds in any test timezone. */
function atHour(offset: number, hour: number, minute = 0): string {
  return new Date(2026, 6, 17 + offset, hour, minute, 0).toISOString();
}

/** YYYY-MM-DD, `offset` days from NOW's calendar day. */
function isoDay(offset: number): string {
  const d = new Date(2026, 6, 17 + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

/** What PostgREST returns for a date-cast timestamptz (midnight UTC). */
function actionAt(offset: number): string {
  return `${isoDay(offset)}T00:00:00+00:00`;
}

function eng(offset: number | null, status = 'contacted'): HallConversation {
  return { status, next_action_at: offset === null ? null : actionAt(offset) };
}

function task(offset: number | null, status: 'open' | 'done' = 'open'): HallTask {
  return { status, due_at: offset === null ? null : actionAt(offset) };
}

function show(over: Partial<HallPerformance> = {}): HallPerformance {
  return {
    status: 'confirmed',
    performed_at: isoDay(0),
    load_in_at: null,
    start_at: null,
    venue_name: null,
    city: null,
    venue: null,
    project: null,
    ...over,
  };
}

function venue(name: string, timezone: string | null = null) {
  return { name, timezone };
}

const EMPTY = { conversations: [], performances: [], tasks: [] };

describe('computeHallStatus — state selection', () => {
  it('show day outranks overdue attention', () => {
    const status = computeHallStatus(
      {
        conversations: [eng(-3)],
        performances: [
          show({
            venue: venue('Kursaal', 'Europe/London'),
            load_in_at: `${isoDay(0)}T15:00:00+00:00`,
          }),
        ],
        tasks: [],
      },
      NOW,
    );
    expect(status).toEqual({
      kind: 'show',
      place: 'Kursaal',
      at: `${isoDay(0)}T15:00:00+00:00`,
      venueTz: 'Europe/London',
    });
  });

  it('ignores cancelled and non-today performances', () => {
    const status = computeHallStatus(
      {
        conversations: [eng(-3)],
        performances: [show({ status: 'cancelled' }), show({ performed_at: isoDay(1) })],
        tasks: [],
      },
      NOW,
    );
    expect(status.kind).toBe('attention');
  });

  it('show place falls back venue.name → venue_name → city → em dash', () => {
    const at = (p: Partial<HallPerformance>) =>
      computeHallStatus({ ...EMPTY, performances: [show(p)] }, NOW);
    expect(at({ venue: venue('Kursaal'), venue_name: 'x', city: 'y' })).toMatchObject({
      place: 'Kursaal',
    });
    expect(at({ venue_name: 'Ateneu', city: 'y' })).toMatchObject({ place: 'Ateneu' });
    expect(at({ city: 'Manresa' })).toMatchObject({ place: 'Manresa' });
    expect(at({})).toMatchObject({ place: '—' });
  });

  it('picks the earliest timed show of the day; untimed sorts last', () => {
    const status = computeHallStatus(
      {
        ...EMPTY,
        performances: [
          show({ venue_name: 'Late', load_in_at: `${isoDay(0)}T20:00:00+00:00` }),
          show({ venue_name: 'Untimed' }),
          show({ venue_name: 'Early', start_at: `${isoDay(0)}T15:00:00+00:00` }),
        ],
      },
      NOW,
    );
    expect(status).toMatchObject({ kind: 'show', place: 'Early' });
  });

  it('venue-less show falls back to the home-space timezone, never the browser silently', () => {
    const status = computeHallStatus(
      {
        ...EMPTY,
        performances: [
          show({
            city: 'Olot',
            load_in_at: `${isoDay(0)}T15:00:00+00:00`,
            project: { workspace_id: 'ws-1' },
          }),
        ],
        homeTzById: { 'ws-1': 'Europe/Madrid' },
      },
      NOW,
    );
    expect(status).toMatchObject({ kind: 'show', place: 'Olot', venueTz: 'Europe/Madrid' });
  });

  it('show time prefers load_in_at over start_at, null when neither', () => {
    const both = show({ load_in_at: actionAt(0), start_at: `${isoDay(0)}T20:00:00+00:00` });
    expect(computeHallStatus({ ...EMPTY, performances: [both] }, NOW)).toMatchObject({
      at: actionAt(0),
    });
    expect(computeHallStatus({ ...EMPTY, performances: [show()] }, NOW)).toMatchObject({
      at: null,
    });
  });

  it('counts overdue conversations and tasks; oldest wins the age', () => {
    const status = computeHallStatus(
      { conversations: [eng(-5), eng(-1)], performances: [], tasks: [task(-2)] },
      NOW,
    );
    expect(status).toEqual({ kind: 'attention', overdue: 3, oldestDays: 5 });
  });

  it('keeps DeskBoard working-set semantics: declined/dormant/undated conversations and done tasks are out', () => {
    const status = computeHallStatus(
      {
        conversations: [eng(-5, 'declined'), eng(-5, 'dormant'), eng(null)],
        performances: [],
        tasks: [task(-5, 'done')],
      },
      NOW,
    );
    expect(status).toEqual({ kind: 'calm', open: 0, next: null });
  });

  it('an action due today is TODAY, not overdue (day buckets, like the Desk)', () => {
    const status = computeHallStatus({ ...EMPTY, conversations: [eng(0)] }, NOW);
    expect(status).toEqual({ kind: 'calm', open: 1, next: { day: isoDay(0), inDays: 0 } });
  });

  it('calm: open = dated upcoming + undated open tasks; next = earliest dated', () => {
    const status = computeHallStatus(
      { conversations: [eng(3), eng(10)], performances: [], tasks: [task(null)] },
      NOW,
    );
    expect(status).toEqual({ kind: 'calm', open: 3, next: { day: isoDay(3), inDays: 3 } });
  });
});

describe('hallSentence — copy building (ca)', () => {
  it('show day without venue tz: viewer wall time, no courtesy', () => {
    const s = hallSentence(
      { kind: 'show', place: 'Kursaal', at: '2026-07-17T15:00:00+00:00', venueTz: null },
      'ca',
      { viewerTz: 'Europe/Madrid' },
    );
    expect(s).toBe('Avui: Kursaal. Load-in a les 17:00.');
  });

  it('show day abroad: venue time primary, viewer courtesy in parentheses', () => {
    // London gig seen from Barcelona: 15:00Z = 16:00 BST = 17:00 CEST.
    const s = hallSentence(
      {
        kind: 'show',
        place: 'Roundhouse',
        at: '2026-07-17T15:00:00+00:00',
        venueTz: 'Europe/London',
      },
      'ca',
      { viewerTz: 'Europe/Madrid' },
    );
    expect(s).toBe('Avui: Roundhouse. Load-in a les 16:00 (17:00 la teva hora).');
  });

  it('show day at home: venue tz equals viewer tz, no courtesy', () => {
    const s = hallSentence(
      {
        kind: 'show',
        place: 'Kursaal',
        at: '2026-07-17T15:00:00+00:00',
        venueTz: 'Europe/Madrid',
      },
      'ca',
      { viewerTz: 'Europe/Madrid' },
    );
    expect(s).toBe('Avui: Kursaal. Load-in a les 17:00.');
  });

  it('show day without any time drops the time part', () => {
    expect(
      hallSentence({ kind: 'show', place: 'Manresa', at: null, venueTz: null }, 'ca'),
    ).toBe('Avui: Manresa.');
  });

  it('attention, singular and plural, day and days', () => {
    expect(hallSentence({ kind: 'attention', overdue: 1, oldestDays: 1 }, 'ca')).toBe(
      '1 cosa vençuda — fa 1 dia.',
    );
    expect(hallSentence({ kind: 'attention', overdue: 3, oldestDays: 5 }, 'ca')).toBe(
      '3 coses vençudes — la més antiga fa 5 dies.',
    );
  });

  it('calm with zero open', () => {
    expect(hallSentence({ kind: 'calm', open: 0, next: null }, 'ca')).toBe(
      'Tot tranquil. Res a la vista.',
    );
  });

  it('calm without a dated next drops the tail', () => {
    expect(hallSentence({ kind: 'calm', open: 1, next: null }, 'ca')).toBe(
      'Tot tranquil. 1 cosa oberta, cap vençuda.',
    );
  });

  it('calm next: avui / demà / weekday inside the week', () => {
    const calm = (day: string, inDays: number) =>
      hallSentence({ kind: 'calm', open: 3, next: { day, inDays } }, 'ca');
    expect(calm('2026-07-17', 0)).toBe(
      'Tot tranquil. 3 coses obertes, cap vençuda — la propera espera fins avui.',
    );
    expect(calm('2026-07-18', 1)).toBe(
      'Tot tranquil. 3 coses obertes, cap vençuda — la propera espera fins demà.',
    );
    // 2026-07-20 is a Monday.
    expect(calm('2026-07-20', 3)).toBe(
      'Tot tranquil. 3 coses obertes, cap vençuda — la propera espera fins dilluns.',
    );
  });

  it('calm next a week or more out says the date, not a bare weekday', () => {
    expect(hallSentence({ kind: 'calm', open: 2, next: { day: '2026-07-28', inDays: 11 } }, 'ca')).toBe(
      'Tot tranquil. 2 coses obertes, cap vençuda — la propera espera fins al 28 de juliol.',
    );
  });

  it('calm singular with a next drops "la propera"', () => {
    expect(hallSentence({ kind: 'calm', open: 1, next: { day: '2026-07-20', inDays: 3 } }, 'ca')).toBe(
      'Tot tranquil. 1 cosa oberta, cap vençuda — espera fins dilluns.',
    );
  });
});

describe('hallSentence — other locales', () => {
  it('es', () => {
    expect(hallSentence({ kind: 'attention', overdue: 3, oldestDays: 5 }, 'es')).toBe(
      '3 cosas vencidas — la más antigua hace 5 días.',
    );
    expect(hallSentence({ kind: 'calm', open: 3, next: { day: '2026-07-20', inDays: 3 } }, 'es')).toBe(
      'Todo tranquilo. 3 cosas abiertas, ninguna vencida — la próxima espera hasta el lunes.',
    );
  });

  it('en', () => {
    expect(
      hallSentence(
        { kind: 'show', place: 'Kursaal', at: '2026-07-17T15:00:00+00:00', venueTz: null },
        'en',
        { viewerTz: 'UTC' },
      ),
    ).toBe('Today: Kursaal. Load-in at 15:00.');
    expect(hallSentence({ kind: 'calm', open: 3, next: { day: '2026-07-20', inDays: 3 } }, 'en')).toBe(
      'All quiet. 3 things open, none overdue — the next waits until Monday.',
    );
  });
});

describe('nextTimedMoment — the imminent moment for the relation line', () => {
  it('picks the nearest FUTURE load-in/start; past times are skipped', () => {
    const perfs = [
      show({ venue_name: 'A', load_in_at: atHour(0, 8) }), // 08:00, already past
      show({ venue_name: 'B', start_at: atHour(0, 20) }), // 20:00
      show({ venue_name: 'C', load_in_at: atHour(0, 15), start_at: atHour(0, 21) }), // 15:00 + 21:00
    ];
    expect(nextTimedMoment(perfs, NOW)).toEqual({ at: atHour(0, 15), place: 'C', kind: 'load-in' });
  });

  it('reaches into tomorrow when nothing is left today', () => {
    const perfs = [
      show({ venue_name: 'Done', start_at: atHour(0, 8) }),
      show({ venue_name: 'Next', performed_at: isoDay(1), load_in_at: atHour(1, 9) }),
    ];
    expect(nextTimedMoment(perfs, NOW)).toEqual({ at: atHour(1, 9), place: 'Next', kind: 'load-in' });
  });

  it('is null when nothing timed lies ahead, and ignores cancelled', () => {
    expect(nextTimedMoment([show({ start_at: atHour(0, 8) })], NOW)).toBeNull();
    expect(nextTimedMoment([show({ status: 'cancelled', start_at: atHour(0, 15) })], NOW)).toBeNull();
    expect(nextTimedMoment([show({ venue_name: 'Untimed' })], NOW)).toBeNull();
  });
});

describe('todayMoments — the day teaser', () => {
  it('today only, one per show (start preferred over load-in), sorted, untimed dropped', () => {
    const perfs = [
      show({ venue_name: 'Show', start_at: atHour(0, 20), load_in_at: atHour(0, 15) }),
      show({ venue_name: 'Rehearsal', load_in_at: atHour(0, 10, 30) }),
      show({ venue_name: 'Untimed' }), // no time → dropped
      show({ venue_name: 'Tomorrow', performed_at: isoDay(1), start_at: atHour(1, 12) }), // not today → dropped
      show({ status: 'cancelled', venue_name: 'Off', start_at: atHour(0, 12) }), // cancelled → dropped
    ];
    expect(todayMoments(perfs, NOW)).toEqual([
      { at: atHour(0, 10, 30), place: 'Rehearsal', kind: 'load-in' },
      { at: atHour(0, 20), place: 'Show', kind: 'show' },
    ]);
  });
});
