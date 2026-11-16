import { describe, expect, it } from 'vitest';
import { agendaItems, quietTail } from './agenda-items';
import { addDaysIso } from './planner';

function span(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDaysIso(from, i));
}

describe('agendaItems (ADR-211 § 1)', () => {
  const days = span('2026-11-16', 30); // lunes 16 nov → 15 dic

  it('only days with something; a trip is a leg, not a row', () => {
    const items = agendaItems({
      days,
      kept: (d) => ['2026-11-18', '2026-11-19'].includes(d),
      legs: (d) => (d === '2026-11-17' ? ['trip'] : []),
      gaps: [],
    });
    expect(items.map((i) => i.key)).toEqual(['l:trip', 'd:2026-11-18', 'd:2026-11-19']);
  });

  it('a leg on a day with a show goes before its row', () => {
    const items = agendaItems({ days, kept: (d) => d === '2026-11-18', legs: (d) => (d === '2026-11-18' ? ['t'] : []), gaps: [] });
    expect(items.map((i) => i.t)).toEqual(['leg', 'day']);
  });

  it('the week is a rule above the first row of a new week, never on the first row', () => {
    const items = agendaItems({ days, kept: (d) => ['2026-11-20', '2026-11-22', '2026-11-25'].includes(d), legs: () => [], gaps: [] });
    expect(items.map((i) => (i.t === 'day' ? i.weekTurn : null))).toEqual([false, false, true]);
  });

  it('the month turn is its name, and no week rule under it', () => {
    const items = agendaItems({ days, kept: (d) => ['2026-11-27', '2026-12-02'].includes(d), legs: () => [], gaps: [] });
    expect(items.map((i) => i.key)).toEqual(['d:2026-11-27', 'm:2026-12', 'd:2026-12-02']);
    expect(items[2]).toMatchObject({ weekTurn: false });
  });

  it('a free run is one line at its first night', () => {
    const items = agendaItems({
      days,
      kept: (d) => ['2026-11-18', '2026-11-23'].includes(d),
      legs: () => [],
      gaps: [{ from: '2026-11-19', nights: 4 }],
    });
    expect(items.map((i) => i.key)).toEqual(['d:2026-11-18', 'f:2026-11-19', 'd:2026-11-23']);
  });
});

describe('quietTail', () => {
  it('the last month after today with nothing stops the growth; today\'s month never does', () => {
    const days = span('2026-11-16', 46);
    expect(quietTail(days, '2026-11-16', (d) => d === '2026-11-20')).toBe(true);
    expect(quietTail(days, '2026-11-16', (d) => d === '2026-12-20')).toBe(false);
    expect(quietTail(span('2026-11-16', 10), '2026-11-16', () => false)).toBe(false);
  });
});
