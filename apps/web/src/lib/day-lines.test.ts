import { describe, expect, it } from 'vitest';
import { dayLineGroups, dayPart, hourOfClock } from './day-lines';

describe('the day of many (ADR-237)', () => {
  it('morning, afternoon, night, and no hour apart', () => {
    expect([dayPart(9), dayPart(13.99), dayPart(14), dayPart(19.5), dayPart(20), dayPart(null)]).toEqual([
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'night',
      'untimed',
    ]);
    expect(hourOfClock('20:30')).toBe(20.5);
    expect(hourOfClock('')).toBeNull();
  });

  it('groups in the day order, sorted by hour; the filters keep only theirs', () => {
    const rows = [
      { id: 'n', hour: 21, need: false, mine: true },
      { id: 'm2', hour: 12, need: true, mine: false },
      { id: 'm1', hour: 10, need: false, mine: false },
      { id: 'x', hour: null, need: true, mine: true },
    ];
    expect(dayLineGroups(rows, 'all').map((g) => [g.part, g.rows.map((r) => r.id)])).toEqual([
      ['morning', ['m1', 'm2']],
      ['night', ['n']],
      ['untimed', ['x']],
    ]);
    expect(dayLineGroups(rows, 'need').flatMap((g) => g.rows.map((r) => r.id))).toEqual(['m2', 'x']);
    expect(dayLineGroups(rows, 'mine').flatMap((g) => g.rows.map((r) => r.id))).toEqual(['n', 'x']);
  });
});
