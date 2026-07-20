import { describe, it, expect } from 'vitest';
import {
  blockDays,
  blockLimit,
  blockWeeks,
  weekdayOf,
  BLOCK_MAX_DAYS,
  BLOCK_MIN_DAYS,
} from './block';

const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri

describe('weekdayOf', () => {
  it('reads the day in UTC, not the browser zone', () => {
    // 2026-03-09 is a Monday. Parsed in a zone west of Greenwich a naive
    // `new Date(iso).getDay()` would answer Sunday and drop every Monday.
    expect(weekdayOf('2026-03-09')).toBe(1);
    expect(weekdayOf('2026-03-15')).toBe(0); // Sunday
    expect(weekdayOf('2026-03-09T23:30:00Z')).toBe(1); // instant → its day
  });
});

describe('blockDays', () => {
  it('turns five weeks of weekdays into 25 days', () => {
    const days = blockDays({ from: '2026-03-09', to: '2026-04-10', weekdays: WEEKDAYS });
    expect(days).toHaveLength(25);
    expect(days[0]).toBe('2026-03-09');
    expect(days.at(-1)).toBe('2026-04-10');
    expect(days.every((d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5)).toBe(true);
  });

  it('punches out exceptions without breaking the span', () => {
    const base = { from: '2026-03-09', to: '2026-04-10', weekdays: WEEKDAYS };
    const days = blockDays({ ...base, exceptions: ['2026-03-20', '2026-04-07'] });
    expect(days).toHaveLength(23);
    expect(days).not.toContain('2026-03-20');
    expect(days).not.toContain('2026-04-07');
    // The days around a hole stay put — an exception is not a split.
    expect(days).toContain('2026-03-19');
    expect(days).toContain('2026-03-23');
  });

  it('honours a sparse rule (Tue + Thu)', () => {
    const days = blockDays({ from: '2026-03-09', to: '2026-03-22', weekdays: [2, 4] });
    expect(days).toEqual([
      '2026-03-10',
      '2026-03-12',
      '2026-03-17',
      '2026-03-19',
    ]);
  });

  it('answers nothing rather than guessing', () => {
    expect(blockDays({ from: '2026-03-10', to: '2026-03-09', weekdays: WEEKDAYS })).toEqual([]);
    expect(blockDays({ from: '2026-03-09', to: '2026-03-20', weekdays: [] })).toEqual([]);
    expect(blockDays({ from: '', to: '', weekdays: WEEKDAYS })).toEqual([]);
  });

  // Regression (adversarial review, 2026-07-20): the walk used to be bounded
  // by CALENDAR days while the cap counts SELECTED days, so a sparse rule over
  // a long span came back short — and blockLimit still said 'ok'. A block that
  // quietly loses a third of its days is worse than one that refuses.
  it('does not truncate a long sparse span that is still under the cap', () => {
    // 577 calendar days, 82 Mondays — the old 400-day walk returned 57.
    const days = blockDays({ from: '2026-01-01', to: '2027-08-01', weekdays: [1] });
    expect(days).toHaveLength(82);
    expect(days.at(-1)).toBe('2027-07-26');
    expect(blockLimit(days.length)).toBe('ok');
  });

  it('reports too_many for a sparse span past the cap instead of a short list', () => {
    // 882 calendar days, 126 Mondays — must read as oversized, never as a
    // tidy 92-day block.
    const days = blockDays({ from: '2026-01-01', to: '2028-06-01', weekdays: [1] });
    expect(days.length).toBeGreaterThan(BLOCK_MAX_DAYS);
    expect(blockLimit(days.length)).toBe('too_many');
  });

  it('includes a single-day span (the limit rejects it, not the generator)', () => {
    expect(blockDays({ from: '2026-03-09', to: '2026-03-09', weekdays: WEEKDAYS })).toEqual([
      '2026-03-09',
    ]);
  });
});

describe('blockLimit', () => {
  it('names the guardrail that is tripped', () => {
    expect(blockLimit(0)).toBe('too_few');
    expect(blockLimit(BLOCK_MIN_DAYS - 1)).toBe('too_few');
    expect(blockLimit(BLOCK_MIN_DAYS)).toBe('ok');
    expect(blockLimit(25)).toBe('ok');
    expect(blockLimit(BLOCK_MAX_DAYS)).toBe('ok');
    expect(blockLimit(BLOCK_MAX_DAYS + 1)).toBe('too_many');
  });
});

describe('blockWeeks', () => {
  it('groups Monday-first and omits weeks with nothing in them', () => {
    const weeks = blockWeeks(
      blockDays({ from: '2026-03-09', to: '2026-04-10', weekdays: WEEKDAYS }),
    );
    expect(weeks).toHaveLength(5);
    expect(weeks[0].monday).toBe('2026-03-09');
    expect(weeks[0].days).toHaveLength(5);
    expect(weeks.at(-1)!.monday).toBe('2026-04-06');
  });

  it('a fortnight gap leaves no empty row', () => {
    const weeks = blockWeeks(['2026-03-09', '2026-03-23']);
    expect(weeks.map((w) => w.monday)).toEqual(['2026-03-09', '2026-03-23']);
  });

  it('puts a Sunday in the week that started the Monday before', () => {
    const weeks = blockWeeks(['2026-03-15']); // a Sunday
    expect(weeks[0].monday).toBe('2026-03-09');
  });
});
