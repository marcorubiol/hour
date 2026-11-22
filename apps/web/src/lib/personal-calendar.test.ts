import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  CalendarFeedCreateSchema,
  CalendarFeedPatchSchema,
  CalendarScopePutSchema,
  calendarScopeIsDefault,
  effectiveCalendarScope,
  toPersonalCalendarFeed,
} from './personal-calendar';

describe('personal-calendar contracts (ADR-241 Fase 1)', () => {
  it('validates feed creation, alarm patch, and scope put schemas', () => {
    expect(v.safeParse(CalendarFeedCreateSchema, {}).success).toBe(true);
    expect(v.parse(CalendarFeedCreateSchema, {}).alarm_mode).toBe('none');
    expect(v.safeParse(CalendarFeedCreateSchema, { alarm_mode: 'day_before' }).success).toBe(true);
    expect(v.safeParse(CalendarFeedCreateSchema, { alarm_mode: '15m' }).success).toBe(false);

    expect(v.safeParse(CalendarFeedPatchSchema, { alarm_mode: '2h_before' }).success).toBe(true);
    expect(v.safeParse(CalendarFeedPatchSchema, {}).success).toBe(false);

    const uuid = '0197f000-0000-7000-8000-000000000001';
    expect(v.safeParse(CalendarScopePutSchema, { workspace_id: uuid, calendar_scope: 'none' }).success).toBe(true);
    expect(v.safeParse(CalendarScopePutSchema, { workspace_id: uuid, calendar_scope: null }).success).toBe(true);
    expect(v.safeParse(CalendarScopePutSchema, { workspace_id: uuid, calendar_scope: 'invalid' }).success).toBe(false);
    expect(v.safeParse(CalendarScopePutSchema, { workspace_id: 'bad', calendar_scope: 'mine' }).success).toBe(false);
  });

  it('inherits view_scope when calendar_scope is unset and supports none override', () => {
    expect(effectiveCalendarScope({ my_role: 'owner', view_scope: null, calendar_scope: null })).toBe('all');
    expect(effectiveCalendarScope({ my_role: 'member', my_preset: 'equip', view_scope: null, calendar_scope: null })).toBe('mine');
    expect(effectiveCalendarScope({ my_role: 'owner', view_scope: 'mine', calendar_scope: null })).toBe('mine');
    expect(calendarScopeIsDefault({ my_role: 'owner', view_scope: 'mine', calendar_scope: null })).toBe(true);

    expect(effectiveCalendarScope({ my_role: 'owner', view_scope: 'all', calendar_scope: 'none' })).toBe('none');
    expect(calendarScopeIsDefault({ my_role: 'owner', view_scope: 'all', calendar_scope: 'none' })).toBe(false);
  });

  it('normalizes feed rows safely', () => {
    const item = toPersonalCalendarFeed({
      id: 'f1',
      token: 'abc',
      alarm_mode: 'unknown',
      expires_at: '2027-11-22T00:00:00Z',
      created_at: '2026-11-22T00:00:00Z',
    });
    expect(item.alarm_mode).toBe('none');
  });
});
