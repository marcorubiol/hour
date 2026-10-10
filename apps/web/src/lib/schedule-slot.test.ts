import { describe, expect, it } from 'vitest';
import {
  timeslotsFromSlots,
  timeslotsOrdered,
  withTimeslots,
  withSchedule,
  reinterpretSlots,
  EMPTY_TIMESLOTS,
  type ScheduleSlotRow,
} from './schedule-slot';

const D = '2031-03-01';
const at = (hm: string) => `${D}T${hm}:00+00:00`;

function slot(kind: string | null, hm: string, sort: number, extra: Partial<ScheduleSlotRow> = {}): ScheduleSlotRow {
  return { id: `s-${sort}`, kind, label: null, at: at(hm), ends_at: null, sort, notes: null, ...extra };
}

describe('timeslotsFromSlots', () => {
  it('reads the five fields by kind, null where there is no slot', () => {
    const t = timeslotsFromSlots([slot('load_in', '15:00', 1), slot('start', '20:00', 2)]);
    expect(t).toEqual({ ...EMPTY_TIMESLOTS, load_in_at: at('15:00'), start_at: at('20:00') });
  });

  it('takes the first slot of a kind by sort, not by array order', () => {
    const t = timeslotsFromSlots([slot('start', '22:00', 3), slot('start', '20:00', 1)]);
    expect(t.start_at).toBe(at('20:00'));
  });

  it('ignores slots of other kinds and free-label slots', () => {
    const t = timeslotsFromSlots([slot('photo_call', '17:00', 1), slot(null, '18:00', 2, { label: 'Dinner' })]);
    expect(t).toEqual(EMPTY_TIMESLOTS);
  });

  it('survives a missing embed', () => {
    expect(timeslotsFromSlots(null)).toEqual(EMPTY_TIMESLOTS);
    expect(timeslotsFromSlots(undefined)).toEqual(EMPTY_TIMESLOTS);
  });
});

describe('withTimeslots', () => {
  it('swaps the embed for the five fields and keeps the rest of the row', () => {
    const row = withTimeslots({ id: 'p', schedule_slot: [slot('wrap', '23:30', 1)] });
    expect(row).toEqual({ id: 'p', ...EMPTY_TIMESLOTS, wrap_at: at('23:30') });
    expect('schedule_slot' in row).toBe(false);
  });
});

describe('withSchedule', () => {
  it('keeps the five AND the whole order, free moments included, in their order', () => {
    const row = withSchedule({
      id: 'p',
      schedule_slot: [
        slot('start', '20:00', 2),
        slot(null, '17:00', 1, { label: 'photo call', notes: 'not in a feed' }),
      ],
    });
    expect(row.start_at).toBe(at('20:00'));
    expect(row.schedule).toEqual([
      { kind: null, label: 'photo call', at: at('17:00'), ends_at: null },
      { kind: 'start', label: null, at: at('20:00'), ends_at: null },
    ]);
    expect('schedule_slot' in row).toBe(false);
  });
});

describe('reinterpretSlots — the venue moved zone, the clock stays', () => {
  it('keeps each wall-clock hour and gives it the new zone’s instant', () => {
    // 10h and 20h30–22h in Madrid (CET, +1) → the same hours in Lisbon (WET, 0).
    const madrid = [
      { id: 'a', at: '2027-03-17T09:00:00.000Z', ends_at: null },
      { id: 'b', at: '2027-03-17T19:30:00.000Z', ends_at: '2027-03-17T21:00:00.000Z' },
    ];
    expect(reinterpretSlots(madrid, 'Europe/Madrid', 'Europe/Lisbon')).toEqual([
      { id: 'a', at: '2027-03-17T10:00:00.000Z', ends_at: null },
      { id: 'b', at: '2027-03-17T20:30:00.000Z', ends_at: '2027-03-17T22:00:00.000Z' },
    ]);
  });
  it('a night past midnight stays on its own next day', () => {
    const late = [{ at: '2027-03-17T23:30:00.000Z', ends_at: null }]; // 0h30 on the 18th, Madrid
    expect(reinterpretSlots(late, 'Europe/Madrid', 'America/New_York')).toEqual([
      { at: '2027-03-18T04:30:00.000Z', ends_at: null }, // 0h30 on the 18th, New York (EDT)
    ]);
  });
  it('same zone: nothing moves', () => {
    const s = [{ at: '2027-03-17T09:00:00.000Z', ends_at: null }];
    expect(reinterpretSlots(s, 'Europe/Madrid', 'Europe/Madrid')).toEqual(s);
  });
});

describe('timeslotsOrdered', () => {
  it('accepts an ordered day and a partial one', () => {
    expect(timeslotsOrdered({ ...EMPTY_TIMESLOTS, load_in_at: at('15:00'), start_at: at('20:00') })).toBe(true);
    expect(timeslotsOrdered(EMPTY_TIMESLOTS)).toBe(true);
  });

  it('rejects an adjacent pair out of order', () => {
    expect(timeslotsOrdered({ ...EMPTY_TIMESLOTS, load_in_at: at('20:00'), soundcheck_at: at('10:00') })).toBe(false);
  });

  it('only checks ADJACENT pairs, as the old CHECK did', () => {
    // load in after wrap with nothing between: legal before, legal now.
    expect(timeslotsOrdered({ ...EMPTY_TIMESLOTS, load_in_at: at('20:00'), wrap_at: at('10:00') })).toBe(true);
  });
});
