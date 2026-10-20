import { describe, expect, test } from 'vitest';
import { nextStepShortcuts } from './next-step';

const days = (now: Date) => Object.fromEntries(nextStepShortcuts(now).map((s) => [s.key, s.day]));

describe('nextStepShortcuts', () => {
  test('a Tuesday: tomorrow, the coming Monday, two weeks, the 1st', () => {
    // Tue 20 Oct 2026
    expect(days(new Date(2026, 9, 20, 10))).toEqual({
      tomorrow: '2026-10-21',
      monday: '2026-10-26',
      two_weeks: '2026-11-03',
      next_month: '2026-11-01',
    });
  });

  test('on a Monday, «Monday» is next week', () => {
    expect(days(new Date(2026, 9, 26, 10)).monday).toBe('2026-11-02');
  });

  test('on a Sunday, «Monday» is tomorrow', () => {
    expect(days(new Date(2026, 9, 25, 10)).monday).toBe('2026-10-26');
  });

  test('December rolls into January', () => {
    const d = days(new Date(2026, 11, 31, 23, 30));
    expect(d.tomorrow).toBe('2027-01-01');
    expect(d.next_month).toBe('2027-01-01');
  });
});
