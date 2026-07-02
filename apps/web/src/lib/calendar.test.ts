import { describe, expect, it } from 'vitest';
import { addDaysIso, addMonths, dayKeyInTz, monthGrid } from './calendar';

describe('monthGrid', () => {
  it('starts weeks on Monday and pads the first week', () => {
    // July 2026 starts on a Wednesday.
    const weeks = monthGrid(2026, 7);
    expect(weeks[0].map((d) => d.iso)).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
    expect(weeks[0].map((d) => d.inMonth)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('covers the whole month and ends on a Sunday', () => {
    for (const [y, m] of [
      [2026, 7],
      [2026, 2], // Feb 2026: 28 days starting Sunday
      [2024, 2], // leap February
      [2026, 12], // year boundary
    ] as const) {
      const weeks = monthGrid(y, m);
      const flat = weeks.flat();
      expect(flat.length % 7).toBe(0);
      const inMonth = flat.filter((d) => d.inMonth);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      expect(inMonth.length).toBe(daysInMonth);
      expect(inMonth[0].iso).toBe(`${y}-${String(m).padStart(2, '0')}-01`);
    }
  });

  it('a month starting on Monday has no leading pad', () => {
    // June 2026 starts on a Monday.
    const weeks = monthGrid(2026, 6);
    expect(weeks[0][0]).toEqual({ iso: '2026-06-01', inMonth: true });
  });
});

describe('addDaysIso', () => {
  it('crosses month and year boundaries', () => {
    expect(addDaysIso('2026-07-01', -1)).toBe('2026-06-30');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('addMonths', () => {
  it('crosses year boundaries in both directions', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 7, -19)).toEqual({ year: 2024, month: 12 });
  });
});

describe('dayKeyInTz', () => {
  it('buckets an instant into the day of the given zone', () => {
    // 23:30Z on Jul 1 is already Jul 2 in Madrid (CEST, +2).
    expect(dayKeyInTz('2026-07-01T23:30:00Z', 'Europe/Madrid')).toBe('2026-07-02');
    expect(dayKeyInTz('2026-07-01T23:30:00Z', 'UTC')).toBe('2026-07-01');
  });

  it('respects the 2026-10-25 DST switch in Madrid', () => {
    // 00:30Z Oct 25 = 02:30 CEST (before the 01:00Z switch) → Oct 25.
    expect(dayKeyInTz('2026-10-25T00:30:00Z', 'Europe/Madrid')).toBe('2026-10-25');
    // 23:00Z Oct 24 = 01:00 CEST Oct 25 → already next day in Madrid.
    expect(dayKeyInTz('2026-10-24T23:00:00Z', 'Europe/Madrid')).toBe('2026-10-25');
  });
});
