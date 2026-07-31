import { describe, expect, it, vi } from 'vitest';
import { dateStatusFamily, invalidateDateFeeds, DATE_STATUSES } from './date';

describe('dateStatusFamily', () => {
  it('tentative is a possibility, confirmed/done the solid form', () => {
    expect(dateStatusFamily('tentative')).toBe('hold');
    expect(dateStatusFamily('confirmed')).toBe('confirmed');
    expect(dateStatusFamily('done')).toBe('confirmed');
  });

  it('cancelled is released — the same word the performance grammar uses', () => {
    // One vocabulary across both calendar primitives (ADR-095 §0): if these
    // two ever disagree, the month draws two grammars on one sheet.
    expect(dateStatusFamily('cancelled')).toBe('released');
  });

  it('unknown statuses never read as commitment', () => {
    expect(dateStatusFamily('nope')).toBe('proposed');
  });

  it('covers the full enum', () => {
    for (const s of DATE_STATUSES) {
      expect(['confirmed', 'hold', 'proposed', 'released']).toContain(dateStatusFamily(s));
    }
  });
});

describe('invalidateDateFeeds', () => {
  /**
   * The month and the agenda fetch the SAME rows under DIFFERENT keys, and
   * Desk and the line module hold two more. Editing a date from the agenda
   * while only `planner-dates` is invalidated leaves the reader looking at
   * the row they just changed — the bug this helper exists to prevent. If
   * a new date feed is ever added, this test is what fails.
   */
  it('marks every surface that renders date rows', () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    invalidateDateFeeds({ invalidateQueries });

    const keys = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'planner-dates',
        'planner-agenda-dates',
        'line-dates',
        'desk-dates',
      ]),
    );
    expect(keys).toHaveLength(4);
  });
});
