import { describe, expect, it } from 'vitest';
import { nowLineIndex, roadsheetDay } from './roadsheet-day';
import type { Roadsheet, RoadsheetTrip } from './roadsheet';

type Day = Pick<Roadsheet, 'schedule' | 'travel'>;

const five = {
  load_in_at: '2027-03-14T10:00:00Z',
  soundcheck_at: null,
  start_at: '2027-03-14T19:00:00Z',
  loadout_at: null,
  wrap_at: null,
};

const trip: RoadsheetTrip = {
  id: 't1',
  title: null,
  starts_at: '2027-03-14T08:00:00Z',
  all_day: false,
  origin_city: 'Barcelona',
  destination_city: 'Girona',
  tz: null,
  stages: [
    {
      mode: 'car',
      from_city: 'Barcelona',
      from_place: null,
      to_city: 'Girona',
      to_place: null,
      depart_at: '2027-03-14T08:00:00Z',
      arrive_at: '2027-03-14T09:30:00Z',
      depart_tz: 'Europe/Madrid',
      arrive_tz: null,
      reference: null,
    },
  ],
  going: ['Pau'],
};

describe('roadsheetDay: the day in order, one source of hours', () => {
  it('merges the trip’s stages and the running order by instant', () => {
    const day: Day = {
      schedule: {
        ...five,
        moments: [
          { kind: 'load_in', label: null, at: '2027-03-14T10:00:00Z', ends_at: null },
          { kind: null, label: 'Comida', at: '2027-03-14T13:00:00Z', ends_at: '2027-03-14T14:00:00Z' },
          { kind: 'start', label: null, at: '2027-03-14T19:00:00Z', ends_at: null },
        ],
      },
      travel: [trip],
    };
    const points = roadsheetDay(day);
    expect(points.map((p) => (p.of === 'stage' ? 'stage' : (p.key ?? p.label)))).toEqual([
      'stage',
      'load_in',
      'Comida',
      'start',
    ]);
    const lunch = points[2];
    expect(lunch.of === 'moment' && lunch.ends_at).toBe('2027-03-14T14:00:00Z');
    const leg = points[0];
    expect(leg.of === 'stage' && leg.tz).toBe('Europe/Madrid');
  });

  it('without the whole order, the five fields that have an hour', () => {
    const points = roadsheetDay({ schedule: five, travel: null });
    expect(points.map((p) => p.of === 'moment' && p.key)).toEqual(['load_in', 'start']);
  });

  it('a moment with an unknown kind keeps its label and no key; one without an hour is not a point', () => {
    const points = roadsheetDay({
      schedule: {
        ...five,
        moments: [
          { kind: 'photo_call', label: 'Fotos', at: '2027-03-14T17:00:00Z', ends_at: null },
          { kind: 'start', label: null, at: '', ends_at: null },
        ],
      },
    });
    expect(points).toHaveLength(1);
    expect(points[0].of === 'moment' && points[0].key).toBeNull();
  });

  it('a venue role has no trips and no schedule may be nothing', () => {
    expect(roadsheetDay({ schedule: null, travel: null })).toEqual([]);
  });
});

describe('nowLineIndex: where the «now» line goes', () => {
  const points = roadsheetDay({ schedule: five, travel: [trip] });
  const tz = 'Europe/Madrid';

  it('before the first point that is still ahead', () => {
    expect(nowLineIndex(points, new Date('2027-03-14T12:10:00Z'), tz)).toBe(2);
  });

  it('at the top in the morning, after the last at night', () => {
    expect(nowLineIndex(points, new Date('2027-03-14T06:00:00Z'), tz)).toBe(0);
    expect(nowLineIndex(points, new Date('2027-03-14T21:00:00Z'), tz)).toBe(3);
  });

  it('not on another day, read on the venue’s clock', () => {
    expect(nowLineIndex(points, new Date('2027-03-13T12:00:00Z'), tz)).toBeNull();
    // 23h30 UTC on the 14th is already the 15th in Girona.
    expect(nowLineIndex(points, new Date('2027-03-14T23:30:00Z'), tz)).toBeNull();
  });

  it('no points, no line', () => {
    expect(nowLineIndex([], new Date(), tz)).toBeNull();
  });
});
