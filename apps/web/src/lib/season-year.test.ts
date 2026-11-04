import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEASON_START_MONTH,
  currentSeason,
  dayIn,
  inSeasonDay,
  normalizeStartMonth,
  seasonAt,
  seasonLabel,
  seasonOf,
  seasonStartFor,
  seasonStartOf,
  seasonYearOf,
} from './season-year';

describe('seasonYearOf: the month the season starts is the edge', () => {
  it('September by default: the 1st opens it, the 31st of August closes the one before', () => {
    expect(DEFAULT_SEASON_START_MONTH).toBe(9);
    expect(seasonYearOf('2026-09-01')).toBe(2026);
    expect(seasonYearOf('2026-08-31')).toBe(2025);
    expect(seasonYearOf('2027-01-05')).toBe(2026);
    expect(seasonYearOf('2027-08-31T22:00:00Z')).toBe(2026);
  });

  it('January: the season is the calendar year', () => {
    expect(seasonYearOf('2026-01-01', 1)).toBe(2026);
    expect(seasonYearOf('2026-12-31', 1)).toBe(2026);
  });

  it('December: one month of the year, eleven of the next', () => {
    expect(seasonYearOf('2026-12-01', 12)).toBe(2026);
    expect(seasonYearOf('2026-11-30', 12)).toBe(2025);
    expect(seasonYearOf('2027-11-30', 12)).toBe(2026);
  });

  it('a month out of range falls back to September', () => {
    expect(normalizeStartMonth(0)).toBe(9);
    expect(normalizeStartMonth(13)).toBe(9);
    expect(normalizeStartMonth(2.5)).toBe(9);
    expect(normalizeStartMonth(null)).toBe(9);
    expect(normalizeStartMonth('3')).toBe(3);
    expect(seasonYearOf('2026-02-01', 0)).toBe(2025);
  });
});

describe('seasonAt: the two days, inclusive, across the year', () => {
  it('September to August', () => {
    expect(seasonAt(2026)).toEqual({ year: 2026, label: '26-27', start: '2026-09-01', end: '2027-08-31' });
  });

  it('March ends on the last day of February, leap year included', () => {
    expect(seasonAt(2027, 3)).toMatchObject({ start: '2027-03-01', end: '2028-02-29' });
    expect(seasonAt(2026, 3)).toMatchObject({ start: '2026-03-01', end: '2027-02-28' });
  });

  it('January ends on the 31st of December of the same year', () => {
    expect(seasonAt(2026, 1)).toEqual({ year: 2026, label: '2026', start: '2026-01-01', end: '2026-12-31' });
  });

  it('every day of a season lands in it, the edges included', () => {
    for (const m of [1, 6, 9, 12]) {
      const s = seasonOf('2026-07-15', m);
      expect(seasonOf(s.start, m)).toEqual(s);
      expect(seasonOf(s.end, m)).toEqual(s);
      expect(inSeasonDay(s.start, s)).toBe(true);
      expect(inSeasonDay(`${s.end}T23:30:00Z`, s)).toBe(true);
    }
  });
});

describe('seasonLabel', () => {
  it('two digits, across the century', () => {
    expect(seasonLabel(2026)).toBe('26-27');
    expect(seasonLabel(2099)).toBe('99-00');
    expect(seasonLabel(2027, 9, true)).toBe('2027-28');
    expect(seasonLabel(2026, 1, true)).toBe('2026');
  });
});

describe('currentSeason and the time zone', () => {
  // 00:30 on the 1st of September in Madrid is still the 31st of August in UTC.
  const edge = new Date('2026-08-31T22:30:00Z');

  it('reads today where the space lives', () => {
    expect(dayIn(edge, 'Europe/Madrid')).toBe('2026-09-01');
    expect(dayIn(edge, 'UTC')).toBe('2026-08-31');
    expect(currentSeason(edge, 9, 'Europe/Madrid').label).toBe('26-27');
    expect(currentSeason(edge, 9, 'UTC').label).toBe('25-26');
  });

  it('the year rolls over in the zone too', () => {
    const newYear = new Date('2026-12-31T23:30:00Z');
    expect(currentSeason(newYear, 1, 'Europe/Madrid').label).toBe('2027');
    expect(currentSeason(newYear, 1, 'America/New_York').label).toBe('2026');
  });

  it('an unknown zone does not break it: the local clock', () => {
    const now = new Date(2026, 9, 16, 10, 0, 0);
    expect(dayIn(now, 'Not/AZone')).toBe('2026-10-16');
    expect(currentSeason(now).label).toBe('26-27');
  });
});

describe('the month of a screen and of each space', () => {
  it('their own when they share it, September when they disagree or say nothing', () => {
    expect(seasonStartOf([])).toBe(9);
    expect(seasonStartOf([{ season_start_month: 1 }, { season_start_month: 1 }])).toBe(1);
    expect(seasonStartOf([{ season_start_month: 1 }, { season_start_month: 9 }])).toBe(9);
    expect(seasonStartOf([{ season_start_month: 1 }, {}])).toBe(9);
  });

  it('a space not in the map is September', () => {
    const starts = new Map([['w1', 1]]);
    expect(seasonStartFor(starts, 'w1')).toBe(1);
    expect(seasonStartFor(starts, 'w2')).toBe(9);
    expect(seasonStartFor(undefined, 'w1')).toBe(9);
    expect(seasonStartFor(starts, null)).toBe(9);
  });
});
