import { describe, expect, it } from 'vitest';
import {
  applyTimeslotPatch,
  splitTimeslotPatch,
  timeslotsFromSlots,
  timeslotsOrdered,
  withTimeslots,
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

describe('splitTimeslotPatch', () => {
  it('separates the timeslots, keeping an explicit null apart from absence', () => {
    const { timeslots, rest } = splitTimeslotPatch({ status: 'confirmed', start_at: null, load_in_at: at('15:00') });
    expect(timeslots).toEqual({ start_at: null, load_in_at: at('15:00') });
    expect(rest).toEqual({ status: 'confirmed' });
    expect('soundcheck_at' in timeslots).toBe(false);
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

describe('applyTimeslotPatch', () => {
  const current = [slot('load_in', '15:00', 1), slot('photo_call', '17:00', 2, { label: 'Photo call' }), slot('start', '20:00', 3)];

  it('leaves absent fields alone and carries ids through', () => {
    const next = applyTimeslotPatch(current, {});
    expect(next.map((s) => s.id)).toEqual(['s-1', 's-2', 's-3']);
  });

  it('moves the slot of a kind in place', () => {
    const next = applyTimeslotPatch(current, { start_at: at('21:00') });
    expect(next[2]).toMatchObject({ id: 's-3', kind: 'start', at: at('21:00') });
    expect(next).toHaveLength(3);
  });

  it('removes the slot of a kind on null, and keeps the free one', () => {
    const next = applyTimeslotPatch(current, { load_in_at: null });
    expect(next.map((s) => s.kind)).toEqual(['photo_call', 'start']);
    expect(next[0]).toMatchObject({ label: 'Photo call' });
  });

  it('inserts a new kind before the next legacy kind in canonical order', () => {
    const next = applyTimeslotPatch(current, { soundcheck_at: at('18:00') });
    expect(next.map((s) => s.kind)).toEqual(['load_in', 'photo_call', 'soundcheck', 'start']);
    expect(next[2].id).toBeUndefined();
  });

  it('appends a kind that comes after every existing one', () => {
    const next = applyTimeslotPatch(current, { wrap_at: at('23:30') });
    expect(next.at(-1)).toMatchObject({ kind: 'wrap', at: at('23:30') });
  });

  it('builds a whole day from nothing in canonical order', () => {
    const next = applyTimeslotPatch([], {
      wrap_at: at('23:30'),
      load_in_at: at('15:00'),
      start_at: at('20:00'),
    });
    expect(next.map((s) => s.kind)).toEqual(['load_in', 'start', 'wrap']);
  });

  it('ignores a null for a kind that has no slot', () => {
    expect(applyTimeslotPatch(current, { wrap_at: null })).toHaveLength(3);
  });
});
