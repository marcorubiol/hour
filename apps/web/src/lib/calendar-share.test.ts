import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import { CalendarShareCreateSchema, toCalendarShare } from './calendar-share';

const WS = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';

describe('CalendarShareCreateSchema (90)', () => {
  test('no scope is the whole space', () => {
    const r = v.safeParse(CalendarShareCreateSchema, { workspace_id: WS });
    expect(r.success && r.output.scope).toBe('all');
  });

  test('takes «mine» and «all»', () => {
    for (const scope of ['mine', 'all'] as const) {
      const r = v.safeParse(CalendarShareCreateSchema, { workspace_id: WS, scope });
      expect(r.success && r.output.scope).toBe(scope);
    }
  });

  test('refuses any other scope and a bad workspace', () => {
    for (const body of [
      { workspace_id: WS, scope: 'team' },
      { workspace_id: WS, scope: null },
      { workspace_id: WS, scope: 'MINE' },
      { workspace_id: 'nope', scope: 'all' },
    ]) {
      expect(v.safeParse(CalendarShareCreateSchema, body).success).toBe(false);
    }
  });
});

describe('toCalendarShare', () => {
  const row = { id: 'a', token: 'b', workspace_id: WS, created_at: '2026-11-01T10:00:00Z' };

  test('keeps the scope, and drops what the screen does not need', () => {
    expect(toCalendarShare({ ...row, scope: 'mine', created_by: 'x' } as Parameters<typeof toCalendarShare>[0])).toEqual({
      ...row,
      scope: 'mine',
    });
  });

  test('a row without the column reads as the whole space', () => {
    expect(toCalendarShare(row).scope).toBe('all');
    expect(toCalendarShare({ ...row, scope: null }).scope).toBe('all');
  });
});
