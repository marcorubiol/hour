import { describe, expect, it } from 'vitest';
import {
  computeHallStatus,
  hallSentence,
  type HallEngagement,
  type HallPerformance,
  type HallTask,
} from './hall-status';

// Friday 2026-07-17, 10:00 — built with the LOCAL constructor so the
// viewer-calendar-day math is deterministic in any test timezone.
const NOW = new Date(2026, 6, 17, 10, 0, 0);

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

function eng(offset: number | null, status = 'contacted'): HallEngagement {
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
    ...over,
  };
}

const EMPTY = { engagements: [], performances: [], tasks: [] };

describe('computeHallStatus — state selection', () => {
  it('show day outranks overdue attention', () => {
    const status = computeHallStatus(
      {
        engagements: [eng(-3)],
        performances: [
          show({ venue: { name: 'Kursaal' }, load_in_at: `${isoDay(0)}T15:00:00+00:00` }),
        ],
        tasks: [],
      },
      NOW,
    );
    expect(status).toEqual({ kind: 'show', place: 'Kursaal', at: `${isoDay(0)}T15:00:00+00:00` });
  });

  it('ignores cancelled and non-today performances', () => {
    const status = computeHallStatus(
      {
        engagements: [eng(-3)],
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
    expect(at({ venue: { name: 'Kursaal' }, venue_name: 'x', city: 'y' })).toMatchObject({
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

  it('show time prefers load_in_at over start_at, null when neither', () => {
    const both = show({ load_in_at: actionAt(0), start_at: `${isoDay(0)}T20:00:00+00:00` });
    expect(computeHallStatus({ ...EMPTY, performances: [both] }, NOW)).toMatchObject({
      at: actionAt(0),
    });
    expect(computeHallStatus({ ...EMPTY, performances: [show()] }, NOW)).toMatchObject({
      at: null,
    });
  });

  it('counts overdue engagements and tasks; oldest wins the age', () => {
    const status = computeHallStatus(
      { engagements: [eng(-5), eng(-1)], performances: [], tasks: [task(-2)] },
      NOW,
    );
    expect(status).toEqual({ kind: 'attention', overdue: 3, oldestDays: 5 });
  });

  it('keeps DeskBoard working-set semantics: declined/dormant/undated engagements and done tasks are out', () => {
    const status = computeHallStatus(
      {
        engagements: [eng(-5, 'declined'), eng(-5, 'dormant'), eng(null)],
        performances: [],
        tasks: [task(-5, 'done')],
      },
      NOW,
    );
    expect(status).toEqual({ kind: 'calm', open: 0, next: null });
  });

  it('an action due today is TODAY, not overdue (day buckets, like the Desk)', () => {
    const status = computeHallStatus({ ...EMPTY, engagements: [eng(0)] }, NOW);
    expect(status).toEqual({ kind: 'calm', open: 1, next: { day: isoDay(0), inDays: 0 } });
  });

  it('calm: open = dated upcoming + undated open tasks; next = earliest dated', () => {
    const status = computeHallStatus(
      { engagements: [eng(3), eng(10)], performances: [], tasks: [task(null)] },
      NOW,
    );
    expect(status).toEqual({ kind: 'calm', open: 3, next: { day: isoDay(3), inDays: 3 } });
  });
});

describe('hallSentence — copy building (ca)', () => {
  it('show day with load-in time, in the requested zone', () => {
    const s = hallSentence(
      { kind: 'show', place: 'Kursaal', at: '2026-07-17T15:00:00+00:00' },
      'ca',
      { timeZone: 'Europe/Madrid' },
    );
    expect(s).toBe('Avui: Kursaal. Load-in a les 17:00.');
  });

  it('show day without any time drops the time part', () => {
    expect(hallSentence({ kind: 'show', place: 'Manresa', at: null }, 'ca')).toBe('Avui: Manresa.');
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
      hallSentence({ kind: 'show', place: 'Kursaal', at: '2026-07-17T15:00:00+00:00' }, 'en', {
        timeZone: 'UTC',
      }),
    ).toBe('Today: Kursaal. Load-in at 15:00.');
    expect(hallSentence({ kind: 'calm', open: 3, next: { day: '2026-07-20', inDays: 3 } }, 'en')).toBe(
      'All quiet. 3 things open, none overdue — the next waits until Monday.',
    );
  });
});
