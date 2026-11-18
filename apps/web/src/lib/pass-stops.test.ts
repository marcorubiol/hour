import { describe, expect, test } from 'vitest';
import {
  DAY_TEMPLATE,
  fillDay,
  hangPlaces,
  showInstant,
  templateAt,
  templateFor,
  tripStops,
  weaveStops,
  type ExtraStop,
} from './pass-stops';
import { placeByTime } from './running-order';
import type { ScheduleSlotInput } from './schedule-slot';

const slot = (kind: string | null, at: string): ScheduleSlotInput => ({
  kind,
  label: kind ? null : 'x',
  at,
  ends_at: null,
  notes: null,
});

const ROWS = [
  slot('load_in', '2026-11-21T14:30:00Z'),
  slot('soundcheck', '2026-11-21T17:30:00Z'),
  slot('start', '2026-11-21T19:30:00Z'),
  slot('loadout', '2026-11-21T21:00:00Z'),
];

describe('weaveStops', () => {
  test('a timed extra lands before the first later row, never reordering the rows', () => {
    const arrive: ExtraStop = { key: 'a', kind: 'arrive', at: '2026-11-21T12:30:00Z' };
    const depart: ExtraStop = { key: 'd', kind: 'depart', at: '2026-11-21T11:00:00Z' };
    const out = weaveStops(ROWS, [depart, arrive]);
    expect(out.map((s) => (s.type === 'row' ? s.index : s.stop.key))).toEqual(['d', 'a', 0, 1, 2, 3]);
  });

  test('the night is always last, and an extra later than every row goes at the end before it', () => {
    const night: ExtraStop = { key: 'n', kind: 'night', at: null };
    const late: ExtraStop = { key: 'l', kind: 'arrive', at: '2026-11-21T23:00:00Z' };
    const out = weaveStops(ROWS, [night, late]);
    expect(out.map((s) => (s.type === 'row' ? s.index : s.stop.key))).toEqual([0, 1, 2, 3, 'l', 'n']);
  });

  test('the show without an hour goes before what closes the day', () => {
    const rows = [slot('load_in', '2026-11-21T14:30:00Z'), slot('loadout', '2026-11-21T21:00:00Z')];
    const show: ExtraStop = { key: 's', kind: 'show', at: null };
    expect(weaveStops(rows, [show]).map((s) => (s.type === 'row' ? s.index : s.stop.key))).toEqual([0, 's', 1]);
  });

  test('a day with no rows is its extras alone', () => {
    const show: ExtraStop = { key: 's', kind: 'show', at: null };
    const night: ExtraStop = { key: 'n', kind: 'night', at: null };
    expect(weaveStops([], [night, show]).map((s) => (s.type === 'extra' ? s.stop.key : s.index))).toEqual(['s', 'n']);
  });
});

describe('hangPlaces', () => {
  test('the address goes to the arrival, else the load-in, else the show', () => {
    expect(hangPlaces(['load_in', 'start'], true).address).toBe('arrive');
    expect(hangPlaces(['load_in', 'start'], false).address).toBe('load_in');
    expect(hangPlaces(['start'], false).address).toBe('start');
    expect(hangPlaces([], false).address).toBe('show');
  });

  test('the contact goes to the load-in, else the show', () => {
    expect(hangPlaces(['load_in', 'start'], true).contact).toBe('load_in');
    expect(hangPlaces(['soundcheck', 'start'], false).contact).toBe('start');
    expect(hangPlaces([null], false).contact).toBe('show');
  });
});

describe('the template («Rellenar el día»)', () => {
  test('offers nothing until the show has an hour', () => {
    expect(templateFor([])).toEqual([]);
    expect(templateFor(['load_in'])).toEqual([]);
  });

  test('offers only the moments the day lacks', () => {
    expect(templateFor(['start']).map((m) => m.kind)).toEqual(['load_in', 'soundcheck', 'loadout']);
    expect(templateFor(['start', 'soundcheck']).map((m) => m.kind)).toEqual(['load_in', 'loadout']);
    expect(templateFor(['load_in', 'soundcheck', 'start', 'loadout'])).toEqual([]);
  });

  test('proposes 5 h and 2 h before the show and 2 h after', () => {
    const start = '2026-11-21T19:30:00.000Z';
    expect(DAY_TEMPLATE.map((m) => templateAt(start, m))).toEqual([
      '2026-11-21T14:30:00.000Z',
      '2026-11-21T17:30:00.000Z',
      '2026-11-21T21:30:00.000Z',
    ]);
  });

  test('fills by the hour around what is written, without touching it', () => {
    const order = [slot(null, '2026-11-21T18:00:00Z'), slot('start', '2026-11-21T19:30:00Z')];
    const next = fillDay(
      order,
      [
        { kind: 'load_in', at: '2026-11-21T14:30:00Z' },
        { kind: 'loadout', at: '2026-11-21T21:30:00Z' },
      ],
      placeByTime,
    );
    expect(next.map((s) => s.kind ?? s.label)).toEqual(['load_in', 'x', 'start', 'loadout']);
    expect(next[1]).toBe(order[0]);
  });

  test('a show hour typed on the venue clock', () => {
    expect(showInstant('2026-11-21', 20, 30, 'Europe/Madrid')).toBe('2026-11-21T19:30:00.000Z');
  });
});

describe('tripStops', () => {
  const onDay = (iso: string) => iso.startsWith('2026-11-21');
  test('the first departure and the last arrival of the day, with their places', () => {
    const stops = tripStops(
      't1',
      [
        { id: '1', depart_at: '2026-11-21T10:00:00Z', arrive_at: '2026-11-21T11:00:00Z', from_city: 'Barcelona', from_place: null, to_city: 'Girona', to_place: 'Estació' },
        { id: '2', depart_at: '2026-11-21T11:20:00Z', arrive_at: '2026-11-21T11:50:00Z', from_city: 'Girona', from_place: null, to_city: 'Salt', to_place: 'Teatre de Salt' },
      ],
      onDay,
    );
    expect(stops).toEqual([
      { key: 't1:depart', kind: 'depart', at: '2026-11-21T10:00:00Z', place: 'Barcelona', tripId: 't1' },
      { key: 't1:arrive', kind: 'arrive', at: '2026-11-21T11:50:00Z', place: 'Teatre de Salt', tripId: 't1' },
    ]);
  });

  test('a stage of another day lends nothing', () => {
    const stops = tripStops(
      't1',
      [{ id: '1', depart_at: '2026-11-20T22:00:00Z', arrive_at: '2026-11-21T08:00:00Z', from_city: 'Lyon', from_place: null, to_city: 'Girona', to_place: null }],
      onDay,
    );
    expect(stops.map((s) => s.kind)).toEqual(['arrive']);
  });
});
