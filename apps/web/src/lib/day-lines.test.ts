import { describe, expect, it } from 'vitest';
import { dayFilterRows, dayFiltersShown, hourOfClock } from './day-lines';

describe('the day is always the same (ADR-247)', () => {
  it('reads the hour of a clock', () => {
    expect(hourOfClock('20:30')).toBe(20.5);
    expect(hourOfClock('')).toBeNull();
  });

  it('the filters keep only theirs, in order', () => {
    const rows = [
      { id: 'a', need: false, mine: true },
      { id: 'b', need: true, mine: false },
      { id: 'c', need: true, mine: true },
    ];
    expect(dayFilterRows(rows, 'all').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(dayFilterRows(rows, 'need').map((r) => r.id)).toEqual(['b', 'c']);
    expect(dayFilterRows(rows, 'mine').map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('the filters only with more than one project, however many things', () => {
    expect(dayFiltersShown(['gota', 'gota', 'gota', 'gota', 'gota'])).toBe(false);
    expect(dayFiltersShown(['gota', null])).toBe(false);
    expect(dayFiltersShown(['gota', 'minim'])).toBe(true);
  });
});
