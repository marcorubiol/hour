import { describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import {
  DateCreateSchema,
  DatePatchSchema,
  dateStatusFamily,
  invalidateDateFeeds,
  DATE_STATUSES,
} from './date';

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

describe('DateCreateSchema & DatePatchSchema bolo_id (ADR-242)', () => {
  const PROJECT = '00000000-0000-4000-8000-000000000001';
  const BOLO = '00000000-0000-4000-8000-000000000002';

  it('accepts a valid uuid, null, or omitted bolo_id on create', () => {
    const base = { project_id: PROJECT, kind: 'travel_day', starts_at: '2026-12-01T08:00:00Z' };
    expect(v.safeParse(DateCreateSchema, { ...base, bolo_id: BOLO }).success).toBe(true);
    expect(v.safeParse(DateCreateSchema, { ...base, bolo_id: null }).success).toBe(true);
    expect(v.safeParse(DateCreateSchema, base).success).toBe(true);
    expect(v.safeParse(DateCreateSchema, { ...base, bolo_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('accepts a valid uuid or null bolo_id on patch and rejects non-uuid strings', () => {
    expect(v.safeParse(DatePatchSchema, { bolo_id: BOLO }).success).toBe(true);
    expect(v.safeParse(DatePatchSchema, { bolo_id: null }).success).toBe(true);
    expect(v.safeParse(DatePatchSchema, { bolo_id: 'bad' }).success).toBe(false);
  });
});
