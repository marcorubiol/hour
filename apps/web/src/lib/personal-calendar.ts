/**
 * Personal calendar feed & per-space scope contracts (ADR-241 Fase 1).
 *
 * Shared by `/api/me/calendar-feed`, `/api/me/calendar-scope` and
 * `Ajustes › Calendario` (`CalendarSection.svelte`).
 */

import * as v from 'valibot';
import { viewScopeOf, type WithViewScope } from './view-scope';
import { normalizeAlarmMode, type CalendarAlarmMode } from './calendar-events';

export const CALENDAR_SCOPES = ['mine', 'all', 'none'] as const;
export type CalendarScope = (typeof CALENDAR_SCOPES)[number];

export const CALENDAR_ALARM_MODES = ['none', 'day_before', '2h_before'] as const;

export const CalendarFeedCreateSchema = v.object({
  alarm_mode: v.optional(v.picklist(CALENDAR_ALARM_MODES), 'none'),
});

export const CalendarFeedPatchSchema = v.object({
  alarm_mode: v.picklist(CALENDAR_ALARM_MODES),
});

export const CalendarScopePutSchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  calendar_scope: v.nullable(v.picklist(CALENDAR_SCOPES)),
});

export interface PersonalCalendarFeedItem {
  id: string;
  token: string;
  alarm_mode: CalendarAlarmMode;
  expires_at: string;
  created_at: string;
}

export function toPersonalCalendarFeed(row: {
  id: string;
  token: string;
  alarm_mode?: string | null;
  expires_at: string;
  created_at: string;
}): PersonalCalendarFeedItem {
  return {
    id: row.id,
    token: row.token,
    alarm_mode: normalizeAlarmMode(row.alarm_mode),
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export interface WithCalendarScope extends WithViewScope {
  calendar_scope?: string | null;
}

export function isCalendarScope(value: unknown): value is CalendarScope {
  return value === 'mine' || value === 'all' || value === 'none';
}

/**
 * Effective calendar scope for a space: explicit `calendar_scope` when set,
 * otherwise inherits the space's `view_scope` (ADR-151: «Lo mío» or «Todo»).
 */
export function effectiveCalendarScope(w: WithCalendarScope | null | undefined): CalendarScope {
  if (!w) return 'all';
  if (isCalendarScope(w.calendar_scope)) return w.calendar_scope;
  return viewScopeOf(w);
}

/** True when the space follows `view_scope` without an explicit calendar override. */
export function calendarScopeIsDefault(w: WithCalendarScope): boolean {
  return !isCalendarScope(w.calendar_scope);
}
